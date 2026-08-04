/**
 * POS Module — App Logic (Offline-First)
 * Manages product catalog, cart, checkout, PDF tickets, and sync.
 */

(function () {
  'use strict';

  // Auth guard
  const user = OrvayayaAPI.getUser();
  if (!user || !OrvayayaAPI.getToken()) {
    window.location.href = '/login.html';
    return;
  }

  // State
  let localDb = null;
  let cart = [];
  let products = [];
  let categories = ['TODOS'];
  let activeCategory = 'TODOS';
  let sucursalId = null;
  let ticketNumber = 0;

  // ── Init ──
  async function init() {
    // Tarea 4.6: guard de Dexie antes de usarlo
    if (typeof Dexie === 'undefined') {
      document.getElementById('productGrid').innerHTML =
        '<div class="loading-state"><span class="material-symbols-outlined" style="font-size:48px;color:var(--error)">error</span>' +
        '<p style="color:var(--error)">Error: IndexedDB (Dexie) no se cargó. Revisa tu conexión.</p></div>';
      return;
    }
    // Initialize IndexedDB
    localDb = OrvayayaDB.initLocalDB();

    // Set user name
    const nameEl = document.getElementById('sidebarUserName');
    if (nameEl) nameEl.textContent = user.nombre || 'Cajero';

    // Generate ticket number
    ticketNumber = Math.floor(Math.random() * 999999);
    document.getElementById('ticketId').textContent = `#TRX-${String(ticketNumber).padStart(6, '0')}`;

    // Load catalog
    await loadCatalog();

    // Setup connectivity monitoring
    updateConnectivityStatus();
    window.addEventListener('online', () => { updateConnectivityStatus(); autoSync(); });
    window.addEventListener('offline', updateConnectivityStatus);

    // Update pending count
    await updatePendingCount();

    // Setup event listeners
    setupEventListeners();

    // beforeunload warning
    window.addEventListener('beforeunload', (e) => {
      if (cart.length > 0) {
        e.preventDefault();
        e.returnValue = 'Tienes un ticket sin finalizar. ¿Seguro que quieres salir?';
      }
    });
    // Nota: sendBeacon eliminado (Tarea 1.2) — no puede enviar headers de autenticación
  }

  // ── Load Catalog ──
  async function loadCatalog() {
    try {
      if (navigator.onLine) {
        // Fetch from API
        const result = await OrvayayaAPI.getProducts({ limit: '200' });
        products = result.items || result;

        // Get branches — Tarea 4.3: sucursal configurable, no hardcodeada
        const branches = await OrvayayaAPI.getBranches();
        const savedBranchId = await OrvayayaDB.getConfig(localDb, 'sucursalId');
        const branch = branches.find(b => b.id === savedBranchId)
          || branches.find(b => b.tipo === 'pueblo')
          || branches[0];
        sucursalId = branch.id;
        await OrvayayaDB.saveConfig(localDb, 'sucursalId', sucursalId);

        // Get inventory for this branch
        const inv = await OrvayayaAPI.getInventory(sucursalId);
        const stockMap = {};
        inv.forEach(i => { stockMap[i.productoId] = i.cantidad; });

        // Merge stock into products
        products = products.map(p => ({
          ...p,
          id: p.id,
          stock: stockMap[p.id] ?? 0,
        }));

        // Save to IndexedDB
        await OrvayayaDB.syncCatalogToLocal(localDb, products);

        // Extract categories
        const cats = new Set(products.map(p => p.categoria).filter(Boolean));
        categories = ['TODOS', ...Array.from(cats)];
      } else {
        // Load from IndexedDB
        products = await OrvayayaDB.getLocalProducts(localDb);
        sucursalId = await OrvayayaDB.getConfig(localDb, 'sucursalId');
        const cats = new Set(products.map(p => p.categoria).filter(Boolean));
        categories = ['TODOS', ...Array.from(cats)];
      }

      renderCategoryChips();
      renderProducts();
    } catch (err) {
      console.error('Error loading catalog:', err);
      // Try loading from IndexedDB as fallback
      try {
        products = await OrvayayaDB.getLocalProducts(localDb);
        sucursalId = await OrvayayaDB.getConfig(localDb, 'sucursalId');
        const cats = new Set(products.map(p => p.categoria).filter(Boolean));
        categories = ['TODOS', ...Array.from(cats)];
        renderCategoryChips();
        renderProducts();
        showToast('Modo offline: usando catálogo local', 'error');
      } catch (e) {
        showToast('Error cargando catálogo', 'error');
      }
    }
  }

  // ── Render Category Chips ──
  function renderCategoryChips() {
    const container = document.getElementById('categoryChips');
    container.innerHTML = categories.map(cat =>
      `<button class="chip ${cat === activeCategory ? 'active' : ''}" data-cat="${cat}">${cat}</button>`
    ).join('');
  }

  // ── Render Products ──
  function renderProducts(searchQuery = '') {
    const grid = document.getElementById('productGrid');
    let filtered = products;

    if (activeCategory !== 'TODOS') {
      filtered = filtered.filter(p => (p.categoria || '').toUpperCase() === activeCategory);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.nombre.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.categoria || '').toLowerCase().includes(q)
      );
    }

    if (filtered.length === 0) {
      grid.innerHTML = `<div class="loading-state"><span class="material-symbols-outlined" style="font-size: 48px; color: var(--outline-variant);">search_off</span><p>No se encontraron productos</p></div>`;
      return;
    }

    grid.innerHTML = filtered.map(p => {
      const stock = p.stock ?? 0;
      let dotClass = '';
      if (stock === 0) dotClass = 'out';
      else if (stock < 5) dotClass = 'low';

      return `
        <div class="product-card" data-id="${p.id}" data-price="${p.precio}" data-name="${p.nombre}" data-sku="${p.sku}">
          <div class="product-card-body">
            <div class="product-card-top">
              <span class="product-sku">${p.sku}</span>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 12px; font-weight: 500; color: var(--on-surface-variant);">${stock} en stock</span>
                <div class="stock-dot ${dotClass}"></div>
              </div>
            </div>
            <h3 class="product-name">${p.nombre}</h3>
          </div>
          <div class="product-card-footer">
            <span class="product-price">Bs. ${parseFloat(p.precio).toFixed(2)}</span>
            <span class="material-symbols-outlined product-add">add_circle</span>
          </div>
        </div>`;
    }).join('');
  }

  // ── Cart Management ──
  function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const existing = cart.find(item => item.productoId === productId);
    const currentQty = existing ? existing.cantidad : 0;
    
    if (currentQty + 1 > (product.stock || 0)) {
      showToast(`Stock insuficiente. Disponible: ${product.stock || 0}`, 'error');
      return;
    }

    if (existing) {
      existing.cantidad++;
      existing.subtotal = existing.cantidad * existing.precioUnitario;
    } else {
      cart.push({
        productoId: productId,
        productoNombre: product.nombre,
        productoSku: product.sku,
        cantidad: 1,
        precioUnitario: parseFloat(product.precio),
        subtotal: parseFloat(product.precio),
      });
    }

    renderCart();
  }

  function removeFromCart(index) {
    cart.splice(index, 1);
    renderCart();
  }

  function updateCartQty(index, delta) {
    const item = cart[index];
    const product = products.find(p => p.id === item.productoId);
    
    if (delta > 0 && product) {
      if (item.cantidad + delta > (product.stock || 0)) {
        showToast(`Stock insuficiente. Disponible: ${product.stock || 0}`, 'error');
        return;
      }
    }

    cart[index].cantidad += delta;
    if (cart[index].cantidad <= 0) {
      cart.splice(index, 1);
    } else {
      cart[index].subtotal = cart[index].cantidad * cart[index].precioUnitario;
    }
    renderCart();
  }

  function clearCart() {
    cart = [];
    ticketNumber = Math.floor(Math.random() * 999999);
    document.getElementById('ticketId').textContent = `#TRX-${String(ticketNumber).padStart(6, '0')}`;
    renderCart();
  }

  function renderCart() {
    const tbody = document.getElementById('cartBody');
    const btnCheckout = document.getElementById('btnCheckout');

    if (cart.length === 0) {
      tbody.innerHTML = `<tr class="empty-cart-row"><td colspan="3"><div class="empty-cart"><span class="material-symbols-outlined" style="font-size: 48px; color: var(--outline-variant);">shopping_cart</span><p>Agrega productos al ticket</p></div></td></tr>`;
      document.getElementById('subtotal').textContent = 'Bs. 0,00';
      document.getElementById('tax').textContent = 'Bs. 0,00';
      document.getElementById('grandTotal').textContent = 'Bs. 0,00';
      btnCheckout.disabled = true;
      const badge = document.getElementById('mobileCartBadge');
      if (badge) badge.textContent = '0';
      return;
    }

    tbody.innerHTML = cart.map((item, i) => `
      <tr>
        <td class="text-center">
          <div style="display: flex; align-items: center; gap: 4px; justify-content: center;">
            <button onclick="window.posApp.updateQty(${i}, -1)" style="background:none;border:none;color:var(--on-surface-variant);cursor:pointer;padding:2px;font-size:16px;">−</button>
            <span class="qty-badge">${item.cantidad}</span>
            <button onclick="window.posApp.updateQty(${i}, 1)" style="background:none;border:none;color:var(--on-surface-variant);cursor:pointer;padding:2px;font-size:16px;">+</button>
          </div>
        </td>
        <td>
          <div class="item-name" title="${item.productoNombre}">${item.productoNombre}</div>
          <div class="item-unit-price">Bs. ${item.precioUnitario.toFixed(2)} c/u</div>
        </td>
        <td class="text-right" style="color: var(--on-surface);">Bs. ${item.subtotal.toFixed(2)}</td>
      </tr>
    `).join('');

    const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
    const tax = subtotal * 0.16;
    const total = subtotal + tax;
    const totalItems = cart.reduce((sum, item) => sum + item.cantidad, 0);

    document.getElementById('subtotal').textContent = `Bs. ${subtotal.toFixed(2)}`;
    document.getElementById('tax').textContent = `Bs. ${tax.toFixed(2)}`;
    document.getElementById('grandTotal').textContent = `Bs. ${total.toFixed(2)}`;
    btnCheckout.disabled = false;
    
    const badge = document.getElementById('mobileCartBadge');
    if (badge) badge.textContent = totalItems;
  }

  // ── Checkout ──
  async function checkout() {
    if (cart.length === 0) return;

    const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
    const tax = subtotal * 0.16;
    const total = subtotal + tax;

    const sale = {
      id: OrvayayaDB.uuidv4(),  // Tarea 4.2: fallback para IP LAN
      items: cart.map(item => ({
        productoId: item.productoId,
        productoNombre: item.productoNombre,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
        subtotal: item.subtotal,
      })),
      total,
      created_at: new Date().toISOString(),
    };

    // Save to IndexedDB first (offline-first)
    await OrvayayaDB.savePendingSale(localDb, sale);

    // Generate PDF ticket
    generateTicketPDF(sale, subtotal, tax, total);

    // Try to sync immediately if online
    if (navigator.onLine && sucursalId) {
      try {
        const result = await OrvayayaAPI.syncSales(sucursalId, [sale], OrvayayaDB.uuidv4()); // Tarea 4.2
        if (result.synced_ids && result.synced_ids.length > 0) {
          await OrvayayaDB.markSalesSynced(localDb, result.synced_ids);
          showToast('Venta registrada y sincronizada ✓', 'success');
        }
      } catch (err) {
        showToast('Venta guardada localmente. Se sincronizará luego.', 'error');
      }
    } else {
      showToast('Venta guardada localmente (offline). Se sincronizará cuando haya conexión.', 'error');
    }

    // Descontar stock localmente para evitar sobreventas offline
    sale.items.forEach(item => {
      const p = products.find(prod => prod.id === item.productoId);
      if (p) {
        p.stock = Math.max(0, (p.stock || 0) - item.cantidad);
      }
    });
    
    // Actualizar UI
    renderProducts(document.getElementById('searchInput').value);

    // Update pending count and reset cart
    await updatePendingCount();
    clearCart();

    // Show success overlay
    showSuccessOverlay(total);
  }

  function showSuccessOverlay(total) {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    
    overlay.innerHTML = `
      <div style="background: var(--surface); padding: 40px; border-radius: 12px; text-align: center; max-width: 400px; width: 90%; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <span class="material-symbols-outlined" style="font-size: 64px; color: #10b981; margin-bottom: 16px;">check_circle</span>
        <h2 style="margin: 0 0 8px 0; color: var(--on-surface);">¡Venta Realizada!</h2>
        <p style="color: var(--on-surface-variant); margin: 0 0 24px 0;">El ticket se ha generado correctamente.</p>
        <p style="font-size: 24px; font-weight: bold; font-family: var(--font-mono); color: var(--primary); margin: 0 0 32px 0;">Bs. ${total.toFixed(2)}</p>
        <button class="btn-primary" id="btnNewSale" style="width: 100%; font-size: 16px; padding: 16px;">REALIZAR NUEVA VENTA</button>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('btnNewSale').addEventListener('click', () => {
      overlay.remove();
      // Optional: focus back on search input
      const search = document.getElementById('searchInput');
      if (search) {
        search.value = '';
        search.focus();
        renderProducts('');
      }
    });
  }

  // ── Generate PDF Ticket (jsPDF) ──
  function generateTicketPDF(sale, subtotal, tax, total) {
    const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
    if (!jsPDF) {
      console.error("jsPDF not loaded");
      return;
    }
    const doc = new jsPDF({ unit: 'mm', format: [80, 200] }); // 80mm thermal paper width

    const pageWidth = 80;
    let y = 10;
    const leftMargin = 5;

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('ORVAYAYA', pageWidth / 2, y, { align: 'center' });
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Sistema de Ventas', pageWidth / 2, y, { align: 'center' });
    y += 4;
    doc.text(`Ticket: #TRX-${String(ticketNumber).padStart(6, '0')}`, pageWidth / 2, y, { align: 'center' });
    y += 4;
    doc.text(new Date().toLocaleString('es-VE'), pageWidth / 2, y, { align: 'center' });
    y += 3;

    // Separator
    doc.setDrawColor(150);
    doc.setLineWidth(0.2);
    doc.line(leftMargin, y, pageWidth - leftMargin, y);
    y += 4;

    // Items
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text('CANT', leftMargin, y);
    doc.text('ITEM', leftMargin + 10, y);
    doc.text('TOTAL', pageWidth - leftMargin, y, { align: 'right' });
    y += 3;
    doc.setFont('helvetica', 'normal');

    sale.items.forEach(item => {
      doc.text(`${item.cantidad}`, leftMargin, y);
      const itemName = item.productoNombre.length > 25 ? item.productoNombre.substring(0, 25) + '...' : item.productoNombre;
      doc.text(itemName, leftMargin + 10, y);
      doc.text(`Bs.${item.subtotal.toFixed(2)}`, pageWidth - leftMargin, y, { align: 'right' });
      y += 3.5;
    });

    // Separator
    y += 1;
    doc.line(leftMargin, y, pageWidth - leftMargin, y);
    y += 4;

    // Totals
    doc.setFontSize(8);
    doc.text('Subtotal:', leftMargin, y);
    doc.text(`Bs. ${subtotal.toFixed(2)}`, pageWidth - leftMargin, y, { align: 'right' });
    y += 4;
    doc.text('IVA (16%):', leftMargin, y);
    doc.text(`Bs. ${tax.toFixed(2)}`, pageWidth - leftMargin, y, { align: 'right' });
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('TOTAL:', leftMargin, y);
    doc.text(`Bs. ${total.toFixed(2)}`, pageWidth - leftMargin, y, { align: 'right' });
    y += 6;

    // Footer
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('¡Gracias por su compra!', pageWidth / 2, y, { align: 'center' });
    y += 3;
    doc.text('Sistema Orvayaya v1.0', pageWidth / 2, y, { align: 'center' });

    // Save/open the PDF
    doc.save(`ticket_TRX-${String(ticketNumber).padStart(6, '0')}.pdf`);
  }

  // ── Sync ──
  async function autoSync() {
    if (!navigator.onLine || !sucursalId || !localDb) return;

    try {
      const pending = await OrvayayaDB.getPendingSales(localDb);
      if (pending.length === 0) return;

      const result = await OrvayayaAPI.syncSales(sucursalId, pending, OrvayayaDB.uuidv4()); // Tarea 4.2
      if (result.synced_ids && result.synced_ids.length > 0) {
        await OrvayayaDB.markSalesSynced(localDb, result.synced_ids);
        showToast(`${result.synced_ids.length} ventas automáticas sincronizadas ✓`, 'success');
      }
      await updatePendingCount();
    } catch (err) {
      console.error('Auto-sync failed:', err);
    }
  }

  async function manualSync() {
    if (!navigator.onLine) {
      showToast('Estás en modo offline. Conéctate a internet para sincronizar.', 'error');
      return;
    }
    try {
      showToast('Sincronizando datos con el servidor...', 'info');
      
      // 1. Upload pending sales
      const pending = await OrvayayaDB.getPendingSales(localDb);
      if (pending.length > 0) {
        const result = await OrvayayaAPI.syncSales(sucursalId, pending, OrvayayaDB.uuidv4());
        if (result.synced_ids && result.synced_ids.length > 0) {
          await OrvayayaDB.markSalesSynced(localDb, result.synced_ids);
        }
        await updatePendingCount();
      }

      // 2. Download fresh catalog & stock
      await loadCatalog();
      
      showToast('¡Catálogo y ventas sincronizados! ✓', 'success');
    } catch (err) {
      console.error('Manual sync failed:', err);
      showToast('Error al sincronizar datos', 'error');
    }
  }

  async function updatePendingCount() {
    if (!localDb) return;
    const count = await OrvayayaDB.getPendingSalesCount(localDb);
    document.getElementById('pendingCount').textContent = count;
  }

  // ── Connectivity Status ──
  function updateConnectivityStatus() {
    const indicator = document.getElementById('connectivityStatus');
    const icon = document.getElementById('connectivityIcon');
    const text = document.getElementById('connectivityText');

    if (navigator.onLine) {
      indicator.className = 'status-indicator online';
      icon.textContent = 'wifi';
      text.textContent = 'ONLINE';
    } else {
      indicator.className = 'status-indicator offline';
      icon.textContent = 'wifi_off';
      text.textContent = 'MODO OFFLINE';
    }
  }

  // ── Toast ──
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px;">${type === 'success' ? 'check_circle' : 'warning'}</span>${message}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // ── Event Listeners ──
  function setupEventListeners() {
    // Mobile Layout Events
    document.getElementById('btnMobileMenu')?.addEventListener('click', () => {
      document.getElementById('posSidebar').classList.toggle('open');
    });
    document.getElementById('btnMobileCart')?.addEventListener('click', () => {
      document.querySelector('.pos-layout').classList.add('show-ticket');
    });
    document.getElementById('btnCloseTicket')?.addEventListener('click', () => {
      document.querySelector('.pos-layout').classList.remove('show-ticket');
    });

    // Product card clicks
    document.getElementById('productGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.product-card');
      if (card) addToCart(card.dataset.id);
    });

    // Category chips
    document.getElementById('categoryChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) {
        activeCategory = chip.dataset.cat;
        renderCategoryChips();
        renderProducts(document.getElementById('searchInput').value);
      }
    });

    // Search
    document.getElementById('searchInput').addEventListener('input', (e) => {
      renderProducts(e.target.value);
    });

    // Clear cart
    document.getElementById('btnClearCart').addEventListener('click', () => {
      if (cart.length > 0 && confirm('¿Vaciar el ticket actual?')) clearCart();
    });

    // Checkout
    document.getElementById('btnCheckout').addEventListener('click', checkout);

    // Manual sync
    document.getElementById('btnSync').addEventListener('click', manualSync);
    const sidebarSync = document.getElementById('btnSyncSidebar');
    if (sidebarSync) sidebarSync.addEventListener('click', manualSync);
  }

  // Expose for inline onclick handlers
  window.posApp = {
    updateQty: updateCartQty,
    removeItem: removeFromCart,
  };

  // ── Start ──
  init();
})();
