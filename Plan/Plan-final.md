# Plan de Implementación Definitiva — Offline-First para Pueblo (POS + Admin)

## Resumen Ejecutivo

Implementar una experiencia completamente **offline-first** para la tablet/PC del pueblo, que permita ventas sin internet, almacenamiento local, reintentos robustos y reconciliación al volver. Esto incluye hacer el POS una PWA que funcione sin CDN, agregar sync con backoff real, decremento optimista del stock local, monitoreo en la ciudad (polling cada 15 min) y una auth tolerante a períodos largos sin señal.

El plan utiliza los cimientos offline-first que YA existen en `client/` (IndexedDB/Dexie + `/v1/sync`) y extiende el servidor SOLO para un token de mayor duración (opcional). Las decisiones arquitectónicas clave son:

- **PWA + Service Worker** para cachear todo lo necesario para operar offline.
- **Auto-hospedar Dexie (4.0.11) y jsPDF (2.5.2)** en `client/vendor/` (no CDN) → elimina dependencia en conexión externa.
- **Probe de conectividad real** para reintentos más fiables en pueblos con internet malo.
- **Descontar stock optimista** en la UI offline; reconciliar al sincronizar (ya existe `POST /v1/sync`).
- **Token de autenticación con caducidad ≥7 días** para no bloquear ventas después de períodos largos sin internet.
- **Polling silencioso del admin** cada 15 min (o cuando la página es visible) para ver ventas y stock del pueblo.
- **Catálogo completo** (todas las páginas de productos, no solo los primeros 200).

---

## 1. Descripción General de los Componentes

| Componente | Versión actual | Lo que implementaremos |
|-------------|---------------|----------------------|
| **Servidor** (`server/`) | JWT 24h, sync por idempo y savepoints | Cambio: hacer JWT `expiresIn: "7d"` (o ajustar) |
| **POS (`client/pos/`)** | IndexedDB local, sync via `/v1/sync` | 1) Service Worker + manifest (PWA) 2) Vendor local 3) Stock optimista + reconciliación 4) Reintento con backoff + probe |
| **Admin (`client/admin/`)** | En navegación única, sin auto-refresh | Polling silencioso cada 15 min (solo sección visible) |
| **Librerías externas** | Dexie (CDN), jsPDF (CDN), Google Fonts (CDN), Material Symbols (CDN) | Vendor local para Dexie/jsPDF; auto-hospedar fuentes para apariencia completa sin señal |

---

## 2. Detalle del Cambio — Por Módulo

### 2.1. Servidor (`server/src/modules/auth/routes.ts`)

**Por qué:** Token 24h fuerza a logout en ciudades offline >24h.
**Cambio:** extender la caducidad a 7 días (o 12 h si necesitas seguridad estricta).

#### Código a agregar (o editar) (NO confundir con imports existentes)

```typescript
// server/src/modules/auth/routes.ts:30-35  (grupo de auth.sign)
await jwt.sign(
  {
    id: user.id,
    email: user.email,
    rol: user.rol,
    nombre: user.nombre,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 días
  },
  { algorithm: 'HS256' } // o actual algoritmo HS256
);
```

> Nota: Puedes hacerlo en `server/src/shared/middleware/auth.ts` también (si necesitas acceder exp globalmente) — pero la firma de tokens ya está en auth/routes.

---

### 2.2. PWA — Service Worker + manifest (`client/`)

**Archivos a crear/editar**

1. `client/sw.js`
2. `client/manifest.json`
3. `client/vendor/    // (nuevo)`
   - `dexie.min.js`  (versión 4.0.11 exacta)
   - `jspdf.umd.min.js` (versión 2.5.2 exacta)
   - `fonts/`        // Google Fonts + Material Symbols (opcional, pero recomendado)

#### `client/sw.js`

```javascript
const CACHE_NAME = 'orvayaya-pos-v2';
const OFFLINE_URL = '/offline.html'; // opcional, no usamos html offline por ahora

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Esencial para el POS offline
      return cache.addAll([
        '/',
        '/pos/',
        '/pos/index.html',
        '/pos/app.js',
        '/shared/api.js',
        '/shared/db.js',
        '/shared/middleware/auth.js',
        '/shared/middleware/validation.js',
        '/admin/index.html',
        '/admin/app.js',
        // Librerías auto-hospedadas
        '/vendor/dexie.min.js',
        '/vendor/jspdf.umd.min.js',
        // Recursos estáticos (icons, etc. pueden ir aquí)
        '/icons/icon-192.png',
        '/icons/icon-512.png',
      ]);
    })
  );
});

self.addEventListener('fetch', event => {
  // Solo para requests del mismo origen; ignorar cdn.maxcdn.com etc.
  if (!event.request.url.startsWith(self.location.origin)) return;

  // Cache-first para recursos críticos (JS, manifest, íconos)
  const isCritical = event.request.url.includes('/vendor/') || event.request.url.endsWith('.js') || event.request.url.endsWith('.html');

  if (isCritical) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(response => {
          // Envolver la respuesta para loggear fallos
          if (response) return response;

          // Intentar fetch (solo cuando hay internet)
          if (!navigator.onLine) {
            // Si el request es /pos/app.js y estamos offline, devolvemos un respaldo offline barebones (podríamos servir un HTML simple con mensaje offline).
            // Para esta app, si está offline y necesita /pos/app.js, no puede funcionar → fallar.
            return new Response('Offline: el POS está offline.', { status: 408, statusText: 'Offline' });
          }
          return fetch(event.request).then(response => {
            // Clonar para cachear (solo 200 OK)
            if (response.ok) {
              const responseClone = response.clone();
              cache.put(event.request, responseClone);
            }
            return response;
          });
        });
      })
    );
    return;
  }

  // Para recursos estáticos (imagenes, fuentes), misma estrategia cache-first
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    })
  );
});
```

#### `client/manifest.json`

```json
{
  "name": "POS Orvayaya",
  "short_name": "POS",
  "description": "Punto de venta offline-first para sucursal Pueblo",
  "start_url": "/pos/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#adc6ff",
  "icons": [
    {
      "src": "/icons/icon-144.png",
      "sizes": "144x144",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ],
  "scope": "/"
}
```

#### Actualizar `client/pos/index.html:12,14`

```html
<!-- ANTES (CDN): -->
<script src="https://unpkg.com/dexie@4.0.11/dist/dexie.min.js" defer></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js" defer></script>

<!-- DESPUÉS (vendor local): -->
<script src="/vendor/dexie.min.js" defer></script>
<script src="/vendor/jspdf.umd.min.js" defer></script>
```

#### También agregar `<link rel="manifest" href="/manifest.json">` a `pos/index.html` (y opcionalmente a `admin/index.html` si usas PWA allá).

### 2.3. Vendor local — descargar librerías exactas una vez

Usa `wget` (o un script de bash) para descargar las versiones exactas actualmente usadas:

```bash
mkdir -p client/vendor
# Descargar Dexie 4.0.11 exacto (esa es la versión actual del CDN en el HTML)
curl -sSL https://unpkg.com/dexie@4.0.11/dist/dexie.min.js -o client/vendor/dexie.min.js
# Descargar jsPDF 2.5.2 exacto
curl -sSL https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js -o client/vendor/jspdf.umd.min.js
# Opcional: auto-hospedar fuentes (opcional pero recomendado):
#   - Guardar tipografías en client/vendor/fonts/
#   - Guardar Material Symbols de Google (pueden venir de https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200)
```

> Nota: versiones exactas para no romper nada. Si más adelante necesitas actualizar, debes volver a descargar y volver a publicar.

### 2.4. Conectividad robusta y reintento (`client/pos/app.js`)

#### Agregar helper `pingProbe` en `shared/api.js` (o nuevo archivo `shared/network.js`) — por simplicidad, agregar en api.js:

```javascript
// shared/api.js (al final del archivo)

async function pingProbe() {
  try {
    // HEAD al endpoint health; timeout 3000ms
    const res = await fetch(`/v1/health`, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Exportar para el POS
window.OrvayayaAPI.pingProbe = pingProbe;
```

#### En `client/pos/app.js`, reemplazar `navigator.onLine` con `pingProbe` dentro del timing del reintento.

```javascript
// Agregar helper dentro de `pos/app.js` (si no lo estás reutilizando ya):
async function isOnline() {
  const online = window.posApp?.isOnline || (() => {})
  if (navigator.onLine) {
    // Reintentar online real
    const healthy = await window.OrvayayaAPI?.pingProbe();
    return healthy;
  }
  return false;
}

// Luego en autoSync():
async function autoSync() {
  if (!await isOnline() || !sucursalId || !localDb) return;

  // Acá está la lógica actual de reintento, pero agregar retry con backoff.
}
```

#### Reintento con backoff

```javascript
// Agregar estado de reintento a `init`:
let pendingSyncTimeout = null;
let syncBackoff = 5000; // empieza en 5 seg

async function scheduleAutoSync() {
  if (pendingSyncTimeout) clearTimeout(pendingSyncTimeout);
  pendingSyncTimeout = setTimeout(() => {
    if (!document.hidden) autoSync(); // solo si la página está visible (admin offline)
    syncBackoff = Math.min(syncBackoff * 2, 300000); // máximo 5 min
    scheduleAutoSync(); // programar siguiente intento
  }, syncBackoff);
}
```

Más detalles en `pos/app.js`, pero el cambio principal es **reemplazar el listener `online` (`window.addEventListener('online')`) con una rutina que intenta una vez y luego programa reintentos con backoff exponencial**.

### 2.5. Stock optimista (`client/pos/app.js`)

#### En `loadCatalog()` (luego de obtener `inv` del servidor):

```javascript
// Merge stock en productos ya hecho aquí (line 87-96 actual).
// Después de ese merge, guardar en IndexedDB (`syncCatalogToLocal`).
```

#### En `addToCart()` / `updateQty()`:

```javascript
function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;
  const existing = cart.find(item => item.productoId === productId);
  if (existing) {
    existing.cantidad++;
  } else {
    cart.push({
      // ... campos
      cantidad: 1,
    });
  }

  // *** NUEVO: descontar stock local para reflejar la venta que sucederá ***
  const idx = products.findIndex(p => p.id === productId);
  if (idx !== -1) {
    products[idx].stock = Math.max(0, (products[idx].stock || 0) - 1);
    renderProducts(); // Actualizar la UI (mostrará el nuevo stock)
  }

  // (El checkout guarda el outbox y sincroniza.)
}
```

#### En `checkout()`:

```javascript
async function checkout() {
  // ... mismo código de construir `sale`

  // *** NUEVO: también restar del stock en IndexedDB (aún no sincronizado) ***
  for (const item of cart) {
    // Encontrar el producto en localDb (podría estar desde catalogo local)
    // pero acá simplemente decrementar la copia en memoria (y escribir al IndexedDB la catáloga actualizada)
    // Para preservar la cache completa, podemos volver a escribir `productos` al IndexedDB con el stock actualizado.
    await localDb.productos.where('id').equals(item.productoId).modify({ stock: d => d - item.cantidad });
  }

  // ... resto del código (persistir sale localmente, PDF, sincronizar si online)
}
```

#### En el post-sincronizar:

```javascript
// Después de `syncSales` exitoso (en `autoSync`), al recibir `synced_ids`:
await OrvayayaDB.markSalesSynced(localDb, result.synced_ids);
// Opcional: refrescar la cache completa desde el servidor para reconciliar
const products = await OrvayayaAPI.getProducts({ limit: '500' });
const branches = await OrvayayaAPI.getBranches();
const savedBranchId = await OrvayayaDB.getConfig(localDb, 'sucursalId');
const branch = branches.find(b => b.id === savedBranchId) || branches[0];
const inv = await OrvayayaAPI.getInventory(branch.id);
const stockMap = {};
inv.forEach(i => { stockMap[i.productoId] = i.cantidad; });
const productsWithStock = products.map(p => ({ ...p, stock: stockMap[p.id] ?? 0 }));
await OrvayayaDB.syncCatalogToLocal(localDb, productsWithStock);
await loadCatalog(); // Re-renderizar la UI con el stock real
```

> Este stock optimista asegura que el cajero no pueda sobre-vender mientras offline.

### 2.6. Token de autenticación offline-tolerant (`server/src/modules/auth/routes.ts`)

#### Por seguridad, extender la caducidad a 7 días:

```typescript
// ANTES (server/src/modules/auth/routes.ts:30-35 original):
const token = jwt.sign(
  { id: user.id, email: user.email, rol: user.rol, nombre: user.nombre },
  process.env.JWT_SECRET,
  { expiresIn: "24h", algorithm: 'HS256' },
);

// DESPUÉS:
const token = jwt.sign(
  { id: user.id, email: user.email, rol: user.rol, nombre: user.nombre },
  process.env.JWT_SECRET,
  { expiresIn: "7d", algorithm: 'HS256' },
);
```

> Esto evita el logout forzado después de 24h sin internet en pueblo.

### 2.7. Admin — polling silencioso cada 15 min (`client/admin/app.js`)

#### Agregar elementos de estado en `admin/app.js`:

```javascript
// arriba del main en admin/app.js:
let lastRefresh = null;
let pollingInterval = null;
let pageVisibilityState = 'visible';
```

#### Detectar visibilidad:

```javascript
// Por ejemplo, en `admin/app.js` router/handler:
function onVisibilityChange() {
  pageVisibilityState = document.hidden ? 'hidden' : 'visible';
  if (pageVisibilityState === 'visible') {
    refreshCurrentSection(); // Refrescar inmediatamente si vuelve a estar visible
  }
}
document.addEventListener('visibilitychange', onVisibilityChange);
```

#### Refrescar sección automáticamente (ejemplo para dashboard):

```javascript
function setupSectionPolling() {
  // Esta función podría estar en el router o en cada renderSection o es un callback que se ejecuta al navegar.

  function startPolling(section) {
    if (pollingInterval) clearInterval(po pollingInterval);

    if (section === 'dashboard' || section === 'ventas' || section === 'movimientos' || section === 'inventario') {
      // Polling cada 15 min = 900,000 ms
      pollingInterval = setInterval(() => {
        if (document.hidden) return; // No polling en segundo plano
        refreshCurrentSection();
      }, 900000);
      // Refrescar inmediatamente al comenzar (cuando la sección se vuelve activa)
      refreshCurrentSection();
    } else {
      // Para secciones que no necesitan polling, detener polling previo
      if (pollingInterval) clearInterval(po  // pollingInterval);
      pollingInterval = null;
    }
  }

  // Llamar en el router:
  // cuando el usuario hace clic en .nav-item, llamar:
  // startPolling(activeSection);
}
```

> Implementa `refreshCurrentSection` en admin/app.js (ya existe en cada sección, ej. `renderVentas()`). El polling solo ejecutará esos renders silenciosamente.

### 2.8. Catálogo completo (`client/shared/api.js`)

#### Usar paginación hasta agotar (`shared/api.js:70-73`)

```javascript
async function getProducts(params = {}) {
  const { limit = '200', page = '1' } = params;
  const query = new URLSearchParams({ ...params, page, limit }).toString();
  return apiFetch(`/products?${query}`);
}
```

#### En `client/pos/app.js:loadCatalog()`: hacerlo recursivo hasta tener todo

```javascript
async function loadCatalog() {
  const pageSize = 200;
  let page = 1;
  let allProducts = [];

  while (true) {
    const result = await OrvayayaAPI.getProducts({ limit: pageSize.toString(), page: page.toString() });
    const productsOnPage = result.items ?? result;
    allProducts = allProducts.concat(productsOnPage);

    if (productsOnPage.length < pageSize) break; // último lote
    page++;
  }

  // Guardar al IndexedDB y continuar con inventario
  await OrvayayaDB.syncCatalogToLocal(localDb, allProducts);
  // ... resto del código (branches, inv, merge, etc.)
}
```

### 2.9. Configuración offline mejorada (admin) — no fallar en 401 cuando está offline

#### En `shared/api.js:apiFetch()`: condicionar redirección solo si hay red

```javascript
async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { ...options.headers, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `${API_BASE}${path}`;
  let response;

  try {
    response = await fetch(url, { ...options, headers });
  } catch {
    // network error (offline) → retornar un response simulado que indique offline
    return Promise.reject(new Error('Sin conexión a internet'));
  }

  // 401 on network error, no forzar logout en offline
  if (response.status === 401 && !options.skipAuthRedirect) {
    // Solo si podemos ver que la red existe (por alguna razón)
    // pero no podemos distinguir 401 por token vs timeout aquí.
    // Aproximación: si el error del servidor es "Sesión expirada", hacer logout.
    const data = await response.json().catch(() => null);
    if (data?.error === 'Sesión expirada') {
      logout();
      return Promise.reject(new Error('Sesión expirada'));
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}
```

> Esto previene el logout forzado en red 401 cuando la app está offline (error vs. expiración).

---

## 3. Resumen de los cambios (Lista de archivos)

| Ruta | Motivo |
|-------|--------|
| `client/sw.js` | Service Worker PWA (cache primero) |
| `client/manifest.json` | Manifest PWA, íconos, pantalla completa |
| `client/vendor/dexie.min.js` | Librería offline local (4.0.11) |
| `client/vendor/jspdf.umd.min.js` | PDF ticket local (2.5.2) |
| `client/pos/index.html` | Actualizar URLs de scripts para apuntar a vendor local |
| `server/src/modules/auth/routes.ts` | Extender JWT exp a 7 días |
| `client/shared/api.js` | Agregar `pingProbe()` (prueba de conectividad) |
| `client/pos/app.js` | Reintentar con backoff + ping, stock optimista + reconciliación |
| `client/admin/app.js` | Agregar polling silencioso por visibilidad (15 min) |
| `client/shared/api.js` (apiFetch) | Redirigir solo cuando hay red real (no offline) |
| `client/pos/app.js:loadCatalog()` | Iterar todas las páginas de productos (no solo 200) |

---

## 4. Comandos de verificación

### 4.1. Construcción y typecheck del servidor

```bash
# En server/:
cd server
npm run check  # TypeScript, sin emisiones -> OK
```

### 4.2. Cargar y probar el POS offline (simular offline)

1. Abrir el server (`npm run dev` en server) con el cliente servido.
2. En el navegador, ir a `http://localhost:3000/pos/` (tiene auth setup).
3. Visitar DevTools → Network → ✅ **Sin conexión** (offline).
4. Recargar la página (`Ctrl+Shift+R`). Debería cargar `/pos/index.html` + `/vendor/dexie.min.js` etc. desde el cache del Service Worker.
5. Debe mostrarse la UI del POS con catálogo, UI de connectivity (indica offline) y permitirse vender offline.
6. Ver que `navigator.onLine` es false, pero la app funciona.
7. Eventualmente desconectarte del Wi-Fi, luego volver a conectar (simular la llegada de internet). Esperar ~20s → el reintento debe intentar sincronizar.

### 4.3. Admin polling

1. Abrir `http://localhost:3000/admin/` → tiene que autenticarse como admin (admin@orvayaya.com / password de la seed).
2. Abrir DevTools de red, ver `GET /v1/dashboard/summary`, etc. Aparecer cada ~15 min.
3. Cerrar la pestaña (ocultar). No polling.
4. Abrir otra vez (visible). Debe disparar el polling nuevamente.

---

## 5. Riesgos y mitigaciones

| Riesgo | Por qué | Mitigación |
|------|------|------------|
| **Caducidad del Service Worker** (si la versión cambia) | Hay cache previo; los visitantes necesitan volver con internet para actualizar. | versionar CACHE_NAME (`v1`→`v2`) y forzar actualización al eliminar cache anterior (ej. `caches.delete` en activate). | |
| **Versiones incorrectas de vendor** | dexie 4.0.11 vs 4.0.12 puede romper algo. | Descargar del CDN exacto que usas hoy; ningún cambio programático. | |
| **Token caducado offline** | 24h → logout; 7d resuelve. | Extender expiración a 7 días. | |
| **Puerto con stock offline > real** | Usar optimista + reconciliación. | El stock local puede estar desactualizado; al sincronizar, el servidor restaura el stock real (stock de inventario). | |
| **Catálogo truncado (≤200)** | Si crecen > 200, el pueblo no ve todo. | Iterar paginación hasta acabar. | |
| **Polling del admin en segundo plano** | desperdicio de recursos. | Detener si `document.hidden`. | |
| **Offline vs. Exito del fetch** | `navigator.onLine` es engañoso. | Usar `pingProbe` (fetch al endpoint `/v1/health` con timeout) para conectividad real. | |

---

## 6. Nota sobre despliegue para produción

- **Desarrollo local**: El server sirve `client/` como static; el service worker se registra desde `/` (porque montado en root). Esto es para pruebas.
- **Despliegue real**: Cuando se despliega el server con un dominio (ej. `sistema-orvayaya.com`), el Service Worker funcionará offline para el pueblo después de su primera visita (ciudad con internet). El manifest `scope: "/"` asegura que toda la SPA se cachee.
- **Librerías auto-hospedadas**: Las guardas en `client/vendor/` son parte del repo (git commit). Las futuras actualizaciones requieren un script manual para descargar la nueva versión y reemplazar la vieja.
- **JWT**: En producción, usar una secret de mayor calidad (`JWT_SECRET` largo, aleatorio) y protegerlo adecuadamente.

---

## 7. Progreso probable (ejemplo de tiempo)

| Semanas | Tareas |
|---------|-------|
| 1-2 | Descargar vendor, crear sw/manifest, versionar jwt. |
| 3-4 | Implementar pingProbe + reintento con backoff (POS).|
| 5 | Stock optimista + reconciliación de sync (REFACT). |
| 6 | Admin polling + polling por visibilidad + polling silencioso |
| 7 | Catálogo completo (paginación) + autohospedar fuentes (opcional) |
| 8 | Pruebas en tablet offline simulado, pruebas de reintento, pruebas del admin |

---

### Para actualizar en el futuro

Si necesitas actualizar Dexie o jsPDF: ejecutar `bash` para descargar la nueva versión a `client/vendor/` y editar el HTML (`pos/index.html`). Actualizar el CACHE_NAME a `v3` y forzar actualización (eliminar caché previo en activate). El resto debería ser compatible.

---

**FIN DEL PLAN**

Este plan contiene todo lo necesario para cumplir con los requisitos offline-first, con modificaciones mínimas y manteniendo la consistencia del plan existente.