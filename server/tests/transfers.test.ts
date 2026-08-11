import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp, loginToken } from "./helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let adminToken: string;

async function getInventory(sucursalId: string) {
  const res = await app.inject({
    method: "GET",
    url: `/v1/inventory?sucursal_id=${sucursalId}`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  return res.json() as Array<{ productoId: string; cantidad: number }>;
}

function stockOf(list: any[], productoId: string): number {
  const r = list.find((i: any) => i.productoId === productoId);
  return r?.cantidad ?? 0;
}

async function resetStock(productoId: string, ciudadId: string, puebloId: string, ciudadStock: number, puebloStock: number = 0) {
  // Get current stock first
  const cInv = await getInventory(ciudadId);
  const pInv = await getInventory(puebloId);
  const currentCiudad = stockOf(cInv, productoId);
  const currentPueblo = stockOf(pInv, productoId);

  // Adjust ciudad: use salida to remove excess, then entrada to add if needed
  if (currentCiudad > ciudadStock) {
    await app.inject({
      method: "POST",
      url: "/v1/inventory/adjust",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { producto_id: productoId, sucursal_id: ciudadId, cantidad: currentCiudad - ciudadStock, tipo: "salida" },
    });
  } else if (currentCiudad < ciudadStock) {
    await app.inject({
      method: "POST",
      url: "/v1/inventory/adjust",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { producto_id: productoId, sucursal_id: ciudadId, cantidad: ciudadStock - currentCiudad, tipo: "entrada" },
    });
  }

  // Adjust pueblo similarly
  if (currentPueblo > puebloStock) {
    await app.inject({
      method: "POST",
      url: "/v1/inventory/adjust",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { producto_id: productoId, sucursal_id: puebloId, cantidad: currentPueblo - puebloStock, tipo: "salida" },
    });
  } else if (currentPueblo < puebloStock) {
    await app.inject({
      method: "POST",
      url: "/v1/inventory/adjust",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { producto_id: productoId, sucursal_id: puebloId, cantidad: puebloStock - currentPueblo, tipo: "entrada" },
    });
  }
}

beforeAll(async () => {
  app = await buildApp();
  adminToken = await loginToken(app, "admin@orvayaya.com", "admin123");
});

afterAll(async () => {
  await app.close();
});

describe("Transfers: race condition fix (A.4)", () => {
  let ciudadId: string;
  let puebloId: string;

  beforeAll(async () => {
    const suc = await app.inject({
      method: "GET",
      url: "/v1/sucursales",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const branches = suc.json();
    const ciudad = branches.find((b: any) => b.tipo === "ciudad");
    const pueblo = branches.find((b: any) => b.tipo === "pueblo");
    expect(ciudad).toBeDefined();
    expect(pueblo).toBeDefined();
    ciudadId = ciudad.id;
    puebloId = pueblo.id;
  });

  it("1. Transferencia válida con factor: stock 30 en ciudad, transfer 2 presentaciones (10 uds)", async () => {
    const suf = Date.now().toString(36) + Math.random().toString(36).slice(2);
    
    const r = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { sku: `TRF1-${suf}`, nombre: "Aceite Transfer Test 1", precio: 10, categoria: "Tests" },
    });
    expect(r.statusCode).toBe(201);
    const prodId = r.json().id;

    const p = await app.inject({
      method: "POST",
      url: "/v1/presentaciones",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { producto_id: prodId, nombre_presentacion: "Caja de 5", factor_conversion: 5, precio_venta: 55 },
    });
    expect(p.statusCode).toBe(201);
    const packId = p.json().id;

    // Setup stock: 30 units in ciudad
    await resetStock(prodId, ciudadId, puebloId, 30, 0);

    const res = await app.inject({
      method: "POST",
      url: "/v1/transfers",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { producto_id: prodId, cantidad: 2, presentacion_id: packId },
    });

    expect(res.statusCode).toBe(201);
    const result = res.json();
    expect(result).toMatchObject({
      factor_conversion: 5,
      stock_origen_restante: 20,
      stock_destino_nuevo: 10,
    });
    expect(result.transfer_id).toBeDefined();

    // Verify inventory
    const cInv = await getInventory(ciudadId);
    const pInv = await getInventory(puebloId);
    expect(stockOf(cInv, prodId)).toBe(20);
    expect(stockOf(pInv, prodId)).toBe(10);

    // Verify transfer and movements exist
    const transfers = await app.inject({
      method: "GET",
      url: "/v1/transfers",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(transfers.json().length).toBeGreaterThan(0);
  });

  it("2. Stock insuficiente (individual): transfer de 100 uds con stock 10 → 400", async () => {
    const suf = Date.now().toString(36) + Math.random().toString(36).slice(2);
    
    const r = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { sku: `TRF2-${suf}`, nombre: "Aceite Transfer Test 2", precio: 10, categoria: "Tests" },
    });
    expect(r.statusCode).toBe(201);
    const prodId = r.json().id;

    // Setup stock: 10 units in ciudad
    await resetStock(prodId, ciudadId, puebloId, 10, 0);

    const res = await app.inject({
      method: "POST",
      url: "/v1/transfers",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { producto_id: prodId, cantidad: 100 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "Stock insuficiente en origen",
      stockDisponible: 10,
    });

    // Stock unchanged
    const cInv = await getInventory(ciudadId);
    expect(stockOf(cInv, prodId)).toBe(10);

    // No transfer created
    const transfers = await app.inject({
      method: "GET",
      url: "/v1/transfers",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const tr = transfers.json().find((t: any) => t.productoId === prodId);
    expect(tr).toBeUndefined();
  });

  it("3. Concurrencia /v1/transfers: stock = 10, dos transfers de 8 en paralelo → exactamente 1×201 y 1×400", async () => {
    const suf = Date.now().toString(36) + Math.random().toString(36).slice(2);
    
    const r = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { sku: `TRF3-${suf}`, nombre: "Aceite Transfer Test 3", precio: 10, categoria: "Tests" },
    });
    expect(r.statusCode).toBe(201);
    const prodId = r.json().id;

    // Setup stock: 10 units in ciudad
    await resetStock(prodId, ciudadId, puebloId, 10, 0);

    const promises = [
      app.inject({
        method: "POST",
        url: "/v1/transfers",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { producto_id: prodId, cantidad: 8 },
      }),
      app.inject({
        method: "POST",
        url: "/v1/transfers",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { producto_id: prodId, cantidad: 8 },
      }),
    ];

    const results = await Promise.all(promises);
    const statuses = results.map(r => r.statusCode).sort();
    expect(statuses).toEqual([201, 400]);

    // Final stock ciudad = 2 (never negative), pueblo = 8
    const cInv = await getInventory(ciudadId);
    const pInv = await getInventory(puebloId);
    expect(stockOf(cInv, prodId)).toBe(2);
    expect(stockOf(pInv, prodId)).toBe(8);

    // 5 transfers of 8 → only 1 success
    await resetStock(prodId, ciudadId, puebloId, 10, 0);

    const fivePromises = Array(5).fill(null).map(() => app.inject({
      method: "POST",
      url: "/v1/transfers",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { producto_id: prodId, cantidad: 8 },
    }));

    const fiveResults = await Promise.all(fivePromises);
    const successCount = fiveResults.filter(r => r.statusCode === 201).length;
    expect(successCount).toBe(1);

    const cInv2 = await getInventory(ciudadId);
    const pInv2 = await getInventory(puebloId);
    expect(stockOf(cInv2, prodId)).toBe(2);
    expect(stockOf(pInv2, prodId)).toBe(8);
  });

  it("4. Concurrencia /v1/transfers-batch: dos batches en paralelo del mismo producto con sumas > stock", async () => {
    const suf = Date.now().toString(36) + Math.random().toString(36).slice(2);
    
    const r = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { sku: `TRF4-${suf}`, nombre: "Aceite Transfer Test 4", precio: 10, categoria: "Tests" },
    });
    expect(r.statusCode).toBe(201);
    const prodId = r.json().id;

    // Reset stock to 15
    await resetStock(prodId, ciudadId, puebloId, 15, 0);

    // Batch 1: tries to transfer 10 units
    // Batch 2: tries to transfer 10 units
    // Total 20 > stock 15, but atomic per item ensures no negative stock
    const promises = [
      app.inject({
        method: "POST",
        url: "/v1/transfers-batch",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { items: [{ producto_id: prodId, cantidad: 10 }] },
      }),
      app.inject({
        method: "POST",
        url: "/v1/transfers-batch",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { items: [{ producto_id: prodId, cantidad: 10 }] },
      }),
    ];

    const results = await Promise.all(promises);
    const statuses = results.map(r => r.statusCode).sort();

    // One may succeed, one fails, or both fail - but stock never negative
    const cInv = await getInventory(ciudadId);
    const pInv = await getInventory(puebloId);
    const stockFinalCiudad = stockOf(cInv, prodId);
    const stockFinalPueblo = stockOf(pInv, prodId);

    expect(stockFinalCiudad).toBeGreaterThanOrEqual(0);
    expect(stockFinalPueblo).toBeGreaterThanOrEqual(0);
    expect(15 - stockFinalCiudad).toBe(stockFinalPueblo); // invariant: initial - final == transferred

    // Sum of successful transfers == stock moved
    const totalTransferred = results
      .filter(r => r.statusCode === 201)
      .reduce((sum, r) => sum + r.json().items[0].unidades, 0);
    expect(totalTransferred).toBe(15 - stockFinalCiudad);
  });

  it("5. Transferencia simple sin presentación (factor 1)", async () => {
    const suf = Date.now().toString(36) + Math.random().toString(36).slice(2);
    
    const r = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { sku: `TRF5-${suf}`, nombre: "Aceite Transfer Test 5", precio: 10, categoria: "Tests" },
    });
    expect(r.statusCode).toBe(201);
    const prodId = r.json().id;

    // Reset stock: 50 in ciudad, 0 in pueblo
    await resetStock(prodId, ciudadId, puebloId, 50, 0);

    const res = await app.inject({
      method: "POST",
      url: "/v1/transfers",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { producto_id: prodId, cantidad: 15 },
    });

    expect(res.statusCode).toBe(201);
    const result = res.json();
    expect(result.factor_conversion).toBe(1);
    expect(result.stock_origen_restante).toBe(35);
    expect(result.stock_destino_nuevo).toBe(15);
  });
});