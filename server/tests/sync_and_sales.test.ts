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

describe("Sales & Sync Module", () => {
  it("POST /v1/sync sin autenticación devuelve 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: { "idempotency-key": "00000000-0000-0000-0000-000000000000" },
      payload: { sucursal_id: "some-id", ventas: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/sales con stock excesivo devuelve 400 y frena la venta", async () => {
    // get a branch and product first
    const invRes = await app.inject({
      method: "GET",
      url: "/v1/inventory",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const inv = invRes.json();
    if (inv.length > 0) {
      const item = inv[0];
      const res = await app.inject({
        method: "POST",
        url: "/v1/sales",
        headers: { authorization: `Bearer ${cajeroToken}` },
        payload: {
          sucursal_id: item.sucursalId,
          items: [
            {
              productoId: item.productoId,
              productoNombre: item.productoNombre,
              cantidad: 999999,
              precioUnitario: 10,
              subtotal: 9999990,
            },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Stock insuficiente");
    }
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
});
