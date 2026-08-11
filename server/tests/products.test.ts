import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp, loginToken } from "./helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let adminToken: string;
let cajeroToken: string;

beforeAll(async () => {
  app = await buildApp();
  adminToken = await loginToken(app, "admin@orvayaya.com", "admin123");
  cajeroToken = await loginToken(app, "cajero@orvayaya.com", "cajero123");
});

afterAll(async () => {
  await app.close();
});

describe("Products Module & Regressions", () => {
  it("GET /v1/products con ID inválido devuelve 422 Identificador inválido", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/products/invalid-uuid-123",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("Identificador inválido");
  });

  it("POST /v1/products requiere rol admin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${cajeroToken}` },
      payload: { sku: "SKU-TEST-R", nombre: "Prueba Rol", precio: "10.00" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/products con costo y campos persiste correctamente", async () => {
    const uniqueSku = `SKU-TEST-${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        sku: uniqueSku,
        nombre: "Producto Test Costo",
        precio: "50.00",
        costo: "30.00",
        categoria: "Test",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.sku).toBe(uniqueSku);
    expect(body.costo).toBe("30.00");
  });

  // ── B.3 regression: LIKE wildcards are escaped ──

  it("B.3: search con _ (comodín LIKE) no matchea como wildcard", async () => {
    const suffix = Date.now().toString(36);
    const sku = `LIKE-TEST-${suffix}`;
    const nombre = `ABCDEF${suffix}`;

    // Create a product with known name
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { sku, nombre, precio: "1.00" },
    });
    expect(createRes.statusCode).toBe(201);

    // Search with _ wildcard: AB_D should NOT match ABCDEF (with fix, _ is literal)
    const res = await app.inject({
      method: "GET",
      url: `/v1/products?search=AB_D`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const items = res.json().items || res.json();
    const found = (Array.isArray(items) ? items : []).filter((p: any) => p.sku === sku);
    expect(found).toHaveLength(0);
  });

  it("B.3: search con % (comodín LIKE) no matchea como wildcard", async () => {
    const suffix = Date.now().toString(36);
    const sku = `LIKE-PCT-${suffix}`;
    const nombre = `XYZUVW${suffix}`;

    await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { sku, nombre, precio: "1.00" },
    });

    // Search with % wildcard: XY% should NOT match as a prefix wildcard
    const res = await app.inject({
      method: "GET",
      url: `/v1/products?search=XY%25`,   // %25 is URL-encoded %
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const items = res.json().items || res.json();
    const found = (Array.isArray(items) ? items : []).filter((p: any) => p.sku === sku);
    expect(found).toHaveLength(0);
  });

  it("B.3: búsqueda normal sigue funcionando tras escape", async () => {
    const suffix = Date.now().toString(36);
    const sku = `LIKE-OK-${suffix}`;
    const nombre = `BusquedaNormal${suffix}`;

    await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { sku, nombre, precio: "1.00" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/products?search=BusquedaNormal${suffix}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items || res.json();
    const found = (Array.isArray(items) ? items : []).filter((p: any) => p.sku === sku);
    expect(found).toHaveLength(1);
  });

  // ── B.6 regression: Zod validation rejects invalid bodies ──

  it("B.6: POST /v1/products con body inválido devuelve 400 con detalles de validación", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { precio: "10.00" }, // missing sku and nombre
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Error de validación");
    expect(body.detalles).toBeDefined();
    expect(Array.isArray(body.detalles)).toBe(true);
    expect(body.detalles.length).toBeGreaterThan(0);
  });

  // ── Presentaciones integradas en la creación del producto ──

  it("crea producto con presentaciones atómicamente (array en POST)", async () => {
    const sku = `SKU-PRES-${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        sku,
        nombre: "Producto con Presentaciones",
        precio: "20.00",
        presentaciones: [
          { nombre_presentacion: "Caja de 12", factor_conversion: 12, precio_venta: 210.00 },
          { nombre_presentacion: "Display de 24", factor_conversion: 24, precio_venta: 400.00 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.sku).toBe(sku);
    expect(body.presentaciones).toHaveLength(2);
    expect(body.presentaciones[0].nombrePresentacion).toBe("Caja de 12");
    expect(body.presentaciones[0].factorConversion).toBe(12);

    const listRes = await app.inject({
      method: "GET",
      url: `/v1/presentaciones?producto_id=${body.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const presentaciones = listRes.json();
    expect(presentaciones).toHaveLength(2);
    expect(presentaciones.map((p: any) => p.nombrePresentacion).sort()).toEqual(["Caja de 12", "Display de 24"]);
  });

  it("crea producto sin presentaciones cuando el array no se envía (retrocompatible)", async () => {
    const sku = `SKU-NOPRES-${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { sku, nombre: "Producto Sin Presentaciones", precio: "5.00" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.presentaciones).toEqual([]);

    const listRes = await app.inject({
      method: "GET",
      url: `/v1/presentaciones?producto_id=${body.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.json()).toHaveLength(0);
  });

  it("presentaciones con nombre duplicado en el array → 409 y producto NO creado (rollback)", async () => {
    const sku = `SKU-DUP-${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        sku,
        nombre: "Producto Duplicado",
        precio: "10.00",
        presentaciones: [
          { nombre_presentacion: "Caja de 6", factor_conversion: 6, precio_venta: 60.00 },
          { nombre_presentacion: "Caja de 6", factor_conversion: 6, precio_venta: 61.00 },
        ],
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("duplicada");

    const searchRes = await app.inject({
      method: "GET",
      url: `/v1/products?search=${encodeURIComponent(sku)}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const items = searchRes.json().items || [];
    expect(items.filter((p: any) => p.sku === sku)).toHaveLength(0);
  });

  it("presentación inválida (factor 0) → 400 y producto NO creado (rollback)", async () => {
    const sku = `SKU-INV-${Date.now()}`;
    const res = await app.inject({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        sku,
        nombre: "Producto Inválido",
        precio: "10.00",
        presentaciones: [
          { nombre_presentacion: "Caja de 6", factor_conversion: 0, precio_venta: 60.00 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Error de validación");

    const searchRes = await app.inject({
      method: "GET",
      url: `/v1/products?search=${encodeURIComponent(sku)}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const items = searchRes.json().items || [];
    expect(items.filter((p: any) => p.sku === sku)).toHaveLength(0);
  });
});
