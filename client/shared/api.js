/**
 * API Client — Shared HTTP client for the Sistema Orvayaya frontend.
 * Handles auth token management and provides typed methods for each endpoint.
 */

const API_BASE = '/v1';

function getToken() {
  return localStorage.getItem('orvayaya_token');
}

function setToken(token) {
  localStorage.setItem('orvayaya_token', token);
}

function getUser() {
  const user = localStorage.getItem('orvayaya_user');
  return user ? JSON.parse(user) : null;
}

function setUser(user) {
  localStorage.setItem('orvayaya_user', JSON.stringify(user));
}

function logout() {
  localStorage.removeItem('orvayaya_token');
  localStorage.removeItem('orvayaya_user');
  window.location.href = '/login.html';
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && !options.skipAuthRedirect) {
    logout();
    throw new Error('Sesión expirada');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Error desconocido' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// --- Auth ---
async function login(email, password) {
  const data = await apiFetch('/auth/login', {
    method: 'POST',
    skipAuthRedirect: true,   // no redirige ni hace logout en 401 (credenciales inválidas)
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  setUser(data.user);
  return data;
}

// --- Products ---
async function getProducts(params = {}) {
  const query = new URLSearchParams(params).toString();
  return apiFetch(`/products?${query}`);
}

async function getCategories() {
  return apiFetch('/products/categories');
}

async function createProduct(product) {
  return apiFetch('/products', { method: 'POST', body: JSON.stringify(product) });
}

async function updateProduct(id, product) {
  return apiFetch(`/products/${id}`, { method: 'PUT', body: JSON.stringify(product) });
}

async function deleteProduct(id) {
  return apiFetch(`/products/${id}`, { method: 'DELETE' });
}

// --- Inventory ---
async function getInventory(sucursalId) {
  const query = sucursalId ? `?sucursal_id=${sucursalId}` : '';
  return apiFetch(`/inventory${query}`);
}

async function getGlobalInventory() {
  return apiFetch('/inventory/global');
}

async function getBranches() {
  return apiFetch('/sucursales');
}

// --- Transfers ---
async function createTransfer(productoId, cantidad) {
  return apiFetch('/transfers', {
    method: 'POST',
    body: JSON.stringify({ producto_id: productoId, cantidad }),
  });
}

async function getTransfers(limit = 20) {
  return apiFetch(`/transfers?limit=${limit}`);
}

// --- Sales ---
async function getSales(params = {}) {
  const query = new URLSearchParams(params).toString();
  return apiFetch(`/sales?${query}`);
}

async function createSale(sucursalId, items) {
  return apiFetch('/sales', {
    method: 'POST',
    body: JSON.stringify({ sucursal_id: sucursalId, items }),
  });
}

// --- Dashboard ---
async function getDashboardSummary(fechaInicio, fechaFin) {
  const params = {};
  if (fechaInicio) params.fecha_inicio = fechaInicio;
  if (fechaFin) params.fecha_fin = fechaFin;
  const query = new URLSearchParams(params).toString();
  return apiFetch(`/dashboard/summary?${query}`);
}

// --- Sync ---
async function syncSales(sucursalId, ventasData, idempotencyKey) {
  return apiFetch('/sync', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ sucursal_id: sucursalId, ventas: ventasData }),
  });
}

// Export for use in modules
window.OrvayayaAPI = {
  login, logout, getToken, getUser, setToken, setUser,
  getProducts, getCategories, createProduct, updateProduct, deleteProduct,
  getInventory, getGlobalInventory, getBranches,
  createTransfer, getTransfers,
  getSales, createSale,
  getDashboardSummary,
  syncSales,
};
