import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp, loginToken, truncateTestTables } from "./helpers.js";
import { db } from "../src/db/index.js";
import { ventas, inventario } from "../src/db/schema/index.js";
import { eq, and } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let adminToken: string;
let cajeroToken: string;

let gaseosaProductoId: string | undefined;
let gaseosaSucursalId: string | undefined;
let gaseosaPresentacionUnidadId: string | undefined;

beforeAll(async () => {
  app = await buildApp();
  adminToken = await loginToken(app, "admin@orvayaya.com", "admin123");
  cajeroToken = await loginToken(app, "cajero@orvayaya.com", "cajero123");
});

afterAll(async () => {
  await app.close();
});

describe("Sales & Sync Module", () => {
  beforeAll(async () => {
    await truncateTestTables();
  });

  it("POST /v1/sync sin autenticación devuelve 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: { "idempotency-key": "00000000-0000-0000-0000-000000000000" },
      payload: { sucursal_id: "some-id", ventas: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/sync con venta.id malicioso no inyecta SQL (savepoint validado)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: {
        authorization: `Bearer ${cajeroToken}`,
        "idempotency-key": crypto.randomUUID(),
      },
      payload: {
        sucursal_id: "00000000-0000-0000-0000-000000000000",
        ventas: [
          {
            id: "x; DROP TABLE ventas--",
            items: [],
            total: 0,
            created_at: new Date().toISOString(),
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].error).toContain("Id de venta inválido");
  });

  it("POST /v1/sales con stock excesivo devuelve 400 y frena la venta", async () => {
    // get a branch and product first
    const invRes = await app.inject({
      method: "GET",
      url: "/v1/inventory",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const inv = invRes.json();
    expect(inv.length).toBeGreaterThan(0);
    const item = inv[0];

    // Get a presentation for this product
    const presRes = await app.inject({
      method: "GET",
      url: `/v1/presentaciones?producto_id=${item.productoId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const presentaciones = presRes.json();
    expect(presentaciones.length).toBeGreaterThan(0);

    const res = await app.inject({
      method: "POST",
      url: "/v1/sales",
      headers: { authorization: `Bearer ${cajeroToken}` },
      payload: {
        sucursal_id: item.sucursalId,
        items: [
          {
            presentacionId: presentaciones[0].id,
            cantidad: 999999,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Stock insuficiente");
  });

  it("GET /v1/reports/ventas y /v1/reports/ganancias responden a usuario autenticado", async () => {
    const resV = await app.inject({
      method: "GET",
      url: "/v1/reports/ventas",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(resV.statusCode).toBe(200);
    expect(resV.json().total_ventas).toBeDefined();

    const resG = await app.inject({
      method: "GET",
      url: "/v1/reports/ganancias",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(resG.statusCode).toBe(200);
    expect(resG.json().total_ganancia).toBeDefined();
  });

  it("sync aplica factor de conversión y montos del servidor (total forjado ignorado)", async () => {
    // Find a product that has a "Paquete de 6" presentation (factor 6)
    const invRes = await app.inject({
      method: "GET",
      url: "/v1/inventory",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const inv = invRes.json();
    let paqueteId: string | undefined;
    let precioUnitario: number | undefined;

    for (const item of inv) {
      const presRes = await app.inject({
        method: "GET",
        url: `/v1/presentaciones?producto_id=${item.productoId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const presentaciones = presRes.json();
      const paquete = presentaciones.find((p: any) => p.nombrePresentacion === "Paquete de 6");
      if (paquete) {
        paqueteId = paquete.id;
        precioUnitario = parseFloat(paquete.precioVenta);
        gaseosaProductoId = item.productoId;
        gaseosaSucursalId = item.sucursalId;
        const unidad = presentaciones.find((p: any) => p.nombrePresentacion === "Unidad");
        gaseosaPresentacionUnidadId = unidad?.id;
        break;
      }
    }

    expect(paqueteId).toBeDefined();
    expect(precioUnitario).toBeDefined();

    // Read stock before
    const [invBefore] = await db.select().from(inventario).where(and(
      eq(inventario.productoId, gaseosaProductoId!),
      eq(inventario.sucursalId, gaseosaSucursalId!),
    ));
    const stockBefore = invBefore?.cantidad ?? 0;

    const ventaId = crypto.randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: {
        authorization: `Bearer ${cajeroToken}`,
        "idempotency-key": crypto.randomUUID(),
      },
      payload: {
        sucursal_id: gaseosaSucursalId,
        ventas: [
          {
            id: ventaId,
            items: [
              {
                presentacionId: paqueteId,
                cantidad: 2,
                productoId: gaseosaProductoId,
                productoNombre: "gaseosa",
                presentacionNombre: "Paquete de 6",
                factorConversion: 6,
                unidadesMinimas: 2,
                precioUnitario: 100,
                subtotal: 100,
              },
            ],
            total: 1, // ← total forjado del cliente, debe ser ignorado
            created_at: new Date().toISOString(),
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.errors).toHaveLength(0);
    expect(body.synced_ids).toContain(ventaId);

    // Persisted sale: total is server-side (precioUtario × 2), NOT 1
    const [sale] = await db.select().from(ventas).where(eq(ventas.id, ventaId));
    expect(sale).toBeDefined();
    expect(sale.items[0].cantidad).toBe(2);
    expect(sale.items[0].factorConversion).toBe(6);
    expect(sale.items[0].unidadesMinimas).toBe(12); // 2 * factor 6
    expect(parseFloat(sale.total)).toBe((precioUnitario ?? 0) * 2);

    // Stock decremented by 2 * 6 = 12
    const [invAfter] = await db.select().from(inventario).where(and(
      eq(inventario.productoId, gaseosaProductoId!),
      eq(inventario.sucursalId, gaseosaSucursalId!),
    ));
    expect(stockBefore - invAfter.cantidad).toBe(12);
  });

  it("sync con stock insuficiente registra error y NO descuenta stock", async () => {
    expect(gaseosaProductoId).toBeDefined();
    expect(gaseosaSucursalId).toBeDefined();
    expect(gaseosaPresentacionUnidadId).toBeDefined();

    const [invBefore] = await db.select().from(inventario).where(and(
      eq(inventario.productoId, gaseosaProductoId!),
      eq(inventario.sucursalId, gaseosaSucursalId!),
    ));
    const stockAntes = invBefore?.cantidad ?? 0;

    const res = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: {
        authorization: `Bearer ${cajeroToken}`,
        "idempotency-key": crypto.randomUUID(),
      },
      payload: {
        sucursal_id: gaseosaSucursalId,
        ventas: [
          {
            id: crypto.randomUUID(),
            items: [
              {
                presentacionId: gaseosaPresentacionUnidadId,
                cantidad: 999999,
                productoId: gaseosaProductoId,
                productoNombre: "gaseosa",
                presentacionNombre: "Unidad",
                factorConversion: 1,
                unidadesMinimas: 999999,
                precioUnitario: 10,
                subtotal: 999999 * 10,
              },
            ],
            total: 999999 * 10,
            created_at: new Date().toISOString(),
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0].error).toContain("Stock insuficiente");

    const [invAfter] = await db.select().from(inventario).where(and(
      eq(inventario.productoId, gaseosaProductoId!),
      eq(inventario.sucursalId, gaseosaSucursalId!),
    ));
    expect(invAfter.cantidad).toBe(stockAntes);
  });

  it("Idempotencia: misma clave 2 veces retorna resultado previo y no duplica", async () => {
    const key = crypto.randomUUID();
    const ventaId = crypto.randomUUID();
    const payload = {
      sucursal_id: gaseosaSucursalId,
      ventas: [
        {
          id: ventaId,
          items: [{ presentacionId: gaseosaPresentacionUnidadId, cantidad: 1 }],
          total: 10,
          created_at: new Date().toISOString(),
        }
      ]
    };

    // Primera vez
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: { authorization: `Bearer ${cajeroToken}`, "idempotency-key": key },
      payload,
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().synced_ids).toContain(ventaId);

    // Segunda vez
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: { authorization: `Bearer ${cajeroToken}`, "idempotency-key": key },
      payload,
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().synced_ids).toContain(ventaId);
    expect(res2.json().message).toContain("Sync ya procesado previamente");
  });

  it("Idempotencia: misma clave con payload distinto es ignorado", async () => {
    const key = crypto.randomUUID();
    const ventaId1 = crypto.randomUUID();
    
    // Primera vez
    await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: { authorization: `Bearer ${cajeroToken}`, "idempotency-key": key },
      payload: {
        sucursal_id: gaseosaSucursalId,
        ventas: [{ id: ventaId1, items: [{ presentacionId: gaseosaPresentacionUnidadId, cantidad: 1 }], total: 10, created_at: new Date().toISOString() }]
      }
    });

    // Segunda vez, ventaId distinto
    const ventaId2 = crypto.randomUUID();
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: { authorization: `Bearer ${cajeroToken}`, "idempotency-key": key },
      payload: {
        sucursal_id: gaseosaSucursalId,
        ventas: [{ id: ventaId2, items: [{ presentacionId: gaseosaPresentacionUnidadId, cantidad: 1 }], total: 10, created_at: new Date().toISOString() }]
      }
    });

    expect(res2.statusCode).toBe(200);
    expect(res2.json().synced_ids).toContain(ventaId1); // Devuelve el 1, no procesa el 2
    expect(res2.json().synced_ids).not.toContain(ventaId2);
  });

  it("Idempotencia: concurrencia estricta devuelve 409 al perdedor", async () => {
    const key = crypto.randomUUID();
    const ventaId = crypto.randomUUID();
    const payload = {
      sucursal_id: gaseosaSucursalId,
      ventas: [{ id: ventaId, items: [{ presentacionId: gaseosaPresentacionUnidadId, cantidad: 1 }], total: 10, created_at: new Date().toISOString() }]
    };

    const req1 = app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: { authorization: `Bearer ${cajeroToken}`, "idempotency-key": key },
      payload,
    });
    
    const req2 = app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: { authorization: `Bearer ${cajeroToken}`, "idempotency-key": key },
      payload,
    });

    const [res1, res2] = await Promise.all([req1, req2]);
    const codes = [res1.statusCode, res2.statusCode];
    
    // Uno debe ser 200 y el otro 409
    expect(codes).toContain(200);
    expect(codes).toContain(409);
  });
});
