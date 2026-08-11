import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp, loginToken } from "./helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let adminToken: string;

const BOGUS_UUID = "00000000-0000-0000-0000-000000000000";

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

async function getMovimientosByProducto(productoId: string) {
  const res = await app.inject({
    method: "GET",
    url: `/v1/movimientos?producto_id=${productoId}`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  return res.json() as Array<{ id: string; tipo: string; cantidad: number }>;
}

async function mkProduct(tag: string) {
  const suf = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const r = await app.inject({
    method: "POST",
    url: "/v1/products",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { sku: `ADJ-${tag}-${suf}`, nombre: `Ajuste Test ${tag}`, precio: 10, categoria: "Tests" },
  });
  expect(r.statusCode).toBe(201);
  return r.json().id;
}

async function mkPresentation(productoId: string, nombre: string, factor: number) {
  const r = await app.inject({
    method: "POST",
    url: "/v1/presentaciones",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { producto_id: productoId, nombre_presentacion: nombre, factor_conversion: factor, precio_venta: 55 },
  });
  expect(r.statusCode).toBe(201);
  return r.json().id;
}

async function adjust(payload: any) {
  return await app.inject({
    method: "POST",
    url: "/v1/inventory/adjust",
    headers: { authorization: `Bearer ${adminToken}` },
    payload,
  });
}

async function resetStock(productoId: string, ciudadId: string, stock: number) {
  const actual = stockOf(await getInventory(ciudadId), productoId);
  if (actual > stock) {
    await adjust({ producto_id: productoId, sucursal_id: ciudadId, cantidad: actual - stock, tipo: "salida" });
  } else if (actual < stock) {
    await adjust({ producto_id: productoId, sucursal_id: ciudadId, cantidad: stock - actual, tipo: "entrada" });
  }
}

beforeAll(async () => {
  app = await buildApp();
  adminToken = await loginToken(app, "admin@orvayaya.com", "admin123");
});

afterAll(async () => {
  await app.close();
});

describe("Ajuste de inventario: race condition fix (A.5)", () => {
  let ciudadId: string;

  beforeAll(async () => {
    const suc = await app.inject({
      method: "GET",
      url: "/v1/sucursales",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const branches = suc.json();
    const ciudad = branches.find((b: any) => b.tipo === "ciudad");
    expect(ciudad).toBeDefined();
    ciudadId = ciudad.id;
  });

  it("1. Entrada con factor: 2 presentaciones de 6 → 201 y movimiento creado", async () => {
    const prodId = await mkProduct("ENTRADA");
    const packId = await mkPresentation(prodId, "Paquete de 6", 6);

    const stockAntes = stockOf(await getInventory(ciudadId), prodId);

    const res = await adjust({
      producto_id: prodId,
      sucursal_id: ciudadId,
      cantidad: 2,
      tipo: "entrada",
      presentacion_id: packId,
      nota: "Entrada de 2 paquetes de 6",
    });

    expect(res.statusCode).toBe(201);
    const result = res.json();
    expect(result).toMatchObject({
      delta: 12,
      factor_conversion: 6,
      stock_anterior: stockAntes,
      stock_nuevo: stockAntes + 12,
    });
    expect(result.movimiento_id).toBeDefined();

    // El movimiento existe
    const movs = await getMovimientosByProducto(prodId);
    const entrada = movs.find((m) => m.tipo === "entrada");
    expect(entrada).toBeDefined();
    expect(entrada?.cantidad).toBe(12);
  });

  it("2. Salida con stock justo → 201 y stock exacto (no negativo)", async () => {
    const prodId = await mkProduct("SALIDA");
    await resetStock(prodId, ciudadId, 12);

    const res = await adjust({
      producto_id: prodId,
      sucursal_id: ciudadId,
      cantidad: 12,
      tipo: "salida",
    });

    expect(res.statusCode).toBe(201);
    const result = res.json();
    expect(result.delta).toBe(-12);
    expect(result.stock_nuevo).toBe(0);
    expect(result.stock_nuevo).toBeGreaterThanOrEqual(0);

    expect(stockOf(await getInventory(ciudadId), prodId)).toBe(0);
  });

  it("3. Salida insuficiente (individual): stock 10, salida 100 → 400 con stockActual, sin cambios ni movimiento", async () => {
    const prodId = await mkProduct("INSUF");
    await resetStock(prodId, ciudadId, 10);

    const res = await adjust({
      producto_id: prodId,
      sucursal_id: ciudadId,
      cantidad: 100,
      tipo: "salida",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "Stock insuficiente para realizar la salida", stockActual: 10 });

    // Stock sin cambios
    expect(stockOf(await getInventory(ciudadId), prodId)).toBe(10);

    // Sin movimiento creado
    const movs = await getMovimientosByProducto(prodId);
    expect(movs.find((m) => m.tipo === "salida")).toBeUndefined();
  });

  it("4. Ajuste (tipo 'ajuste') negativo insuficiente → 400 y stock sin cambios", async () => {
    const prodId = await mkProduct("AJNEG");
    await resetStock(prodId, ciudadId, 10);

    const res = await adjust({
      producto_id: prodId,
      sucursal_id: ciudadId,
      cantidad: -15,
      tipo: "ajuste",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "Stock insuficiente para realizar la salida", stockActual: 10 });
    expect(stockOf(await getInventory(ciudadId), prodId)).toBe(10);
  });

  it("5. Registro inexistente: ajuste a producto/sucursal sin fila de inventario → 404", async () => {
    const res = await adjust({
      producto_id: BOGUS_UUID,
      sucursal_id: ciudadId,
      cantidad: 5,
      tipo: "entrada",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Registro de inventario no encontrado para ese producto y sucursal");
  });

  it("6. Concurrencia /v1/inventory/adjust (entrada): stock 10, dos +5 en paralelo → stock final 20 (sin lost update)", async () => {
    const prodId = await mkProduct("CONC-ENTRADA");
    await resetStock(prodId, ciudadId, 10);

    const promises = [
      adjust({ producto_id: prodId, sucursal_id: ciudadId, cantidad: 5, tipo: "entrada" }),
      adjust({ producto_id: prodId, sucursal_id: ciudadId, cantidad: 5, tipo: "entrada" }),
    ];

    const results = await Promise.all(promises);
    expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(stockOf(await getInventory(ciudadId), prodId)).toBe(20);
  });

  it("7. Concurrencia /v1/inventory/adjust (salida): stock 10, dos salidas de 8 → 1×201 y 1×400, stock final 2", async () => {
    const prodId = await mkProduct("CONC-SALIDA");
    await resetStock(prodId, ciudadId, 10);

    const promises = [
      adjust({ producto_id: prodId, sucursal_id: ciudadId, cantidad: 8, tipo: "salida" }),
      adjust({ producto_id: prodId, sucursal_id: ciudadId, cantidad: 8, tipo: "salida" }),
    ];

    const results = await Promise.all(promises);
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([201, 400]);

    const finalStock = stockOf(await getInventory(ciudadId), prodId);
    expect(finalStock).toBe(2);
    expect(finalStock).toBeGreaterThanOrEqual(0);

    // 5 salidas de 8 → solo 1 éxito
    await resetStock(prodId, ciudadId, 10);

    const fivePromises = Array(5).fill(null).map(() => adjust({ producto_id: prodId, sucursal_id: ciudadId, cantidad: 8, tipo: "salida" }));
    const fiveResults = await Promise.all(fivePromises);
    const successCount = fiveResults.filter((r) => r.statusCode === 201).length;
    expect(successCount).toBe(1);

    const finalStock2 = stockOf(await getInventory(ciudadId), prodId);
    expect(finalStock2).toBe(2);
    expect(finalStock2).toBeGreaterThanOrEqual(0);
  });

  it("8. Concurrencia /v1/inventory/adjust-batch: dos planillas en paralelo sumando al mismo producto → stock final = suma exacta", async () => {
    const prodId = await mkProduct("CONC-BATCH");
    await resetStock(prodId, ciudadId, 4);

    const promises = [
      app.inject({
        method: "POST",
        url: "/v1/inventory/adjust-batch",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { sucursal_id: ciudadId, items: [{ producto_id: prodId, cantidad: 5 }] },
      }),
      app.inject({
        method: "POST",
        url: "/v1/inventory/adjust-batch",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { sucursal_id: ciudadId, items: [{ producto_id: prodId, cantidad: 5 }] },
      }),
    ];

    const results = await Promise.all(promises);
    expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
    // 4 + 5 + 5 = 14: sin lost update el stock final es la suma exacta
    expect(stockOf(await getInventory(ciudadId), prodId)).toBe(14);
  });
});