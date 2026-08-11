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

  // Helpers
  const round2 = (n) => Math.round(n * 100) / 100;

  // Stock helpers (stock se cuenta en unidades mínimas = cantidad × factor)
  function factorOf(presentacionId) {
    const pres = presentacionesCache.find(x => x.id === presentacionId);
    return pres ? pres.factorConversion : 1;   // legacy "Unidad" → 1
  }

  function unitsInCartForProduct(productoId) {
    return cart
      .filter(i => i.productoId === productoId)
      .reduce((sum, i) => sum + i.cantidad * factorOf(i.presentacionId), 0);
  }

  function baseStockOf(productoId) {
    const p = products.find(prod => prod.id === productoId);
    return p ? (p.stock ?? 0) : 0;
  }

  function availableUnitsForProduct(productoId) {
    return Math.max(0, baseStockOf(productoId) - unitsInCartForProduct(productoId));
  }

  // Idempotency key: deterministic from sale IDs so retries use the same key
  function makeIdempotencyKey(sales) {
    const ids = sales.map(s => s.id).sort().join(',');
    return `batch_${ids}`;
  }

  // State
  let localDb = null;
  let cart = [];
  let products = [];
  let categories = ['TODOS'];
  let activeCategory = 'TODOS';
  let sucursalId = null;
  let ticketNumber = 0;
  let activeView = 'venta';
  let inventoryData = [];
  let presentacionesCache = [];
  let checkoutInProgress = false;
  let syncTimer = null;
  let syncing = false;
  
  let config = {
    chargeIVA: false,
    autoPrintTicket: false
  };

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

    if (user.rol === 'admin') {
      document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex');
    }

    // Generate ticket number
    ticketNumber = Math.floor(Math.random() * 999999);
    document.getElementById('ticketId').textContent = `#TRX-${String(ticketNumber).padStart(6, '0')}`;

    // Load catalog
    await loadCatalog();

    // Load config
    const savedIva = await OrvayayaDB.getConfig(localDb, 'chargeIVA');
    if (savedIva !== undefined) config.chargeIVA = savedIva;
    
    const savedPdf = await OrvayayaDB.getConfig(localDb, 'autoPrintTicket');
    if (savedPdf !== undefined) config.autoPrintTicket = savedPdf;

    const toggleIva = document.getElementById('toggleIva');
    if (toggleIva) toggleIva.checked = config.chargeIVA;
    
    const togglePdf = document.getElementById('togglePdf');
    if (togglePdf) togglePdf.checked = config.autoPrintTicket;

    // Setup connectivity monitoring
    updateConnectivityStatus();
    window.addEventListener('online', () => { updateConnectivityStatus(); autoSync(); });
    window.addEventListener('offline', updateConnectivityStatus);

    // Update pending count
    await updatePendingCount();

    // Recarga estando online con pendientes: sincroniza de inmediato
    if (navigator.onLine) autoSync();

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

        // Fetch presentaciones
        try {
          presentacionesCache = await OrvayayaAPI.getPresentaciones();
          localStorage.setItem('pos_pres', JSON.stringify(presentacionesCache));
        } catch(e) {}

        // Restar unidades reservadas por ventas pendientes de este dispositivo
        const pendingOffsets = await OrvayayaDB.getPendingStockOffsets(localDb);
        products = products.map(p => ({
          ...p,
          stock: Math.max(0, (p.stock ?? 0) - (pendingOffsets[p.id] || 0)),
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
        try {
          presentacionesCache = JSON.parse(localStorage.getItem('pos_pres') || '[]');
        } catch(e) {}
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
      `<button class="chip ${cat === activeCategory ? 'active' : ''}" data-cat="${escAttr(cat)}">${esc(cat)}</button>`
    ).join('');
  }

  // ── Render Products ──
  function renderProducts(searchQuery = '') {
    const grid = document.getElementById('productGrid');
    let filtered = products;

    if (activeCategory !== 'TODOS') {
      filtered = filtered.filter(p => p.categoria === activeCategory);
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
      const inCartUnits = unitsInCartForProduct(p.id);
      const stock = Math.max(0, (p.stock ?? 0) - inCartUnits);
      let dotClass = '';
      if (stock === 0) dotClass = 'out';
      else if (stock < 5) dotClass = 'low';

      const productPres = presentacionesCache.filter(pres => pres.productoId === p.id && pres.factorConversion > 1);
      const hasPres = productPres.length > 0;
      const outOfStock = stock === 0;

      return `
        <div class="product-card ${outOfStock ? 'out-of-stock' : ''}" data-id="${p.id}" data-price="${p.precio}" data-name="${escAttr(p.nombre)}" data-sku="${escAttr(p.sku)}" data-stock="${stock}">
          <div class="product-card-body">
            <div class="product-card-top">
              <span class="product-sku">${esc(p.sku)}</span>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 12px; font-weight: 500; color: var(--on-surface-variant);">${outOfStock ? 'Agotado' : stock + ' en stock'}</span>
                <div class="stock-dot ${dotClass}"></div>
              </div>
            </div>
            <h3 class="product-name">${esc(p.nombre)}</h3>
          </div>
          <div class="product-card-footer" style="display:flex; justify-content:space-between; align-items:center;">
            <span class="product-price">Bs. ${parseFloat(p.precio).toFixed(2)}</span>
            <div style="display:flex; gap: 4px; align-items:center;">
              ${hasPres && !outOfStock ? `<span class="material-symbols-outlined product-pres" title="Opciones" style="color:var(--on-primary-container);cursor:pointer;font-size:20px;background:var(--primary-container);border-radius:8px;padding:6px;">inventory_2</span>` : ''}
              ${outOfStock
                ? `<span class="out-of-stock-badge">AGOTADO</span>`
                : `<span class="material-symbols-outlined product-add" style="font-size:32px;">add_circle</span>`}
            </div>
          </div>
        </div>`;
    }).join('');
  }

  // ── View Switching (venta / inventario) ──
  function switchView(view) {
    if (activeView === view) return;
    activeView = view;

    document.getElementById('linkVenta').classList.toggle('active', view === 'venta');
    document.getElementById('linkInventario').classList.toggle('active', view === 'inventario');

    const isSale = view === 'venta';
    document.getElementById('categoryChips').style.display = isSale ? '' : 'none';
    document.getElementById('productGrid').style.display = isSale ? '' : 'none';
    document.getElementById('inventoryView').style.display = isSale ? 'none' : '';

    if (isSale) {
      const searchInput = document.getElementById('searchInput');
      renderProducts(searchInput ? searchInput.value : '');
    } else {
      renderInventory('');
    }
  }

  // ── Inventory View (read-only) ──
  function invListRow(msg, icon) {
    return `<tr><td colspan="5" class="loading-row"><div class="loading-state" style="padding:40px;text-align:center">
      <span class="material-symbols-outlined" style="font-size:48px;color:var(--outline-variant)">${icon}</span>
      <p style="color:var(--on-surface-variant)">${msg}</p>
    </div></td></tr>`;
  }

  async function renderInventory(searchQuery = '') {
    const grid = document.getElementById('inventoryGrid');

    if (!navigator.onLine) {
      grid.innerHTML = invListRow('Conéctate a internet para ver el inventario', 'cloud_off');
      return;
    }

    if (!sucursalId) {
      grid.innerHTML = invListRow('No hay sucursal configurada', 'error');
      return;
    }

    grid.innerHTML = invListRow('Cargando inventario...', 'sync');

    try {
      inventoryData = await OrvayayaAPI.getInventory(sucursalId);
    } catch (err) {
      console.error('Error loading inventory:', err);
      grid.innerHTML = invListRow('Error cargando inventario', 'error');
      return;
    }

    const q = searchQuery.toLowerCase();
    const filtered = q
      ? inventoryData.filter(i => i.productoNombre.toLowerCase().includes(q) || i.productoSku.toLowerCase().includes(q))
      : inventoryData;

    const sorted = [...filtered].sort((a, b) => (a.cantidad || 0) - (b.cantidad || 0));

    if (sorted.length === 0) {
      grid.innerHTML = invListRow('No se encontraron productos', 'search_off');
      return;
    }

    grid.innerHTML = sorted.map(i => {
      const stock = i.cantidad || 0;
      let dotClass = '';
      let stateTxt = 'Óptimo';
      if (stock === 0) { dotClass = 'out'; stateTxt = 'Agotado'; }
      else if (stock < 5) { dotClass = 'low'; stateTxt = 'Bajo'; }
      return `
        <tr>
          <td class="inv-sku">${esc(i.productoSku)}</td>
          <td>${esc(i.productoNombre)}</td>
          <td class="text-right inv-price">Bs. ${parseFloat(i.precio).toFixed(2)}</td>
          <td class="text-right inv-stock">${stock}</td>
          <td class="text-center"><span class="inv-status ${dotClass}"><span class="stock-dot"></span>${stateTxt}</span></td>
        </tr>`;
    }).join('');
  }

  // ── Cart Management ──
  function openPresentacionSelector(productId) {
    const product = products.find(p => p.id === productId);
    let options = presentacionesCache.filter(p => p.productoId === productId);
    
    const hasBaseUnit = options.some(p => p.factorConversion === 1);
    if (!hasBaseUnit) {
      options.unshift({
        id: product.id,
        productoId: product.id,
        nombrePresentacion: "Unidad",
        factorConversion: 1,
        precioVenta: product.precio,
        isLegacy: true
      });
    }

    if (options.length === 1) {
      const opt = options[0];
      return addPresToCart(product.id, opt.id, 1, opt.isLegacy || false);
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay pres-selector-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    
    overlay.innerHTML = `
      <div class="modal" style="background:var(--surface);border-radius:12px;padding:24px;width:90%;max-width:400px;box-shadow:var(--shadow-3);">
        <h3 style="margin-top:0">${esc(product.nombre)}</h3>
        <p style="color:var(--on-surface-variant);margin-bottom:16px;">Selecciona la presentación:</p>
        <div class="options-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px;">
          ${options.map(p => {
            const availUnits = availableUnitsForProduct(product.id);
            const availPres = Math.floor(availUnits / p.factorConversion);
            const disabled = availPres <= 0;
            if (disabled) {
              return `<div class="opt-btn" style="padding:12px;border:1px solid var(--outline);border-radius:8px;background:var(--surface-container);color:var(--outline);text-align:left;display:flex;justify-content:space-between;align-items:center;opacity:0.6;">
                <span style="font-weight:500">${esc(p.nombrePresentacion)} (x${p.factorConversion})</span>
                <span style="font-size:11px">AGOTADO</span>
              </div>`;
            }
            return `<button class="opt-btn" onclick="window._addPresToCart('${escAttr(product.id)}', '${escAttr(p.id)}', 1, ${p.isLegacy ? 'true' : 'false'})" style="padding:12px;border:1px solid var(--outline);border-radius:8px;background:var(--surface-container);color:var(--on-surface);text-align:left;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
              <span style="font-weight:500">${esc(p.nombrePresentacion)} (x${p.factorConversion})</span>
              <span style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
                <span style="color:var(--primary);font-weight:700">Bs. ${parseFloat(p.precioVenta).toFixed(2)}</span>
                <span style="font-size:11px;color:var(--on-surface-variant)">Disponible: ${availPres}</span>
              </span>
            </button>`;
          }).join('')}
        </div>
        <button class="btn-ghost" style="width:100%" onclick="this.parentElement.parentElement.remove()">Cancelar</button>
      </div>`;
    document.body.appendChild(overlay);
  }

  function addPresToCart(productId, presId, qty, isLegacy = false) {
    const product = products.find(p => p.id === productId);
    const pres = isLegacy ? {
      id: productId,
      nombrePresentacion: "Unidad",
      factorConversion: 1,
      precioVenta: product.precio
    } : presentacionesCache.find(p => p.id === presId);

    const needs = qty * (pres.factorConversion || 1);
    const avail = availableUnitsForProduct(productId);
    if (needs > avail) {
      showToast(`Stock insuficiente para ${product.nombre}`, 'error');
      document.querySelector('.pres-selector-overlay')?.remove();
      return;
    }

    const existing = cart.find(item => item.presentacionId === presId);
    if (existing) {
      existing.cantidad += qty;
      existing.subtotal = existing.cantidad * existing.precioUnitario;
    } else {
      cart.push({
        productoId: productId,
        presentacionId: presId,
        nombre: product.nombre,
        presentacionNombre: pres.nombrePresentacion,
        cantidad: qty,
        precioUnitario: parseFloat(pres.precioVenta),
        subtotal: qty * parseFloat(pres.precioVenta),
      });
    }
    document.querySelector('.pres-selector-overlay')?.remove();
    renderCart();
  }
  window._addPresToCart = addPresToCart;

  function removeFromCart(index) {
    cart.splice(index, 1);
    renderCart();
  }

  function updateCartQty(index, delta) {
    if (delta > 0) {
      const item = cart[index];
      const needs = (item.cantidad + delta) * factorOf(item.presentacionId);
      // disponible = stock base − unidades de OTROS items del mismo producto
      const othersUnits = cart
        .filter(i => i.productoId === item.productoId && i.presentacionId !== item.presentacionId)
        .reduce((sum, i) => sum + i.cantidad * factorOf(i.presentacionId), 0);
      const avail = Math.max(0, baseStockOf(item.productoId) - othersUnits);
      if (needs > avail) {
        showToast(`Stock insuficiente para ${item.nombre}`, 'error');
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
  window._updateQty = updateCartQty;

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

    tbody.innerHTML = cart.map((item, index) => `
      <tr>
        <td class="text-center">
          <div style="display: flex; align-items: center; gap: 4px; justify-content: center;">
            <button onclick="window._updateQty(${index}, -1)" style="background:none;border:none;color:var(--on-surface-variant);cursor:pointer;padding:2px;font-size:16px;">−</button>
            <span class="qty-badge">${item.cantidad}</span>
            <button onclick="window._updateQty(${index}, 1)" style="background:none;border:none;color:var(--on-surface-variant);cursor:pointer;padding:2px;font-size:16px;">+</button>
          </div>
        </td>
        <td>
          <div class="item-name" title="${escAttr(item.nombre)}">
            ${esc(item.nombre)} <span style="color:var(--primary); font-size:11px;">(${esc(item.presentacionNombre)})</span>
          </div>
          <div class="item-unit-price">Bs. ${item.precioUnitario.toFixed(2)} c/u</div>
        </td>
        <td class="text-right" style="color: var(--on-surface);">Bs. ${item.subtotal.toFixed(2)}</td>
      </tr>
    `).join('');

    const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
    const tax = config.chargeIVA ? (subtotal * 0.16) : 0;
    const total = subtotal + tax;
    const totalItems = cart.reduce((sum, item) => sum + item.cantidad, 0);

    document.getElementById('subtotal').textContent = `Bs. ${subtotal.toFixed(2)}`;
    document.getElementById('tax').textContent = `Bs. ${tax.toFixed(2)}`;
    document.getElementById('grandTotal').textContent = `Bs. ${total.toFixed(2)}`;
    
    const ivaRow = document.getElementById('ivaRow');
    if (ivaRow) ivaRow.style.display = config.chargeIVA ? 'flex' : 'none';

    btnCheckout.disabled = false;
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      renderProducts(searchInput.value);
    }
    
    const badge = document.getElementById('mobileCartBadge');
    if (badge) badge.textContent = totalItems;
  }

  // ── Checkout ──
  async function checkout() {
    if (cart.length === 0) return;
    if (checkoutInProgress) return;

    checkoutInProgress = true;
    btnCheckout.disabled = true;

    try {
      // Red de seguridad: validar stock por producto antes de guardar/cerrar la venta
      const stockByProduct = {};
      for (const item of cart) {
        const pid = item.productoId;
        stockByProduct[pid] = (stockByProduct[pid] || 0) + item.cantidad * factorOf(item.presentacionId);
      }
      for (const pid in stockByProduct) {
        if (stockByProduct[pid] > baseStockOf(pid)) {
          const p = products.find(pr => pr.id === pid);
          showToast(`Stock insuficiente para ${p ? p.nombre : 'producto'}`, 'error');
          return;
        }
      }

      const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
      const tax = config.chargeIVA ? round2(subtotal * 0.16) : 0;
      const total = round2(subtotal + tax);

      const saleItems = cart.map(item => ({
        presentacionId: item.presentacionId,
        productoId: item.productoId,
        productoNombre: item.nombre,
        presentacionNombre: item.presentacionNombre,
        cantidad: item.cantidad,
        unidadesMinimas: item.cantidad * factorOf(item.presentacionId),
        precioUnitario: item.precioUnitario,
        subtotal: item.subtotal,
      }));

      // Stock local a descontar (unidades mínimas, con signo) — se persiste en IndexedDB
      const stockDeltas = {};
      saleItems.forEach(item => {
        stockDeltas[item.productoId] = (stockDeltas[item.productoId] || 0) - item.unidadesMinimas;
      });

      const sale = {
        id: OrvayayaDB.uuidv4(),
        items: saleItems,
        total: round2(total),
        created_at: new Date().toISOString(),
      };

      // Save to IndexedDB first (offline-first)
      await OrvayayaDB.savePendingSale(localDb, sale);

      // Decidir el destino de la venta: sincronizar online, o dejar pendiente (offline).
      // Si el servidor RECHAZA la venta explícitamente, revertir: sin descuento de stock,
      // sin PDF, sin overlay de éxito, y el ticket queda en pantalla para corregir.
      let serverRejected = false;
      let rejectionMessage = '';

      if (navigator.onLine && sucursalId) {
        try {
          const result = await OrvayayaAPI.syncSales(sucursalId, [sale], makeIdempotencyKey([sale]));

          if (result.errors && result.errors.length > 0) {
            // Rechazo del servidor: la venta NO ocurrió. Eliminar pendiente y NO descontar stock.
            serverRejected = true;
            rejectionMessage = result.errors[0].error || 'La venta fue rechazada por el servidor';
            for (const e of result.errors) {
              await OrvayayaDB.deletePendingSale(localDb, e.ventaId);
            }
            await updatePendingCount();
          } else if (result.synced_ids && result.synced_ids.length > 0) {
            await OrvayayaDB.markSalesSynced(localDb, result.synced_ids);
            await updatePendingCount();
            showToast('Venta sincronizada con el servidor ✓', 'success');
          }
        } catch (err) {
          // Falla de red: la venta queda pendiente y se sincronizará luego.
          showToast('Venta guardada localmente. Se sincronizará luego.', 'error');
          await updatePendingCount();
        }
      } else {
        showToast('Venta guardada localmente (offline). Se sincronizará cuando haya conexión.', 'error');
        await updatePendingCount();
      }

      if (serverRejected) {
        // Revertir: no descontar stock, no generar PDF, no vaciar el ticket.
        renderProducts(document.getElementById('searchInput').value);
        showErrorOverlay(rejectionMessage);
        return;
      }

      // Venta aceptada (o pendiente offline): descontar stock localmente y persistirlo en IndexedDB para evitar sobreventas offline
      for (const pid in stockDeltas) {
        const p = products.find(prod => prod.id === pid);
        if (p) p.stock = Math.max(0, (p.stock || 0) + stockDeltas[pid]);
      }
      await OrvayayaDB.applyLocalStockDeltas(localDb, stockDeltas);

      // Generate PDF ticket (non-blocking; failure must not abort checkout)
      if (config.autoPrintTicket) {
        setTimeout(() => {
          try {
            generateTicketPDF(sale, subtotal, tax, total);
          } catch (pdfErr) {
            console.error('Error generando ticket PDF:', pdfErr);
          }
        }, 0);
      }

      // Actualizar UI
      renderProducts(document.getElementById('searchInput').value);

      // Reset cart
      clearCart();

      // Show success overlay
      showSuccessOverlay(total, sale.items);
    } finally {
      checkoutInProgress = false;
      btnCheckout.disabled = cart.length === 0;
    }
  }

  function showSuccessOverlay(total, items = []) {
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

    const productRows = items.map(i => `
      <div style="display:flex; justify-content:space-between; gap:12px; padding:4px 0; border-bottom:1px solid var(--outline-variant,#ddd);">
        <span style="color:var(--on-surface); text-align:left;">
          ${esc(i.productoNombre)}
          ${i.presentacionNombre && i.presentacionNombre !== 'Unidad' ? `<small style="color:var(--on-surface-variant)"> · ${esc(i.presentacionNombre)}</small>` : ''}
          <strong>× ${i.cantidad}</strong>
        </span>
        <span style="color:var(--on-surface-variant); white-space:nowrap;">Bs. ${i.subtotal.toFixed(2)}</span>
      </div>`).join('');

    overlay.innerHTML = `
      <div style="background: var(--surface); padding: 24px; border-radius: 12px; text-align: center; max-width: 400px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <span class="material-symbols-outlined" style="font-size: 64px; color: #10b981; margin-bottom: 16px;">check_circle</span>
        <h2 style="margin: 0 0 4px 0; color: var(--on-surface);">¡Venta Realizada!</h2>
        <p style="color: var(--on-surface-variant); margin: 0 0 16px 0;">Ticket #TRX-${String(ticketNumber).padStart(6, '0')}</p>
        <p style="color: var(--on-surface-variant); margin: 0 0 8px 0; text-align:left;">Productos vendidos (${items.length}):</p>
        <div style="margin: 0 0 16px 0; text-align:left;">${productRows}</div>
        <p style="font-size: 24px; font-weight: bold; font-family: var(--font-mono); color: var(--primary); margin: 0 0 24px 0;">Bs. ${total.toFixed(2)}</p>
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

  // Overlay de rechazo: la venta NO fue registrada por el servidor.
  // El ticket queda intacto para que el cajero ajuste cantidades y reintente.
  function showErrorOverlay(message) {
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
      <div style="background: var(--surface); padding: 24px; border-radius: 12px; text-align: center; max-width: 400px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <span class="material-symbols-outlined" style="font-size: 64px; color: var(--error); margin-bottom: 16px;">error</span>
        <h2 style="margin: 0 0 4px 0; color: var(--on-surface);">Venta No Registrada</h2>
        <p style="color: var(--on-surface-variant); margin: 0 0 12px 0;">El servidor rechazó la venta. El ticket sigue en pantalla para corregir.</p>
        <div style="background: var(--error-container); color: var(--error); padding: 12px 16px; border-radius: 8px; font-size: 13px; text-align: left; margin: 0 0 20px 0;">${esc(message)}</div>
        <button class="btn-primary" id="btnCloseErrorOverlay" style="width: 100%; font-size: 16px; padding: 16px;">ENTENDIDO</button>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('btnCloseErrorOverlay').addEventListener('click', () => {
      overlay.remove();
      const search = document.getElementById('searchInput');
      if (search) {
        search.focus();
        renderProducts(search.value);
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
    doc.text('OROVAYAYA', pageWidth / 2, y, { align: 'center' });
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
    
    if (config.chargeIVA) {
      doc.text('IVA (16%):', leftMargin, y);
      doc.text(`Bs. ${tax.toFixed(2)}`, pageWidth - leftMargin, y, { align: 'right' });
      y += 4;
    }
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
    doc.text('Sistema Orovayaya v1.0', pageWidth / 2, y, { align: 'center' });

    // Save/open the PDF
    doc.save(`ticket_TRX-${String(ticketNumber).padStart(6, '0')}.pdf`);
  }

  // ── Sync ──
  async function autoSync() {
    if (!navigator.onLine || !sucursalId || !localDb || syncing) return;
    syncing = true;

    try {
      const pending = await OrvayayaDB.getPendingSales(localDb);
      if (pending.length === 0) return;

      const result = await OrvayayaAPI.syncSales(sucursalId, pending, makeIdempotencyKey(pending));
      if (result.synced_ids && result.synced_ids.length > 0) {
        await OrvayayaDB.markSalesSynced(localDb, result.synced_ids);
        showToast(`${result.synced_ids.length} ventas automáticas sincronizadas ✓`, 'success');
      }
      if (result.errors && result.errors.length > 0) {
        for (const e of result.errors) {
          await OrvayayaDB.markSaleFailed(localDb, e.ventaId, e.error);
        }
      }
      await updatePendingCount();
    } catch (err) {
      console.error('Auto-sync failed:', err);
    } finally {
      syncing = false;
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
      let hasErrors = false;
      let errorMsg = '';

      if (pending.length > 0) {
        const result = await OrvayayaAPI.syncSales(sucursalId, pending, makeIdempotencyKey(pending));
        
        if (result.synced_ids && result.synced_ids.length > 0) {
          await OrvayayaDB.markSalesSynced(localDb, result.synced_ids);
        }

        // Marcar ventas rechazadas con error (NO borrarlas — se pueden reintentar/conciliar)
        if (result.errors && result.errors.length > 0) {
          hasErrors = true;
          errorMsg = result.errors[0].error;
          for (const e of result.errors) {
            await OrvayayaDB.markSaleFailed(localDb, e.ventaId, e.error);
          }
        }

        await updatePendingCount();
      }

      // 2. Download fresh catalog & stock
      await loadCatalog();
      
      if (hasErrors) {
        showToast(`Se sincronizó el catálogo, pero el servidor rechazó una venta: ${errorMsg}`, 'error');
      } else {
        showToast('¡Catálogo y ventas sincronizados! ✓', 'success');
      }
    } catch (err) {
      console.error('Manual sync failed:', err);
      showToast('Error al sincronizar datos', 'error');
    }
  }

  async function updatePendingCount() {
    if (!localDb) return;
    const count = await OrvayayaDB.getPendingSalesCount(localDb);
    document.getElementById('pendingCount').textContent = count;

    // Auto-sync periódico ligero: solo corre mientras haya pendientes
    if (count > 0 && !syncTimer) {
      syncTimer = setInterval(() => {
        if (navigator.onLine) autoSync();
      }, 30000);
    } else if (count === 0 && syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
  }

  // ── Sync Modal (detalle de ventas pendientes) ──
  async function openSyncModal() {
    const modal = document.getElementById('syncModal');
    if (!modal) return;
    modal.style.display = 'flex';
    await renderSyncPendingList();
  }

  function closeSyncModal() {
    const modal = document.getElementById('syncModal');
    if (modal) modal.style.display = 'none';
  }

  async function renderSyncPendingList() {
    const listEl = document.getElementById('syncPendingList');
    const btnSyncNow = document.getElementById('btnSyncNow');
    if (!listEl) return;

    let pending = [];
    try {
      pending = await OrvayayaDB.getPendingSales(localDb);
    } catch (err) {
      console.error('Error cargando ventas pendientes:', err);
    }

    const pendingCount = document.getElementById('pendingCount');
    if (pendingCount) pendingCount.textContent = pending.length;

    if (btnSyncNow) btnSyncNow.style.display = pending.length > 0 ? '' : 'none';

    if (pending.length === 0) {
      listEl.innerHTML = `
        <div class="sync-empty">
          <span class="material-symbols-outlined" style="font-size:48px;color:var(--outline-variant)">sync_saved</span>
          <p>No hay ventas pendientes de sincronizar.</p>
        </div>`;
      return;
    }

    const fmtDate = (iso) => {
      if (!iso) return '—';
      try {
        return new Date(iso).toLocaleString('es-VE');
      } catch (e) {
        return iso;
      }
    };

    listEl.innerHTML = pending.map((sale) => {
      const items = (sale.items || []).map((item) => `
        <div class="sync-item-row">
          <span class="sync-item-name">${esc(item.productoNombre || item.nombre || 'Producto')}
            ${item.presentacionNombre && item.presentacionNombre !== 'Unidad' ? `<small>· ${esc(item.presentacionNombre)}</small>` : ''}
          </span>
          <span class="sync-item-qty">${item.cantidad} × Bs. ${parseFloat(item.precioUnitario).toFixed(2)}</span>
          <span class="sync-item-subtotal">Bs. ${parseFloat(item.subtotal).toFixed(2)}</span>
        </div>`).join('');

      return `
        <div class="sync-sale">
          <div class="sync-sale-header">
            <div class="sync-sale-info">
              <span class="material-symbols-outlined" style="font-size:18px;color:var(--primary)">receipt_long</span>
              <div>
                <div class="sync-sale-date">${fmtDate(sale.created_at || sale.createdAt)}</div>
                <div class="sync-sale-meta">${items.length ? items.length : 0} ítem(s)</div>
              </div>
            </div>
            <div class="sync-sale-total">Bs. ${parseFloat(sale.total).toFixed(2)}</div>
            <button class="sync-sale-delete" onclick="window._deletePendingSale('${escAttr(sale.id)}')" title="Eliminar venta pendiente">
              <span class="material-symbols-outlined" style="font-size:18px">delete</span>
            </button>
          </div>
          ${sale.syncError ? `<div class="sync-sale-error">
            <span class="material-symbols-outlined" style="font-size:16px">warning</span>
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(sale.syncError)}</span>
          </div>` : ''}
          ${items}
        </div>`;
    }).join('');
  }

  window._deletePendingSale = async (id) => {
    if (!confirm('¿Eliminar esta venta pendiente? No se podrá sincronizar.')) return;
    try {
      const sale = await OrvayayaDB.getPendingSaleById(localDb, id);
      await OrvayayaDB.deletePendingSale(localDb, id);

      // La venta no ocurrió: devolver sus unidades al stock local (memoria + IndexedDB)
      if (sale && sale.items) {
        const restoreDeltas = {};
        for (const item of sale.items) {
          const units = item.unidadesMinimas ?? 0;
          if (item.productoId && units > 0) {
            restoreDeltas[item.productoId] = (restoreDeltas[item.productoId] || 0) + units;
          }
        }
        await OrvayayaDB.applyLocalStockDeltas(localDb, restoreDeltas);
        for (const pid in restoreDeltas) {
          const p = products.find(prod => prod.id === pid);
          if (p) p.stock = Math.max(0, (p.stock || 0) + restoreDeltas[pid]);
        }
        const searchInput = document.getElementById('searchInput');
        renderProducts(searchInput ? searchInput.value : '');
      }

      await renderSyncPendingList();
      await updatePendingCount();
      showToast('Venta pendiente eliminada', 'success');
    } catch (err) {
      console.error('Error eliminando venta pendiente:', err);
      showToast('No se pudo eliminar la venta pendiente', 'error');
    }
  };

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
    toast.innerHTML = `<span class="material-symbols-outlined" style="font-size: 18px;">${type === 'success' ? 'check_circle' : 'warning'}</span>${esc(message)}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // ── Event Listeners ──
  function setupEventListeners() {
    // Mobile Layout Events
    document.getElementById('btnMobileMenu')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('mobile-open');
    });
    document.getElementById('btnMobileCart')?.addEventListener('click', () => {
      document.querySelector('.pos-layout').classList.add('show-ticket');
    });
    document.getElementById('btnCloseTicket')?.addEventListener('click', () => {
      document.querySelector('.pos-layout').classList.remove('show-ticket');
    });

    // Sidebar view switching
    document.getElementById('linkVenta')?.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('venta');
      document.getElementById('sidebar')?.classList.remove('mobile-open');
    });
    document.getElementById('linkInventario')?.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('inventario');
      document.getElementById('sidebar')?.classList.remove('mobile-open');
    });
    document.getElementById('invSearch')?.addEventListener('input', (e) => {
      renderInventory(e.target.value);
    });

    // Product card clicks
    document.getElementById('productGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.product-card');
      if (!card) return;

      if ((parseInt(card.dataset.stock) || 0) <= 0) {
        showToast('Producto sin stock', 'error');
        return;
      }

      const presBtn = e.target.closest('.product-pres');
      
      if (presBtn) {
        // Open modal for presentations
        openPresentacionSelector(card.dataset.id);
      } else {
        // Quick add 1 base unit directly
        addPresToCart(card.dataset.id, card.dataset.id, 1, true); // true = legacy base unit
      }
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
    document.getElementById('btnSync').addEventListener('click', openSyncModal);
    const sidebarSync = document.getElementById('btnSyncSidebar');
    if (sidebarSync) sidebarSync.addEventListener('click', openSyncModal);

    // Sync Modal
    const syncModal = document.getElementById('syncModal');
    const btnCloseSyncModal = document.getElementById('btnCloseSyncModal');
    const btnCancelSync = document.getElementById('btnCancelSync');
    const btnSyncNow = document.getElementById('btnSyncNow');

    btnCloseSyncModal?.addEventListener('click', closeSyncModal);
    btnCancelSync?.addEventListener('click', closeSyncModal);
    if (syncModal) {
      syncModal.addEventListener('click', (e) => {
        if (e.target === syncModal) closeSyncModal();
      });
    }
    btnSyncNow?.addEventListener('click', async () => {
      btnSyncNow.disabled = true;
      try {
        await manualSync();
        await renderSyncPendingList();
        await updatePendingCount();
        const remaining = await OrvayayaDB.getPendingSalesCount(localDb);
        if (remaining === 0) closeSyncModal();
      } finally {
        btnSyncNow.disabled = false;
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && syncModal && syncModal.style.display === 'flex') closeSyncModal();
    });

    // Settings Modal
    const btnSettings = document.getElementById('btnSettings');
    const settingsModal = document.getElementById('settingsModal');
    const btnCloseSettings = document.getElementById('btnCloseSettings');
    const btnCancelSettings = document.getElementById('btnCancelSettings');
    const btnSaveSettings = document.getElementById('btnSaveSettings');

    btnSettings?.addEventListener('click', () => { settingsModal.style.display = 'flex'; });
    btnCloseSettings?.addEventListener('click', () => { settingsModal.style.display = 'none'; });
    btnCancelSettings?.addEventListener('click', () => { settingsModal.style.display = 'none'; });
    
    btnSaveSettings?.addEventListener('click', async () => {
      config.chargeIVA = document.getElementById('toggleIva').checked;
      config.autoPrintTicket = document.getElementById('togglePdf').checked;
      
      await OrvayayaDB.saveConfig(localDb, 'chargeIVA', config.chargeIVA);
      await OrvayayaDB.saveConfig(localDb, 'autoPrintTicket', config.autoPrintTicket);
      
      settingsModal.style.display = 'none';
      renderCart(); // Recalculate totals with new IVA rule
      showToast('Ajustes guardados ✓', 'success');
    });
  }

  // Expose for inline onclick handlers
  window.posApp = {
    updateQty: updateCartQty,
    removeItem: removeFromCart,
  };

  // ── Start ──
  init();
})();
