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
});
