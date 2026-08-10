/**
 * Dexie.js — IndexedDB wrapper for POS offline-first.
 * Stores products catalog and pending sales locally.
 */

// Dexie is loaded from CDN in the POS page
function initLocalDB() {
  const db = new Dexie('OrvayayaPOS');

  db.version(1).stores({
    productos: 'id, sku, nombre, categoria, precio',
    ventasPendientes: 'id, createdAt, synced',
    config: 'key',
  });

  return db;
}

// Save the full product catalog locally
async function syncCatalogToLocal(localDb, products) {
  await localDb.transaction('rw', localDb.productos, async () => {
    await localDb.productos.clear();
    await localDb.productos.bulkAdd(products);
  });
}

// Get all products from local DB
async function getLocalProducts(localDb, categoria) {
  if (categoria && categoria !== 'TODOS') {
    return localDb.productos.where('categoria').equalsIgnoreCase(categoria).toArray();
  }
  return localDb.productos.toArray();
}

// UUID v4 helper — fallback para contextos no-HTTPS (IP LAN)
function uuidv4() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  // Fallback: Math.random (solo para id local; el servidor valida UUID)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Save a pending sale locally
async function savePendingSale(localDb, sale) {
  await localDb.ventasPendientes.add({
    ...sale,
    id: sale.id || uuidv4(),
    createdAt: new Date().toISOString(),
    synced: 0,  // número 0, no booleano — coincide con .equals(0) en Dexie
  });
}

// Get all pending (unsynced) sales
async function getPendingSales(localDb) {
  return localDb.ventasPendientes.where('synced').equals(0).toArray();
}

// Mark sales as synced and remove them
async function markSalesSynced(localDb, syncedIds) {
  await localDb.transaction('rw', localDb.ventasPendientes, async () => {
    await localDb.ventasPendientes.where('id').anyOf(syncedIds).delete();
  });
}

// Mark a sale as failed (keep it for retry/reconciliation, don't delete)
async function markSaleFailed(localDb, id, errorMsg) {
  await localDb.ventasPendientes.update(id, {
    syncError: errorMsg,
    synced: 0,
    failedAt: Date.now()
  });
}

// Get count of pending sales
async function getPendingSalesCount(localDb) {
  return localDb.ventasPendientes.count();
}

// Save config value
async function saveConfig(localDb, key, value) {
  await localDb.config.put({ key, value });
}

// Get config value
async function getConfig(localDb, key) {
  const entry = await localDb.config.get(key);
  return entry ? entry.value : null;
}

window.OrvayayaDB = {
  initLocalDB,
  syncCatalogToLocal,
  getLocalProducts,
  savePendingSale,
  getPendingSales,
  markSalesSynced,
  markSaleFailed,
  getPendingSalesCount,
  saveConfig,
  getConfig,
  uuidv4,
};
