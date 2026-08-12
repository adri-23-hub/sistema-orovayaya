/**
 * Admin SPA — app.js
 * Handles all sections: Dashboard, Usuarios, Roles, Proveedores,
 * Categorías, Marcas, Productos, Inventario, Movimientos,
 * Historial Costos, Ventas
 */

(function () {
  'use strict';

  // ── Auth guard ── Tarea 4.1: solo admin puede acceder al panel
  const currentUser = OrvayayaAPI.getUser();
  if (!currentUser || !OrvayayaAPI.getToken() || currentUser.rol !== 'admin') {
    window.location.href = '/login.html';
    return;
  }

  document.getElementById('sidebarUser').textContent = currentUser.nombre || 'Admin';

  // ── Router ──
  let activeSection = '';

  function navigate(section) {
    activeSection = section;
    
    // Update URL hash
    if (window.location.hash !== `#${section}`) {
      window.history.pushState(null, '', `#${section}`);
    }

    // Update sidebar active state
    document.querySelectorAll('.nav-item[data-section]').forEach(el => {
      el.classList.toggle('active', el.dataset.section === section);
    });
    renderSection(section);
  }

  // ── Section Renderer ──
  async function renderSection(section) {
    const wrapper = document.getElementById('contentWrapper');
    wrapper.innerHTML = `<div class="loading-state" style="padding:60px;text-align:center">
      <span class="material-symbols-outlined spin" style="font-size:32px;color:var(--primary)">sync</span>
    </div>`;

    try {
      switch (section) {
        case 'dashboard':        await renderDashboard(wrapper); break;
        case 'usuarios':          await renderUsuarios(wrapper); break;
        case 'roles':             renderRoles(wrapper); break;
        case 'proveedores':       await renderCatalogSection(wrapper, 'proveedores'); break;
        case 'categorias':        await renderCatalogSection(wrapper, 'categorias'); break;
        case 'marcas':            await renderCatalogSection(wrapper, 'marcas'); break;
        case 'productos':         await renderProductos(wrapper); break;
        case 'inventario':        await renderInventario(wrapper); break;
        case 'movimientos':       await renderMovimientos(wrapper); break;
        case 'historial-costos':  await renderHistorialCostos(wrapper); break;
        case 'ventas':            await renderVentas(wrapper); break;
        case 'reporte-ventas':    await renderReporteVentas(wrapper); break;   // Tarea 3.2.2
        case 'reporte-ganancias': await renderReporteGanancias(wrapper); break; // Tarea 3.2.2
        default:             wrapper.innerHTML = `<p style="padding:32px;color:var(--on-surface-variant)">Sección no encontrada.</p>`;
      }
    } catch (err) {
      wrapper.innerHTML = `<div class="page-header"><div><h1 class="page-title" style="color:var(--error)">Error cargando sección</h1><p class="page-subtitle">${esc(err.message)}</p></div></div>`;
    }
  }

  // ═══════════════════════════════════
  //  DASHBOARD
  // ═══════════════════════════════════
  async function renderDashboard(wrapper) {
    const summary = await OrvayayaAPI.getDashboardSummary();
    const globalInv = await OrvayayaAPI.getGlobalInventory();

    wrapper.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Panel Central de Administración</h1>
          <p class="page-subtitle">Resumen de operaciones y estado de inventario.</p>
        </div>
        <button class="btn-primary" id="btnEnviarMercaderia">
          <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1">local_shipping</span>
          ENVIAR A OROVAYAYA
        </button>
      </div>
      <div class="kpi-grid">
        <div class="kpi-card" data-accent="primary">
          <div class="kpi-bg-icon"><span class="material-symbols-outlined">payments</span></div>
          <span class="kpi-label">Ventas Totales Hoy</span>
          <span class="kpi-value">Bs. ${parseFloat(summary.ventas_totales || 0).toLocaleString('es-VE', { minimumFractionDigits: 0 })}</span>
          <div class="kpi-trend positive">
            <span class="material-symbols-outlined" style="font-size:16px">trending_up</span>
            <span>${summary.cantidad_ventas} ventas hoy</span>
          </div>
        </div>
        <div class="kpi-card" data-accent="error">
          <div class="kpi-bg-icon"><span class="material-symbols-outlined">warning</span></div>
          <span class="kpi-label">Alertas Stock Bajo</span>
          <span class="kpi-value" style="color:var(--error)">${summary.alertas_stock_bajo}</span>
          <div class="kpi-trend error"><span>${summary.alertas_stock_bajo > 0 ? 'Requiere atención' : 'Sin alertas'}</span></div>
        </div>
      </div>
      <div class="data-table-container">
        <div class="table-toolbar">
          <h2 class="table-title"><span class="material-symbols-outlined" style="color:var(--primary)">inventory_2</span> Vista Global de Inventario</h2>
          <div class="table-actions">
            <div class="search-box">
              <span class="material-symbols-outlined search-icon">search</span>
              <input type="text" class="search-input" id="dashSearch" placeholder="Buscar SKU, producto...">
            </div>
          </div>
        </div>
        <div class="table-scroll">
          <table class="data-table zebra-table">
            <thead><tr>
              <th>Producto</th><th>Categoría</th>
              <th class="text-right">Ciudad</th>
              <th class="text-right">Pueblo</th>
              <th class="text-center">Estado</th>
            </tr></thead>
            <tbody id="dashInvBody"></tbody>
          </table>
        </div>
        <div class="table-footer"><span id="dashInvInfo">—</span></div>
      </div>`;

    let allData = globalInv;
    renderInvTable(allData);

    document.getElementById('dashSearch').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      renderInvTable(q ? allData.filter(i => i.productoNombre.toLowerCase().includes(q) || i.productoSku.toLowerCase().includes(q)) : allData);
    });

    document.getElementById('btnEnviarMercaderia').addEventListener('click', () => openPlanillaModal(globalInv, 'envio', [], [], { afterSection: 'dashboard' }));
  }

  function renderInvTable(data) {
    const tbody = document.getElementById('dashInvBody');
    const info = document.getElementById('dashInvInfo');
    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="loading-row">Sin datos</td></tr>`;
      info.textContent = '0 registros';
      return;
    }
    tbody.innerHTML = data.map(item => {
      const min = Math.min(item.stockCiudad, item.stockPueblo);
      const [cls, txt] = min === 0 ? ['out','Agotado'] : min < 5 ? ['low','Bajo'] : ['optimal','Óptimo'];
      const cc = item.stockCiudad < 5 ? (item.stockCiudad === 0 ? 'stock-out' : 'stock-low') : '';
      const cp = item.stockPueblo < 5 ? (item.stockPueblo === 0 ? 'stock-out' : 'stock-low') : '';
      return `<tr>
        <td><div class="product-cell"><span class="product-sku">${esc(item.productoSku)}</span><span>${esc(item.productoNombre)}</span></div></td>
        <td style="color:var(--on-surface-variant)">${esc(item.categoria || '—')}</td>
        <td class="text-right ${cc}">${item.stockCiudad}</td>
        <td class="text-right ${cp}">${item.stockPueblo}</td>
        <td class="text-center"><div class="status-badge ${cls}"><div class="dot"></div><span>${txt}</span></div></td>
      </tr>`;
    }).join('');
    info.textContent = `${data.length} registros`;
  }

  // ─── Planilla multirregistro ─────────────────────────────────
  // mode: 'ingreso' (a Ciudad) | 'envio' (a Orovayaya)
  function openPlanillaModal(globalInv, mode, branches = [], proveedores = [], opts = {}) {
    const { preselectedProductoId = null, afterSection = 'inventario' } = opts;
    const isIngreso = mode === 'ingreso';
    const ciudadBranch = branches.find(b => b.tipo === 'ciudad');

    const presMap = new Map();
    OrvayayaAPI.getPresentaciones().then(list => {
      (list || []).forEach(p => {
        if (!presMap.has(p.productoId)) presMap.set(p.productoId, []);
        presMap.get(p.productoId).push(p);
      });
    }).catch(() => {});

    const productsFor = isIngreso ? globalInv : globalInv.filter(i => i.stockCiudad > 0);
    const prodOpts = productsFor.map(i =>
      `<option value="${i.productoId}" ${preselectedProductoId === i.productoId ? 'selected' : ''}>${esc(i.productoSku)} — ${esc(i.productoNombre)} (Ciudad: ${i.stockCiudad})</option>`
    ).join('');

    const provOpts = (proveedores || []).map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
    const provCol = isIngreso ? '<th class="pl-col-proveedor">Proveedor</th>' : '';
    const provCell = isIngreso
      ? `<td class="pl-col-proveedor" data-label="Proveedor"><select class="form-select plProveedor"><option value="">— Sin proveedor —</option>${provOpts}</select></td>`
      : '';

    openModal(isIngreso ? 'Ingreso de Mercadería (Ciudad)' : 'Enviar a Orovayaya', `
      ${isIngreso ? `<div class="form-group">
        <label class="form-label">Nota / Referencia (opcional)</label>
        <input type="text" class="form-input" id="plNota" placeholder="Ej: Factura #123">
      </div>` : ''}
      <div class="planilla-summary" id="plSummary">0 productos · 0 unidades</div>
      <div class="planilla-table-wrap">
        <table class="planilla-table">
          <thead><tr>
            <th class="pl-col-prod">Producto</th>
            <th class="pl-col-pres">Presentación</th>
            <th class="pl-col-qty">Cant.</th>
            ${provCol}
            <th class="pl-col-units">Unidades</th>
            <th class="pl-col-del"></th>
          </tr></thead>
          <tbody id="plBody"></tbody>
        </table>
      </div>
      <button class="btn-ghost" id="plAdd" style="margin-top:12px;width:100%">
        <span class="material-symbols-outlined" style="font-size:18px">add</span> AGREGAR PRODUCTO
      </button>`,
      `<button class="btn-ghost" onclick="closeModal()">CANCELAR</button>
       <button class="btn-primary" id="btnConfirmPlanilla" style="min-width:160px">
         <span class="material-symbols-outlined" style="font-size:18px">check_circle</span> CONFIRMAR
       </button>`
    );
    setModalWide(true);

    const tbody = document.getElementById('plBody');
    let rowCounter = 0;

    function fillPresentaciones(sel, productoId, selectedId) {
      const pres = presMap.get(productoId) || [];
      sel.innerHTML = '<option value="">Unidad (x1)</option>' + pres.map(p =>
        `<option value="${p.id}" data-factor="${p.factorConversion}">${esc(p.nombrePresentacion)} (x${p.factorConversion})</option>`
      ).join('');
      if (selectedId) sel.value = selectedId;
    }

    function unidadesDeRow(row) {
      const pres = row.querySelector('.plPresentacion');
      const factor = parseInt(pres.selectedOptions[0]?.dataset.factor) || 1;
      const qty = parseInt(row.querySelector('.plCantidad').value) || 0;
      return { factor, qty, unidades: qty * factor };
    }

    function updateSummary() {
      const rows = [...tbody.querySelectorAll('.planilla-row')].filter(r => r.querySelector('.plProducto').value);
      let totalUnidades = 0;
      rows.forEach(r => {
        const u = unidadesDeRow(r);
        r.querySelector('.plUnidades').textContent = u.unidades;
        totalUnidades += u.unidades;
      });
      document.getElementById('plSummary').textContent =
        `${rows.length} producto${rows.length === 1 ? '' : 's'} · ${totalUnidades} unidades`;
    }

    function addRow(productoIdPreselect = null) {
      const tr = document.createElement('tr');
      tr.className = 'planilla-row';
      tr.dataset.row = rowCounter++;
      tr.innerHTML = `
        <td class="pl-col-prod" data-label="Producto"><select class="form-select plProducto"><option value="">— Seleccionar —</option>${prodOpts}</select></td>
        <td class="pl-col-pres" data-label="Presentación"><select class="form-select plPresentacion"><option value="">Unidad (x1)</option></select></td>
        <td class="pl-col-qty" data-label="Cant."><input type="number" class="form-input plCantidad" min="1" value="1"></td>
        ${provCell}
        <td class="pl-col-units pl-unidad-valor" data-label="Unidades">1</td>
        <td class="pl-col-del" data-label=""><button class="btn-action-sm plRemove" title="Quitar" type="button"><span class="material-symbols-outlined" style="font-size:16px">close</span></button></td>`;
      tbody.appendChild(tr);

      const prodSel = tr.querySelector('.plProducto');
      const presSel = tr.querySelector('.plPresentacion');
      prodSel.addEventListener('change', () => {
        if (!prodSel.value) { presSel.innerHTML = '<option value="">Unidad (x1)</option>'; updateSummary(); return; }
        fillPresentaciones(presSel, prodSel.value);
        updateSummary();
      });
      presSel.addEventListener('change', updateSummary);
      tr.querySelector('.plCantidad').addEventListener('input', updateSummary);
      tr.querySelector('.plRemove').addEventListener('click', () => { tr.remove(); updateSummary(); });

      if (productoIdPreselect) {
        prodSel.value = productoIdPreselect;
        fillPresentaciones(presSel, productoIdPreselect);
      }
      updateSummary();
    }

    document.getElementById('plAdd').addEventListener('click', () => addRow());
    addRow(preselectedProductoId);

    document.getElementById('btnConfirmPlanilla').addEventListener('click', async () => {
      const rows = [...tbody.querySelectorAll('.planilla-row')];
      const items = [];
      let totalUnidades = 0;
      let errores = 0;
      rows.forEach(r => {
        const pid = r.querySelector('.plProducto').value;
        const qty = parseInt(r.querySelector('.plCantidad').value) || 0;
        if (!pid) return;
        if (qty <= 0) { errores++; return; }
        const u = unidadesDeRow(r);
        totalUnidades += u.unidades;
        const presentacion_id = r.querySelector('.plPresentacion').value || undefined;
        const proveedor_id = isIngreso ? (r.querySelector('.plProveedor')?.value || undefined) : undefined;
        items.push({ producto_id: pid, presentacion_id, cantidad: qty, ...(proveedor_id ? { proveedor_id } : {}) });
      });

      if (errores > 0) return showToast('Corrige las cantidades (deben ser > 0)', 'error');
      if (items.length === 0) return showToast('Agrega al menos un producto válido', 'error');

      const btn = document.getElementById('btnConfirmPlanilla');
      btn.disabled = true;
      btn.textContent = 'Procesando...';
      try {
        if (isIngreso) {
          const nota = document.getElementById('plNota')?.value.trim() || undefined;
          await OrvayayaAPI.adjustBatch({ sucursal_id: ciudadBranch.id, nota, items });
        } else {
          await OrvayayaAPI.transferBatch({ items });
        }
        showToast(`${isIngreso ? 'Ingreso' : 'Envío a Orovayaya'} registrado: ${items.length} líneas · ${totalUnidades} unidades`, 'success');
        closeModal();
        setModalWide(false);
        navigate(afterSection);
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px">check_circle</span> CONFIRMAR';
      }
    });
  }

  // ═══════════════════════════════════
  //  USUARIOS
  // ═══════════════════════════════════
  async function renderUsuarios(wrapper) {
    const users = await apiFetch('/usuarios');
    wrapper.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">Usuarios</h1><p class="page-subtitle">Gestión de cuentas de acceso al sistema.</p></div>
        <button class="btn-primary" id="btnNewUser">
          <span class="material-symbols-outlined">person_add</span> NUEVO USUARIO
        </button>
      </div>
      <div class="data-table-container">
        <div class="table-toolbar"><h2 class="table-title"><span class="material-symbols-outlined" style="color:var(--primary)">group</span> Lista de Usuarios</h2></div>
        <div class="table-scroll">
          <table class="data-table zebra-table">
            <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Creado</th><th class="text-center">Acciones</th></tr></thead>
            <tbody id="usersBody"></tbody>
          </table>
        </div>
      </div>`;

    renderUsersTable(users);

    document.getElementById('btnNewUser').addEventListener('click', () => openUserModal(null, users));
  }

  function renderUsersTable(users) {
    const tbody = document.getElementById('usersBody');
    if (!users.length) { tbody.innerHTML = `<tr><td colspan="5" class="loading-row">Sin usuarios</td></tr>`; return; }
    tbody.innerHTML = users.map(u => `
      <tr>
        <td>${esc(u.nombre)}</td>
        <td style="font-family:var(--font-mono);font-size:13px">${esc(u.email)}</td>
        <td><span class="status-badge ${u.rol === 'admin' ? 'optimal' : 'low'}"><div class="dot"></div>${esc(u.rol)}</span></td>
        <td style="color:var(--on-surface-variant);font-size:12px">${new Date(u.createdAt).toLocaleDateString('es-VE')}</td>
        <td class="text-center">
          <button class="btn-action-sm" onclick="window._editUser('${escAttr(u.id)}')">
            <span class="material-symbols-outlined" style="font-size:16px">edit</span>
          </button>
          <button class="btn-action-sm danger" onclick="window._deleteUser('${escAttr(u.id)}','${escAttr(u.nombre)}')">
            <span class="material-symbols-outlined" style="font-size:16px">delete</span>
          </button>
        </td>
      </tr>`).join('');
  }

  function openUserModal(user, existingUsers) {
    const isEdit = !!user;
    openModal(isEdit ? 'Editar Usuario' : 'Nuevo Usuario', `
      <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="uNombre" value="${escAttr(user?.nombre || '')}" placeholder="Nombre completo"></div>
      <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="uEmail" type="email" value="${escAttr(user?.email || '')}" placeholder="correo@ejemplo.com"></div>
      <div class="form-group"><label class="form-label">Rol</label>
        <select class="form-select" id="uRol">
          <option value="cajero" ${user?.rol === 'cajero' ? 'selected' : ''}>Cajero</option>
          <option value="admin" ${user?.rol === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">${isEdit ? 'Nueva Contraseña (dejar vacío para no cambiar)' : 'Contraseña'}</label><input class="form-input" id="uPassword" type="password" placeholder="••••••••"></div>`,
      `<button class="btn-ghost" onclick="closeModal()">CANCELAR</button>
       <button class="btn-primary" id="btnSaveUser">GUARDAR</button>`
    );
    document.getElementById('btnSaveUser').addEventListener('click', async () => {
      const nombre = document.getElementById('uNombre').value.trim();
      const email = document.getElementById('uEmail').value.trim();
      const rol = document.getElementById('uRol').value;
      const password = document.getElementById('uPassword').value;
      if (!nombre || !email) return showToast('Nombre y email son requeridos', 'error');
      try {
        if (isEdit) {
          const body = { nombre, email, rol };
          if (password) body.password = password;
          await apiFetch(`/usuarios/${user.id}`, { method: 'PUT', body: JSON.stringify(body) });
          showToast('Usuario actualizado', 'success');
        } else {
          if (!password) return showToast('La contraseña es requerida', 'error');
          await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify({ nombre, email, rol, password }) });
          showToast('Usuario creado', 'success');
        }
        closeModal();
        navigate('usuarios');
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  window._editUser = async (id) => {
    const user = await apiFetch(`/usuarios/${id}`);
    openUserModal(user, []);
  };

  window._deleteUser = (id, nombre) => {
    openModal('Confirmar Eliminación',
      `<p style="color:var(--on-surface)">¿Eliminar al usuario <strong>${esc(nombre)}</strong>? Esta acción no se puede deshacer.</p>`,
      `<button class="btn-ghost" onclick="closeModal()">CANCELAR</button>
       <button class="btn-primary" style="background:var(--error-container);color:var(--error)" id="btnConfirmDel">ELIMINAR</button>`
    );
    document.getElementById('btnConfirmDel').addEventListener('click', async () => {
      try {
        await apiFetch(`/usuarios/${id}`, { method: 'DELETE' });
        showToast('Usuario eliminado', 'success');
        closeModal();
        navigate('usuarios');
      } catch (err) { showToast(err.message, 'error'); }
    });
  };

  // ═══════════════════════════════════
  //  ROLES (informational)
  // ═══════════════════════════════════
  function renderRoles(wrapper) {
    wrapper.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">Roles del Sistema</h1><p class="page-subtitle">Permisos por rol definidos en el sistema.</p></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">
        ${[
          { rol: 'admin', icon: 'shield_person', color: 'var(--primary)', permisos: ['Acceso total al Dashboard Admin','Crear / editar / eliminar productos','Gestionar usuarios','Realizar transferencias de stock','Ver historial de costos y movimientos','Crear categorías, marcas y proveedores'] },
          { rol: 'cajero', icon: 'point_of_sale', color: 'var(--secondary)', permisos: ['Acceso al módulo POS','Consultar catálogo de productos','Registrar ventas','Ver inventario de su sucursal','Sincronizar ventas offline'] },
        ].map(r => `
          <div class="data-table-container" style="padding:0">
            <div class="table-toolbar">
              <h2 class="table-title" style="color:${r.color}">
                <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1">${r.icon}</span>
                ${r.rol.toUpperCase()}
              </h2>
            </div>
            <ul style="padding:16px 24px;display:flex;flex-direction:column;gap:8px">
              ${r.permisos.map(p => `<li style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--on-surface)">
                <span class="material-symbols-outlined" style="font-size:16px;color:${r.color};font-variation-settings:'FILL' 1">check_circle</span>${p}
              </li>`).join('')}
            </ul>
          </div>`).join('')}
      </div>`;
  }

  // ═══════════════════════════════════
  //  GENERIC CATALOG (Proveedores / Categorias / Marcas)
  // ═══════════════════════════════════
  const CATALOG_CONFIG = {
    proveedores: {
      title: 'Proveedores', icon: 'local_shipping', subtitle: 'Gestión de proveedores del negocio.',
      endpoint: 'proveedores', singularLabel: 'Proveedor',
      columns: ['Nombre','Contacto','Teléfono','Email'],
      getRow: r => [r.nombre, r.contacto||'—', r.telefono||'—', r.email||'—'],
      formFields: () => `
        <div class="form-group"><label class="form-label">Nombre *</label><input class="form-input" id="fNombre" placeholder="Nombre del proveedor"></div>
        <div class="form-group"><label class="form-label">Contacto</label><input class="form-input" id="fContacto" placeholder="Persona de contacto"></div>
        <div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" id="fTelefono" placeholder="+58 412 000 0000"></div>
        <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="fEmail" type="email" placeholder="proveedor@ejemplo.com"></div>
        <div class="form-group"><label class="form-label">Dirección</label><input class="form-input" id="fDireccion" placeholder="Dirección"></div>`,
      getFormData: () => ({ nombre: document.getElementById('fNombre').value.trim(), contacto: document.getElementById('fContacto').value.trim(), telefono: document.getElementById('fTelefono').value.trim(), email: document.getElementById('fEmail').value.trim(), direccion: document.getElementById('fDireccion').value.trim() }),
      fillForm: r => { document.getElementById('fNombre').value = r.nombre||''; document.getElementById('fContacto').value = r.contacto||''; document.getElementById('fTelefono').value = r.telefono||''; document.getElementById('fEmail').value = r.email||''; document.getElementById('fDireccion').value = r.direccion||''; },
      validate: d => d.nombre ? null : 'Nombre es requerido',
    },
    categorias: {
      title: 'Categorías', icon: 'label', subtitle: 'Categorías para clasificar los productos.',
      endpoint: 'categorias', singularLabel: 'Categoría',
      columns: ['Nombre','Descripción'],
      getRow: r => [r.nombre, r.descripcion||'—'],
      formFields: () => `
        <div class="form-group"><label class="form-label">Nombre *</label><input class="form-input" id="fNombre" placeholder="Nombre de la categoría"></div>
        <div class="form-group"><label class="form-label">Descripción</label><input class="form-input" id="fDesc" placeholder="Descripción opcional"></div>`,
      getFormData: () => ({ nombre: document.getElementById('fNombre').value.trim(), descripcion: document.getElementById('fDesc').value.trim() }),
      fillForm: r => { document.getElementById('fNombre').value = r.nombre||''; document.getElementById('fDesc').value = r.descripcion||''; },
      validate: d => d.nombre ? null : 'Nombre es requerido',
    },
    marcas: {
      title: 'Marcas', icon: 'sell', subtitle: 'Gestión de marcas de los productos.',
      endpoint: 'marcas', singularLabel: 'Marca',
      columns: ['Nombre','Descripción'],
      getRow: r => [r.nombre, r.descripcion||'—'],
      formFields: () => `
        <div class="form-group"><label class="form-label">Nombre *</label><input class="form-input" id="fNombre" placeholder="Nombre de la marca"></div>
        <div class="form-group"><label class="form-label">Descripción</label><input class="form-input" id="fDesc" placeholder="Descripción opcional"></div>`,
      getFormData: () => ({ nombre: document.getElementById('fNombre').value.trim(), descripcion: document.getElementById('fDesc').value.trim() }),
      fillForm: r => { document.getElementById('fNombre').value = r.nombre||''; document.getElementById('fDesc').value = r.descripcion||''; },
      validate: d => d.nombre ? null : 'Nombre es requerido',
    },
  };

  async function renderCatalogSection(wrapper, key) {
    const cfg = CATALOG_CONFIG[key];
    const data = await apiFetch(`/${cfg.endpoint}`);
    wrapper.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">${cfg.title}</h1><p class="page-subtitle">${cfg.subtitle}</p></div>
        <button class="btn-primary" id="btnNew${key}">
          <span class="material-symbols-outlined">add</span> NUEVO
        </button>
      </div>
      <div class="data-table-container">
        <div class="table-toolbar">
          <h2 class="table-title"><span class="material-symbols-outlined" style="color:var(--primary)">${cfg.icon}</span> ${cfg.title}</h2>
          <div class="search-box"><span class="material-symbols-outlined search-icon">search</span><input type="text" class="search-input" id="search${key}" placeholder="Buscar..."></div>
        </div>
        <div class="table-scroll">
          <table class="data-table zebra-table">
            <thead><tr>${cfg.columns.map(c => `<th>${c}</th>`).join('')}<th class="text-center" style="width:100px">Acciones</th></tr></thead>
            <tbody id="tbody${key}"></tbody>
          </table>
        </div>
        <div class="table-footer"><span id="info${key}">${data.length} registros</span></div>
      </div>`;

    let allData = data;
    renderCatalogTable(key, allData, cfg);

    document.getElementById(`search${key}`).addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      renderCatalogTable(key, q ? allData.filter(r => r.nombre.toLowerCase().includes(q)) : allData, cfg);
    });

    document.getElementById(`btnNew${key}`).addEventListener('click', () => openCatalogModal(key, null, cfg));

    window[`_edit_${key}`] = async (id) => {
      const row = allData.find(r => r.id === id);
      if (row) openCatalogModal(key, row, cfg);
    };

    window[`_delete_${key}`] = (id, nombre) => {
      openModal(`Eliminar ${cfg.singularLabel}`,
        `<p style="color:var(--on-surface)">¿Eliminar <strong>${nombre}</strong>?</p>`,
        `<button class="btn-ghost" onclick="closeModal()">CANCELAR</button>
         <button class="btn-primary" style="background:var(--error-container);color:var(--error)" id="btnDelConfirm">ELIMINAR</button>`
      );
      document.getElementById('btnDelConfirm').addEventListener('click', async () => {
        try {
          await apiFetch(`/${cfg.endpoint}/${id}`, { method: 'DELETE' });
          showToast(`${cfg.singularLabel} eliminado`, 'success');
          closeModal();
          navigate(key);
        } catch (err) { showToast(err.message, 'error'); }
      });
    };
  }

  function renderCatalogTable(key, data, cfg) {
    const tbody = document.getElementById(`tbody${key}`);
    const info = document.getElementById(`info${key}`);
    if (!data.length) { tbody.innerHTML = `<tr><td colspan="${cfg.columns.length + 1}" class="loading-row">Sin registros</td></tr>`; return; }
    tbody.innerHTML = data.map(r => `
      <tr>
        ${cfg.getRow(r).map(v => `<td>${esc(v)}</td>`).join('')}
        <td class="text-center">
          <button class="btn-action-sm" onclick="window._edit_${key}('${escAttr(r.id)}')">
            <span class="material-symbols-outlined" style="font-size:16px">edit</span>
          </button>
          <button class="btn-action-sm danger" onclick="window._delete_${key}('${escAttr(r.id)}','${escAttr(r.nombre)}')">
            <span class="material-symbols-outlined" style="font-size:16px">delete</span>
          </button>
        </td>
      </tr>`).join('');
    if (info) info.textContent = `${data.length} registros`;
  }

  function openCatalogModal(key, row, cfg) {
    const isEdit = !!row;
    openModal(`${isEdit ? 'Editar' : 'Nuevo'} ${cfg.singularLabel}`, cfg.formFields(),
      `<button class="btn-ghost" onclick="closeModal()">CANCELAR</button>
       <button class="btn-primary" id="btnSaveCat">GUARDAR</button>`
    );
    if (isEdit) cfg.fillForm(row);
    document.getElementById('btnSaveCat').addEventListener('click', async () => {
      const data = cfg.getFormData();
      const err = cfg.validate(data);
      if (err) return showToast(err, 'error');
      try {
        if (isEdit) {
          await apiFetch(`/${cfg.endpoint}/${row.id}`, { method: 'PUT', body: JSON.stringify(data) });
          showToast(`${cfg.singularLabel} actualizado`, 'success');
        } else {
          await apiFetch(`/${cfg.endpoint}`, { method: 'POST', body: JSON.stringify(data) });
          showToast(`${cfg.singularLabel} creado`, 'success');
        }
        closeModal();
        navigate(key);
      } catch (e) { showToast(e.message, 'error'); }
    });
  }

  // ═══════════════════════════════════
  //  PRODUCTOS
  // ═══════════════════════════════════
  async function renderProductos(wrapper) {
    const [data, marcasList, proveedoresList, categoriasList] = await Promise.all([
      apiFetch('/products?limit=200'),
      apiFetch('/marcas'),
      apiFetch('/proveedores'),
      apiFetch('/categorias'),
    ]);
    const products = data.items || data;

    wrapper.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">Productos</h1><p class="page-subtitle">Catálogo completo de productos.</p></div>
        <button class="btn-primary" id="btnNewProd">
          <span class="material-symbols-outlined">add</span> NUEVO PRODUCTO
        </button>
      </div>
      <div class="data-table-container">
        <div class="table-toolbar">
          <h2 class="table-title"><span class="material-symbols-outlined" style="color:var(--primary)">inventory</span> Catálogo</h2>
          <div class="search-box"><span class="material-symbols-outlined search-icon">search</span><input type="text" class="search-input" id="searchProd" placeholder="Buscar SKU, nombre..."></div>
        </div>
        <div class="table-scroll">
          <table class="data-table zebra-table">
            <thead><tr><th>SKU</th><th>Nombre</th><th>Categoría</th><th>Marca</th><th class="text-right">Precio de venta</th><th class="text-center">Acciones</th></tr></thead>
            <tbody id="tbodyProd"></tbody>
          </table>
        </div>
        <div class="table-footer"><span id="infoProd">${products.length} productos</span></div>
      </div>`;

    let allData = products;
    renderProductosTable(allData, marcasList, proveedoresList);

    document.getElementById('searchProd').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      renderProductosTable(q ? allData.filter(p => p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)) : allData, marcasList, proveedoresList);
    });

    document.getElementById('btnNewProd').addEventListener('click', () => openProductModal(null, marcasList, proveedoresList, categoriasList));

    window._editProd = async (id) => {
      const prod = allData.find(p => p.id === id);
      if (prod) openProductModal(prod, marcasList, proveedoresList, categoriasList);
    };

    window._managePresentaciones = async (id, nombre) => {
      openPresentacionesModal(id, nombre);
    };

    window._deleteProd = (id, nombre) => {
      openModal('Eliminar Producto', `<p style="color:var(--on-surface)">¿Eliminar <strong>${nombre}</strong>?</p>`,
        `<button class="btn-ghost" onclick="closeModal()">CANCELAR</button>
         <button class="btn-primary" style="background:var(--error-container);color:var(--error)" id="btnDelProd">ELIMINAR</button>`
      );
      document.getElementById('btnDelProd').addEventListener('click', async () => {
        try {
          await apiFetch(`/products/${id}`, { method: 'DELETE' });
          showToast('Producto eliminado', 'success');
          closeModal();
          navigate('productos');
        } catch (e) { showToast(e.message, 'error'); }
      });
    };
  }

  function renderProductosTable(data, marcas, proveedores) {
    const tbody = document.getElementById('tbodyProd');
    const info = document.getElementById('infoProd');
    const marcaMap = Object.fromEntries(marcas.map(m => [m.id, m.nombre]));
    if (!data.length) { tbody.innerHTML = `<tr><td colspan="6" class="loading-row">Sin productos</td></tr>`; return; }
    tbody.innerHTML = data.map(p => `
      <tr>
        <td style="font-family:var(--font-mono);font-size:12px;color:var(--primary-fixed-dim)">${esc(p.sku)}</td>
        <td>${esc(p.nombre)}</td>
        <td style="color:var(--on-surface-variant)">${esc(p.categoria || '—')}</td>
        <td style="color:var(--on-surface-variant)">${esc(p.marcaId ? (marcaMap[p.marcaId] || '—') : '—')}</td>
        <td class="text-right">Bs. ${parseFloat(p.precio).toFixed(2)}</td>
        <td class="text-center">
          <button class="btn-action-sm" onclick="window._editProd('${escAttr(p.id)}')"><span class="material-symbols-outlined" style="font-size:16px">edit</span></button>
          <button class="btn-action-sm" style="color:var(--primary)" onclick="window._managePresentaciones('${escAttr(p.id)}','${escAttr(p.nombre)}')" title="Presentaciones"><span class="material-symbols-outlined" style="font-size:16px">inventory_2</span></button>
          <button class="btn-action-sm danger" onclick="window._deleteProd('${escAttr(p.id)}','${escAttr(p.nombre)}')"><span class="material-symbols-outlined" style="font-size:16px">delete</span></button>
        </td>
      </tr>`).join('');
    if (info) info.textContent = `${data.length} productos`;
  }

  function openProductModal(prod, marcas, proveedores, categorias) {
    const isEdit = !!prod;
    const pendingPres = [];
    const renderPendingPres = () => {
      const list = document.getElementById('presPending');
      if (!list) return;
      if (!pendingPres.length) {
        list.innerHTML = '<div style="color:var(--on-surface-variant);font-size:13px;padding:4px 0">Sin presentaciones adicionales (la unidad usa el precio de venta del producto)</div>';
        return;
      }
      list.innerHTML = pendingPres.map((p, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0">
          <span style="flex:1">${esc(p.nombre)} <small style="color:var(--on-surface-variant)">· ×${p.factor} · Bs. ${parseFloat(p.precio).toFixed(2)}</small></span>
          <button class="btn-action-sm danger" onclick="window._removePendingPres(${i})"><span class="material-symbols-outlined" style="font-size:16px">close</span></button>
        </div>`).join('');
    };
    window._removePendingPres = (i) => {
      pendingPres.splice(i, 1);
      renderPendingPres();
    };

    const presSection = isEdit ? '' : `
      <div style="background:var(--surface-container); padding:12px; border-radius:8px; margin-top:16px">
        <h4 style="margin:0 0 8px 0; font-size:14px">Presentaciones (opcional)</h4>
        <div id="presPending" style="margin-bottom:8px"></div>
        <div style="display:grid; grid-template-columns:2fr 1fr 1fr auto; gap:8px; align-items:end">
          <div class="form-group" style="margin:0"><label class="form-label">Nombre (ej. Caja de 12)</label><input class="form-input" id="prNombre" value="Unidad" placeholder="Nombre"></div>
          <div class="form-group" style="margin:0"><label class="form-label">Factor (Unds)</label><input type="number" class="form-input" id="prFactor" min="1" value="1"></div>
          <div class="form-group" style="margin:0"><label class="form-label">Precio</label><input type="number" step="0.01" class="form-input" id="prPrecio" placeholder="0.00"></div>
          <button class="btn-primary" id="btnAddPresRow" style="padding:0 16px; height:40px"><span class="material-symbols-outlined">add</span></button>
        </div>
      </div>`;

    openModal(isEdit ? 'Editar Producto' : 'Nuevo Producto', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="form-group"><label class="form-label">SKU *</label><input class="form-input" id="pSku" value="${escAttr(prod?.sku || '')}" placeholder="SKU-0001"></div>
        <div class="form-group"><label class="form-label">Nombre *</label><input class="form-input" id="pNombre" value="${escAttr(prod?.nombre || '')}" placeholder="Nombre del producto"></div>
        <div class="form-group"><label class="form-label">Precio de venta *</label><input class="form-input" id="pPrecio" type="number" step="0.01" value="${escAttr(prod?.precio || '')}" placeholder="0.00"></div>
        <div class="form-group"><label class="form-label">Categoría</label>
          <select class="form-select" id="pCat">
            <option value="">— Sin categoría —</option>
            ${categorias.map(c => `<option value="${escAttr(c.nombre)}" ${prod?.categoria===c.nombre?'selected':''}>${esc(c.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="form-label">Marca</label>
          <select class="form-select" id="pMarca">
            <option value="">— Sin marca —</option>
            ${marcas.map(m => `<option value="${m.id}" ${prod?.marcaId===m.id?'selected':''}>${esc(m.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="grid-column:1/-1"><label class="form-label">Proveedor</label>
          <select class="form-select" id="pProv">
            <option value="">— Sin proveedor —</option>
            ${proveedores.map(p => `<option value="${p.id}" ${prod?.proveedorId===p.id?'selected':''}>${esc(p.nombre)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="grid-column:1/-1"><label class="form-label">Descripción</label><input class="form-input" id="pDesc" value="${escAttr(prod?.descripcion || '')}" placeholder="Descripción del producto"></div>
      </div>
      ${presSection}`,
      `<button class="btn-ghost" onclick="closeModal()">CANCELAR</button>
       <button class="btn-primary" id="btnSaveProd">GUARDAR</button>`
    );
    if (!isEdit) setModalWide(true);

    document.getElementById('btnSaveProd').addEventListener('click', async () => {
      const sku = document.getElementById('pSku').value.trim();
      const nombre = document.getElementById('pNombre').value.trim();
      const precio = document.getElementById('pPrecio').value.trim();
      if (!sku || !nombre || !precio) return showToast('SKU, nombre y precio son requeridos', 'error');
      const body = {
        sku, nombre, precio, descripcion: document.getElementById('pDesc').value.trim(),
        categoria: document.getElementById('pCat').value.trim(),

        marcaId: document.getElementById('pMarca').value || undefined,
        proveedorId: document.getElementById('pProv').value || undefined,
      };
      if (!isEdit && pendingPres.length) {
        body.presentaciones = pendingPres.map(p => ({
          nombre_presentacion: p.nombre,
          factor_conversion: p.factor,
          precio_venta: p.precio,
        }));
      }
      try {
        if (isEdit) {
          await apiFetch(`/products/${prod.id}`, { method: 'PUT', body: JSON.stringify(body) });
          showToast('Producto actualizado', 'success');
        } else {
          await apiFetch('/products', { method: 'POST', body: JSON.stringify(body) });
          showToast('Producto creado', 'success');
        }
        closeModal();
        setModalWide(false);
        navigate('productos');
      } catch (e) { showToast(e.message, 'error'); }
    });

    if (!isEdit) {
      renderPendingPres();
      document.getElementById('btnAddPresRow').addEventListener('click', () => {
        const nombre = document.getElementById('prNombre').value.trim();
        const factor = parseInt(document.getElementById('prFactor').value);
        const precio = parseFloat(document.getElementById('prPrecio').value);
        if (!nombre || !factor || !precio) return showToast('Completa nombre, factor y precio', 'error');
        pendingPres.push({ nombre, factor, precio });
        document.getElementById('prNombre').value = 'Unidad';
        document.getElementById('prFactor').value = '1';
        document.getElementById('prPrecio').value = '';
        renderPendingPres();
      });
    }
  }

  async function openPresentacionesModal(productoId, productoNombre) {
    let presentaciones = [];
    try {
      presentaciones = await OrvayayaAPI.getPresentaciones(productoId);
    } catch (e) {
      return showToast('Error al cargar presentaciones', 'error');
    }

    const renderList = () => {
      const tbody = document.getElementById('tbodyPres');
      if (!tbody) return;
      if (!presentaciones.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding:20px;color:var(--on-surface-variant)">Sin presentaciones</td></tr>';
        return;
      }
      tbody.innerHTML = presentaciones.map(p => `
        <tr>
          <td>${esc(p.nombrePresentacion)}</td>
          <td class="text-center">${p.factorConversion}</td>
          <td class="text-right">Bs. ${parseFloat(p.precioVenta).toFixed(2)}</td>
          <td class="text-center">
            <button class="btn-action-sm danger" onclick="window._delPres('${escAttr(p.id)}')"><span class="material-symbols-outlined" style="font-size:16px">delete</span></button>
          </td>
        </tr>
      `).join('');
    };

    openModal(`Presentaciones: ${productoNombre}`, `
      <div class="table-scroll" style="margin-bottom:16px; max-height:200px">
        <table class="data-table zebra-table">
          <thead><tr><th>Nombre</th><th class="text-center">Factor</th><th class="text-right">Precio Venta</th><th class="text-center">Quitar</th></tr></thead>
          <tbody id="tbodyPres"></tbody>
        </table>
      </div>
      <div style="background:var(--surface-container); padding:12px; border-radius:8px">
        <h4 style="margin:0 0 12px 0; font-size:14px">Agregar Presentación</h4>
        <div style="display:grid; grid-template-columns:2fr 1fr 1fr auto; gap:8px; align-items:end">
          <div class="form-group" style="margin:0"><label class="form-label">Nombre (ej. Caja de 12)</label><input class="form-input" id="prNombre" placeholder="Nombre"></div>
          <div class="form-group" style="margin:0"><label class="form-label">Factor (Unds)</label><input type="number" class="form-input" id="prFactor" min="1" value="1"></div>
          <div class="form-group" style="margin:0"><label class="form-label">Precio</label><input type="number" step="0.01" class="form-input" id="prPrecio" placeholder="0.00"></div>
          <button class="btn-primary" id="btnAddPres" style="padding:0 16px; height:40px"><span class="material-symbols-outlined">add</span></button>
        </div>
      </div>
    `, `<button class="btn-ghost" onclick="closeModal()">CERRAR</button>`);

    renderList();

    window._delPres = async (id) => {
      try {
        await OrvayayaAPI.deletePresentacion(id);
        presentaciones = presentaciones.filter(p => p.id !== id);
        renderList();
        showToast('Presentación eliminada', 'success');
      } catch (e) {
        showToast(e.message, 'error');
      }
    };

    document.getElementById('btnAddPres').addEventListener('click', async () => {
      const nombre = document.getElementById('prNombre').value.trim();
      const factor = parseInt(document.getElementById('prFactor').value);
      const precio = parseFloat(document.getElementById('prPrecio').value);
      
      if (!nombre || !factor || !precio) return showToast('Completa todos los campos correctamente', 'error');
      
      try {
        const created = await OrvayayaAPI.createPresentacion({
          producto_id: productoId,
          nombre_presentacion: nombre,
          factor_conversion: factor,
          precio_venta: precio
        });
        presentaciones.push(created);
        renderList();
        
        document.getElementById('prNombre').value = '';
        document.getElementById('prFactor').value = '1';
        document.getElementById('prPrecio').value = '';
        
        showToast('Presentación agregada', 'success');
      } catch (e) {
        showToast(e.message, 'error');
      }
    });
  }

  // ═══════════════════════════════════
  //  INVENTARIO
  // ═══════════════════════════════════
  async function renderInventario(wrapper) {
    const [data, branches, proveedores] = await Promise.all([
      OrvayayaAPI.getGlobalInventory(),
      apiFetch('/sucursales'),
      apiFetch('/proveedores'),
    ]);

    wrapper.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">Inventario</h1><p class="page-subtitle">Stock por sucursal de todos los productos.</p></div>
        <div style="display:flex;gap:8px">
          <button class="btn-primary" id="btnIngresar" style="background:var(--tertiary-container);color:#fff;border:1px solid var(--tertiary)">
            <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1;font-size:18px">add_circle</span> INGRESAR STOCK A LA CIUDAD
          </button>
          <button class="btn-primary" id="btnTransfer">
            <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1;font-size:18px">local_shipping</span> ENVIAR A OROVAYAYA
          </button>
        </div>
      </div>
      <div class="data-table-container">
        <div class="table-toolbar">
          <h2 class="table-title"><span class="material-symbols-outlined" style="color:var(--primary)">inventory_2</span> Vista Global</h2>
          <div class="search-box"><span class="material-symbols-outlined search-icon">search</span><input type="text" class="search-input" id="searchInv" placeholder="Buscar..."></div>
        </div>
        <div class="table-scroll">
          <table class="data-table zebra-table">
            <thead><tr>
              <th>Producto</th><th>Categoría</th>
              <th class="text-right">🏙 Ciudad</th>
              <th class="text-right">🏘 Pueblo</th>
              <th class="text-right">Total</th>
              <th class="text-center">Estado</th>
              <th class="text-center">Acción</th>
            </tr></thead>
            <tbody id="tbodyInv"></tbody>
          </table>
        </div>
        <div class="table-footer"><span id="infoInv">${data.length} productos</span></div>
      </div>`;

    let allData = data;
    renderGlobalInvTable(allData, branches);

    document.getElementById('searchInv').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      renderGlobalInvTable(
        q ? allData.filter(i => i.productoNombre.toLowerCase().includes(q) || i.productoSku.toLowerCase().includes(q)) : allData,
        branches
      );
    });

    document.getElementById('btnIngresar').addEventListener('click', () => openPlanillaModal(allData, 'ingreso', branches, proveedores));
    document.getElementById('btnTransfer').addEventListener('click', () => openPlanillaModal(allData, 'envio', branches, proveedores));

    // Row-level quick entry button → opens the worksheet pre-filled
    window._quickStock = (productoId, tipo) => openPlanillaModal(allData, 'ingreso', branches, proveedores, { preselectedProductoId: productoId });
  }

  function renderGlobalInvTable(data, branches) {
    const tbody = document.getElementById('tbodyInv');
    const info = document.getElementById('infoInv');
    if (!data.length) { tbody.innerHTML = `<tr><td colspan="7" class="loading-row">Sin datos</td></tr>`; return; }
    tbody.innerHTML = data.map(item => {
      const total = item.stockCiudad + item.stockPueblo;
      const min = Math.min(item.stockCiudad, item.stockPueblo);
      const [cls, txt] = min === 0 ? ['out','Agotado'] : min < 5 ? ['low','Bajo'] : ['optimal','Óptimo'];
      const cc = item.stockCiudad < 5 ? (item.stockCiudad === 0 ? 'stock-out' : 'stock-low') : '';
      const cp = item.stockPueblo < 5 ? (item.stockPueblo === 0 ? 'stock-out' : 'stock-low') : '';
      return `<tr>
        <td><div class="product-cell"><span class="product-sku">${esc(item.productoSku)}</span><span>${esc(item.productoNombre)}</span></div></td>
        <td style="color:var(--on-surface-variant)">${esc(item.categoria || '—')}</td>
        <td class="text-right ${cc}" style="font-weight:600">${item.stockCiudad}</td>
        <td class="text-right ${cp}" style="font-weight:600">${item.stockPueblo}</td>
        <td class="text-right" style="font-weight:700;color:var(--primary-fixed-dim)">${total}</td>
        <td class="text-center"><div class="status-badge ${cls}"><div class="dot"></div><span>${txt}</span></div></td>
        <td class="text-center">
          <button class="btn-action-sm" title="Ingresar stock a la ciudad" onclick="window._quickStock('${escAttr(item.productoId)}','entrada')" style="color:var(--tertiary)">
            <span class="material-symbols-outlined" style="font-size:16px">add_circle</span>
          </button>
        </td>
      </tr>`;
    }).join('');
    if (info) info.textContent = `${data.length} productos`;
}

  // ═══════════════════════════════════
  //  MOVIMIENTOS
  // ═══════════════════════════════════
  async function renderMovimientos(wrapper) {
    const data = await apiFetch('/movimientos?limit=100');
    wrapper.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">Movimientos de Inventario</h1><p class="page-subtitle">Historial de todos los movimientos de stock.</p></div>
      </div>
      <div class="data-table-container">
        <div class="table-toolbar">
          <h2 class="table-title"><span class="material-symbols-outlined" style="color:var(--primary)">swap_horiz</span> Historial</h2>
        </div>
        <div class="table-scroll">
          <table class="data-table zebra-table">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Sucursal</th><th>Proveedor</th><th class="text-right">Cantidad</th><th class="text-right">Antes</th><th class="text-right">Después</th><th>Nota</th></tr></thead>
            <tbody id="tbodyMov"></tbody>
          </table>
        </div>
        <div class="table-footer"><span>${data.length} registros</span></div>
      </div>`;

    const tbody = document.getElementById('tbodyMov');
    if (!data.length) { tbody.innerHTML = `<tr><td colspan="9" class="loading-row">Sin movimientos registrados</td></tr>`; return; }
    const TIPO_COLORS = { entrada: 'optimal', salida: 'out', transferencia: 'low', ajuste: 'low', venta: 'out' };
    tbody.innerHTML = data.map(m => `
      <tr>
        <td style="font-size:12px;color:var(--on-surface-variant)">${new Date(m.createdAt).toLocaleString('es-VE')}</td>
        <td><div class="status-badge ${TIPO_COLORS[m.tipo]||''}"><div class="dot"></div>${esc(m.tipo)}</div></td>
        <td><div class="product-cell"><span class="product-sku">${esc(m.productoSku)}</span><span>${esc(m.productoNombre)}</span></div></td>
        <td style="color:var(--on-surface-variant)">${esc(m.sucursalNombre)}</td>
        <td style="color:var(--on-surface-variant)">${esc(m.proveedorNombre || '—')}</td>
        <td class="text-right" style="font-weight:600;color:${m.cantidad > 0 ? 'var(--tertiary)' : 'var(--error)'}">${m.cantidad > 0 ? '+' : ''}${m.cantidad}</td>
        <td class="text-right">${m.cantidadAnterior}</td>
        <td class="text-right">${m.cantidadPosterior}</td>
        <td style="color:var(--on-surface-variant);font-size:12px">${esc(m.nota || '—')}</td>
      </tr>`).join('');
  }

  // ═══════════════════════════════════
  //  HISTORIAL COSTOS
  // ═══════════════════════════════════
  async function renderHistorialCostos(wrapper) {
    const data = await apiFetch('/historial-costos?limit=100');
    wrapper.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">Historial de Costos</h1><p class="page-subtitle">Registro de cambios de precio y costo por producto.</p></div>
      </div>
      <div class="data-table-container">
        <div class="table-toolbar">
          <h2 class="table-title"><span class="material-symbols-outlined" style="color:var(--primary)">price_change</span> Historial</h2>
        </div>
        <div class="table-scroll">
          <table class="data-table zebra-table">
            <thead><tr><th>Fecha</th><th>Producto</th><th class="text-right">Precio Anterior</th><th class="text-right">Precio Nuevo</th><th class="text-right">Costo Anterior</th><th class="text-right">Costo Nuevo</th><th>Motivo</th></tr></thead>
            <tbody id="tbodyHC"></tbody>
          </table>
        </div>
        <div class="table-footer"><span>${data.length} registros</span></div>
      </div>`;

    const tbody = document.getElementById('tbodyHC');
    if (!data.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="loading-row">Sin historial. Los cambios de precio de productos se registrarán aquí.</td></tr>`;
      return;
    }
    tbody.innerHTML = data.map(h => {
      const pDiff = parseFloat(h.precioNuevo) - parseFloat(h.precioAnterior || h.precioNuevo);
      const diffColor = pDiff > 0 ? 'var(--error)' : pDiff < 0 ? 'var(--tertiary)' : 'var(--on-surface-variant)';
      return `<tr>
        <td style="font-size:12px;color:var(--on-surface-variant)">${new Date(h.createdAt).toLocaleString('es-VE')}</td>
        <td><div class="product-cell"><span class="product-sku">${esc(h.productoSku)}</span><span>${esc(h.productoNombre)}</span></div></td>
        <td class="text-right">${h.precioAnterior ? 'Bs. '+parseFloat(h.precioAnterior).toFixed(2) : '—'}</td>
        <td class="text-right" style="color:${diffColor};font-weight:600">Bs. ${parseFloat(h.precioNuevo).toFixed(2)}</td>
        <td class="text-right">${h.costoAnterior ? 'Bs. '+parseFloat(h.costoAnterior).toFixed(2) : '—'}</td>
        <td class="text-right">Bs. ${parseFloat(h.costoNuevo || 0).toFixed(2)}</td>
        <td style="color:var(--on-surface-variant);font-size:12px">${esc(h.motivo || '—')}</td>
      </tr>`;
    }).join('');
  }

  // ═══════════════════════════════════
  //  VENTAS
  // ═══════════════════════════════════
  async function renderVentas(wrapper) {
    const data = await apiFetch('/sales?limit=100');
    wrapper.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">Ventas</h1><p class="page-subtitle">Historial de todas las ventas registradas.</p></div>
      </div>
      <div class="data-table-container">
        <div class="table-toolbar">
          <h2 class="table-title"><span class="material-symbols-outlined" style="color:var(--primary)">receipt_long</span> Historial de Ventas</h2>
        </div>
        <div class="table-scroll">
          <table class="data-table zebra-table">
            <thead><tr><th>Fecha</th><th>Sucursal</th><th>Items</th><th class="text-right">Total</th><th class="text-center">Sincronizado</th></tr></thead>
            <tbody id="tbodyVentas"></tbody>
          </table>
        </div>
        <div class="table-footer"><span>${data.length} ventas</span></div>
      </div>`;

    const tbody = document.getElementById('tbodyVentas');
    if (!data.length) { tbody.innerHTML = `<tr><td colspan="5" class="loading-row">Sin ventas registradas</td></tr>`; return; }
    tbody.innerHTML = data.map(v => `
      <tr>
        <td style="font-size:12px;color:var(--on-surface-variant)">${new Date(v.createdAt).toLocaleString('es-VE')}</td>
        <td>${esc(v.sucursalNombre || '—')}</td>
        <td style="color:var(--on-surface-variant)">${Array.isArray(v.items) ? v.items.length+' item(s)' : '—'}</td>
        <td class="text-right" style="font-weight:600;font-family:var(--font-mono)">Bs. ${parseFloat(v.total).toFixed(2)}</td>
        <td class="text-center">
          <div class="status-badge ${v.synced ? 'optimal' : 'low'}">
            <div class="dot"></div>${v.synced ? 'Sí' : 'Pendiente'}
          </div>
        </td>
      </tr>`).join('');
  }

  // ═══════════════════════════════════
  //  REPORTE DE VENTAS  (Tarea 3.2.3)
  // ═══════════════════════════════════
  function reportFilters(extraFields) {
    return `
      <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px">
        <div class="form-group" style="margin:0">
          <label class="form-label">Desde</label>
          <input type="date" class="form-input" id="rfInicio">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Hasta</label>
          <input type="date" class="form-input" id="rfFin">
        </div>
        ${extraFields || ''}
        <button class="btn-primary" id="rfBtn">
          <span class="material-symbols-outlined" style="font-size:18px">search</span> CONSULTAR
        </button>
      </div>`;
  }

  function currentMonthRange() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { first, last };
  }

  async function renderReporteVentas(wrapper) {
    const { first, last } = currentMonthRange();
    wrapper.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">Reporte de Ventas</h1>
        <p class="page-subtitle">Ingresos y ventas por rango de fechas.</p></div>
      </div>
      <div class="data-table-container">
        <div class="table-toolbar">${reportFilters('')}</div>
        <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
          <div class="kpi-card"><span class="kpi-label">N° Ventas</span><span class="kpi-value" id="rvCount">—</span></div>
          <div class="kpi-card"><span class="kpi-label">Ingresos</span><span class="kpi-value" id="rvIngresos">—</span></div>
          <div class="kpi-card"><span class="kpi-label">Items Vendidos</span><span class="kpi-value" id="rvItems">—</span></div>
        </div>
        <div class="table-scroll">
          <table class="data-table zebra-table">
            <thead><tr><th>Fecha</th><th>Sucursal</th><th>Items</th><th class="text-right">Total</th></tr></thead>
            <tbody id="tbodyRV"></tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('rfInicio').value = first;
    document.getElementById('rfFin').value   = last;

    let currentVentas = [];

    const cargar = async () => {
      const fi = document.getElementById('rfInicio').value;
      const ff = document.getElementById('rfFin').value;
      const q  = new URLSearchParams();
      if (fi) q.set('fecha_inicio', fi);
      if (ff) q.set('fecha_fin',    ff);
      const r = await apiFetch(`/reports/ventas?${q.toString()}`);
      currentVentas = r.ventas || [];
      document.getElementById('rvCount').textContent    = r.total_ventas;
      document.getElementById('rvIngresos').textContent = `Bs. ${parseFloat(r.total_ingresos).toLocaleString('es-VE', {minimumFractionDigits:2,maximumFractionDigits:2})}`;
      document.getElementById('rvItems').textContent    = r.total_items;
      const tbody = document.getElementById('tbodyRV');
      tbody.innerHTML = currentVentas.length
        ? currentVentas.map((v, idx) => `
          <tr class="rv-row" data-index="${idx}" style="cursor:pointer;" onmouseover="this.style.background='var(--surface-container-high)'" onmouseout="this.style.background=''">
            <td style="font-size:12px;color:var(--on-surface-variant)">${new Date(v.createdAt).toLocaleString('es-VE')}</td>
            <td>${esc(v.sucursalNombre || '—')}</td>
            <td style="color:var(--primary); font-weight: 500;">
              ${Array.isArray(v.items) ? v.items.length+' item(s)' : '—'} <span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle;">visibility</span>
            </td>
            <td class="text-right" style="font-family:var(--font-mono);font-weight:600">Bs. ${parseFloat(v.total).toFixed(2)}</td>
          </tr>`).join('')
        : `<tr><td colspan="4" class="loading-row">Sin ventas en el período</td></tr>`;
    };

    document.getElementById('tbodyRV').addEventListener('click', (e) => {
      const row = e.target.closest('.rv-row');
      if (!row) return;
      const idx = row.getAttribute('data-index');
      const v = currentVentas[idx];
      if (!v) return;

      const itemsHtml = Array.isArray(v.items) && v.items.length > 0 
        ? v.items.map(i => `
          <div style="display:flex; justify-content:space-between; margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--outline-variant);">
            <div><b style="color:var(--primary)">${i.cantidad}x</b> ${esc(i.productoNombre || 'Prod')}</div>
            <div style="font-family:var(--font-mono)">Bs. ${parseFloat(i.subtotal).toFixed(2)}</div>
          </div>
        `).join('')
        : '<p>Sin detalles</p>';

      const bodyHtml = `
        <div style="margin-bottom: 16px; padding-bottom: 16px; border-bottom: 2px solid var(--outline-variant);">
          <p style="color:var(--on-surface-variant); font-size:13px; margin-bottom: 4px;"><b>Fecha:</b> ${new Date(v.createdAt).toLocaleString('es-VE')}</p>
          <p style="color:var(--on-surface-variant); font-size:13px;"><b>Sucursal:</b> ${esc(v.sucursalNombre || '—')}</p>
        </div>
        <div style="max-height: 300px; overflow-y: auto; padding-right: 8px;">
          ${itemsHtml}
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:16px; padding-top:16px; border-top:2px solid var(--primary); font-weight:bold; font-size:18px;">
          <div>TOTAL</div>
          <div style="font-family:var(--font-mono); color:var(--primary)">Bs. ${parseFloat(v.total).toFixed(2)}</div>
        </div>
      `;

      openModal('Detalle de Venta', bodyHtml, '<button class="btn-primary" onclick="closeModal()" style="width:100%">CERRAR DETALLE</button>');
    });

    document.getElementById('rfBtn').addEventListener('click', cargar);
    cargar();
  }

  async function renderReporteGanancias(wrapper) {
    const { first, last } = currentMonthRange();
    wrapper.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">Reporte de Ganancias</h1>
        <p class="page-subtitle">Rentabilidad: ventas − costo de productos vendidos.</p></div>
      </div>
      <div class="data-table-container">
        <div class="table-toolbar">${reportFilters('')}</div>
        <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
          <div class="kpi-card"><span class="kpi-label">Ingresos</span><span class="kpi-value" id="rgIngresos">—</span></div>
          <div class="kpi-card"><span class="kpi-label">Costo</span><span class="kpi-value" id="rgCosto">—</span></div>
          <div class="kpi-card" data-accent="secondary"><span class="kpi-label">Ganancia</span><span class="kpi-value" id="rgGanancia">—</span></div>
          <div class="kpi-card" data-accent="tertiary"><span class="kpi-label">Margen</span><span class="kpi-value" id="rgMargen">—</span></div>
        </div>
        <div class="table-scroll">
          <table class="data-table zebra-table">
            <thead><tr><th>Producto</th><th class="text-right">Cantidad</th><th class="text-right">Ventas</th>
            <th class="text-right">Costo</th><th class="text-right">Ganancia</th></tr></thead>
            <tbody id="tbodyRG"></tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('rfInicio').value = first;
    document.getElementById('rfFin').value   = last;

    const cargar = async () => {
      const fi = document.getElementById('rfInicio').value;
      const ff = document.getElementById('rfFin').value;
      const q  = new URLSearchParams();
      if (fi) q.set('fecha_inicio', fi);
      if (ff) q.set('fecha_fin',    ff);
      const r = await apiFetch(`/reports/ganancias?${q.toString()}`);
      document.getElementById('rgIngresos').textContent = `Bs. ${parseFloat(r.total_ingresos).toLocaleString('es-VE', {minimumFractionDigits:2,maximumFractionDigits:2})}`;
      document.getElementById('rgCosto').textContent    = `Bs. ${parseFloat(r.total_costo).toLocaleString('es-VE', {minimumFractionDigits:2,maximumFractionDigits:2})}`;
      document.getElementById('rgGanancia').textContent = `Bs. ${parseFloat(r.total_ganancia).toLocaleString('es-VE', {minimumFractionDigits:2,maximumFractionDigits:2})}`;
      document.getElementById('rgMargen').textContent   = `${r.margen_porcentaje}%`;
      const tbody = document.getElementById('tbodyRG');
      tbody.innerHTML = r.detalle_por_producto.length
        ? r.detalle_por_producto.map(d => `
          <tr>
            <td>${esc(d.productoNombre)}</td>
            <td class="text-right">${d.cantidad}</td>
            <td class="text-right">Bs. ${parseFloat(d.ventas).toFixed(2)}</td>
            <td class="text-right">Bs. ${parseFloat(d.costo).toFixed(2)}</td>
            <td class="text-right" style="font-weight:600;color:${parseFloat(d.ganancia) >= 0 ? 'var(--tertiary)' : 'var(--error)'}">Bs. ${parseFloat(d.ganancia).toFixed(2)}</td>
          </tr>`).join('')
        : `<tr><td colspan="5" class="loading-row">Sin datos en el período</td></tr>`;
    };
    document.getElementById('rfBtn').addEventListener('click', cargar);
    cargar();
  }

  // ═══════════════════════════════════
  //  UTILITIES
  // ═══════════════════════════════════

  // apiFetch with auth
  async function apiFetch(path, options = {}) {
    const token = OrvayayaAPI.getToken();
    const res = await fetch(`/v1${path}`, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
    });
    if (res.status === 401) { OrvayayaAPI.logout(); throw new Error('Sesión expirada'); }
    if (!res.ok) {
      const e = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(e.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // Modal helpers
  function openModal(title, bodyHtml, footerHtml) {
    setModalWide(false);
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    document.getElementById('modalFooter').innerHTML = footerHtml;
    document.getElementById('globalModal').style.display = 'flex';
  }

  function setModalWide(wide) {
    const card = document.querySelector('.modal-card');
    if (card) card.classList.toggle('modal-card--wide', !!wide);
  }

  window.closeModal = function () {
    document.getElementById('globalModal').style.display = 'none';
  };

  // Toast
  function showToast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px">${type === 'success' ? 'check_circle' : 'error'}</span>${esc(msg)}`;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // ── Event listeners ──
  document.querySelectorAll('.nav-item[data-section]').forEach(el => {
    el.addEventListener('click', e => { 
      e.preventDefault(); 
      navigate(el.dataset.section); 
      if (window.innerWidth < 768) {
        document.getElementById('sidebar').classList.remove('mobile-open');
      }
    });
  });

  window.addEventListener('hashchange', () => {
    const hashSection = window.location.hash.replace('#', '') || 'dashboard';
    navigate(hashSection);
  });

  document.getElementById('btnLogout').addEventListener('click', e => { e.preventDefault(); OrvayayaAPI.logout(); });
  document.getElementById('btnCloseModal').addEventListener('click', window.closeModal);
  document.getElementById('globalModal').addEventListener('click', e => { if (e.target === e.currentTarget) window.closeModal(); });

  document.getElementById('btnMobileMenu')?.addEventListener('click', () => {
    const s = document.getElementById('sidebar');
    s.classList.toggle('mobile-open');
  });

  // ── Initial render ──
  const initialSection = window.location.hash.replace('#', '') || 'dashboard';
  navigate(initialSection);
})();
