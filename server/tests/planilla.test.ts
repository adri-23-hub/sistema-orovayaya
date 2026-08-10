import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp, loginToken } from "./helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let adminToken: string;

const suf = Date.now().toString(36);

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

beforeAll(async () => {
  app = await buildApp();
  adminToken = await loginToken(app, "admin@orvayaya.com", "admin123");
});

afterAll(async () => {
  await app.close();
});

describe("Planilla: ingreso y envío en lote", () => {
  let ciudadId: string;
  let puebloId: string;
  let prodAId: string;
  let prodBId: string;
  let packAId: string;
  let packBId: string;

  it("prepara sucursales, productos y presentaciones", async () => {
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

    // Productos
    const mkProduct = async (sku: string, nombre: string) => {
      const r = await app.inject({
        method: "POST",
        url: "/v1/products",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { sku, nombre, precio: 10, categoria: "Tests" },
      });
      expect(r.statusCode).toBe(201);
      return r.json().id;
    };
    prodAId = await mkProduct(`PLAN-A-${suf}`, "Aceite Planilla A");
    prodBId = await mkProduct(`PLAN-B-${suf}`, "Aceite Planilla B");

    const mkPres = async (productoId: string, nombre: string, factor: number) => {
      const r = await app.inject({
        method: "POST",
        url: "/v1/presentaciones",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { producto_id: productoId, nombre_presentacion: nombre, factor_conversion: factor, precio_venta: 55 },
      });
      expect(r.statusCode).toBe(201);
      return r.json().id;
    };
    packAId = await mkPres(prodAId, "Caja de 5", 5);
    packBId = await mkPres(prodBId, "Caja de 3", 3);
  });

  it("POST /v1/inventory/adjust-batch suma unidades (con y sin factor)", async () => {
    const antesA = stockOf(await getInventory(ciudadId), prodAId);
    const antesB = stockOf(await getInventory(ciudadId), prodBId);

    const res = await app.inject({
      method: "POST",
      url: "/v1/inventory/adjust-batch",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        sucursal_id: ciudadId,
        nota: "Factura planilla",
        items: [
          { producto_id: prodAId, presentacion_id: packAId, cantidad: 3 }, // 3 * 5 = 15
          { producto_id: prodBId, cantidad: 4 },                            // factor 1 = 4
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const result = res.json();
    expect(result.referencia).toContain("planilla-");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ producto_id: prodAId, unidades: 15, factor_conversion: 5, stock_anterior: antesA });
    expect(result.items[1]).toMatchObject({ producto_id: prodBId, unidades: 4, factor_conversion: 1, stock_anterior: antesB });

    const despues = await getInventory(ciudadId);
    expect(stockOf(despues, prodAId)).toBe(antesA + 15);
    expect(stockOf(despues, prodBId)).toBe(antesB + 4);
  });

  it("POST /v1/transfers-batch mueve unidades ciudad → pueblo (con×sin factor)", async () => {
    // Aseguramos stock en ciudad
    await app.inject({
      method: "POST",
      url: "/v1/inventory/adjust-batch",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { sucursal_id: ciudadId, items: [{ producto_id: prodAId, cantidad: 30 }, { producto_id: prodBId, cantidad: 30 }] },
    });

    const cAntesA = stockOf(await getInventory(ciudadId), prodAId);
    const pAntesA = stockOf(await getInventory(puebloId), prodAId);
    const cAntesB = stockOf(await getInventory(ciudadId), prodBId);
    const pAntesB = stockOf(await getInventory(puebloId), prodBId);

    const respuesta = await app.inject({
      method: "POST",
      url: "/v1/transfers-batch",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        items: [
          { producto_id: prodAId, presentacion_id: packAId, cantidad: 2 },    // 2 * 5 = 10
          { producto_id: prodBId, cantidad: 3 },                               // 3 * 1 = 3
        ],
      },
    });

    expect(respuesta.statusCode).toBe(201);
    const result = respuesta.json();
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ producto_id: prodAId, unidades: 10, factor_conversion: 5 });
    expect(result.items[1]).toMatchObject({ producto_id: prodBId, unidades: 3, factor_conversion: 1 });

    const cCiudad = await getInventory(ciudadId);
    const cPueblo = await getInventory(puebloId);
    expect(stockOf(cCiudad, prodAId)).toBe(cAntesA - 10);
    expect(stockOf(cPueblo, prodAId)).toBe(pAntesA + 10);
    expect(stockOf(cCiudad, prodBId)).toBe(cAntesB - 3);
    expect(stockOf(cPueblo, prodBId)).toBe(pAntesB + 3);
  });

  it("adjust-batch es atómico: un ítem inválido revierte toda la planilla", async () => {
    const antes = stockOf(await getInventory(ciudadId), prodAId);

    const res = await app.inject({
      method: "POST",
      url: "/v1/inventory/adjust-batch",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        sucursal_id: ciudadId,
        items: [
          { producto_id: prodAId, cantidad: 5 },                    // válido, se aplicaría
          { producto_id: prodBId, presentacion_id: packAId, cantidad: 1 }, // presentación de otro producto → error
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(stockOf(await getInventory(ciudadId), prodAId)).toBe(antes); // rollback
  });

  it("transfers-batch es atómico: stock insuficiente revierte todo", async () => {
    const antesA = stockOf(await getInventory(ciudadId), prodAId);
    const antesP = stockOf(await getInventory(puebloId), prodAId);

    const res = await app.inject({
      method: "POST",
      url: "/v1/transfers-batch",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        items: [
          { producto_id: prodAId, cantidad: 1 }, // válido
          { producto_id: prodBId, cantidad: 999999999 }, // insuficiente → error
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(stockOf(await getInventory(ciudadId), prodAId)).toBe(antesA);
    expect(stockOf(await getInventory(puebloId), prodAId)).toBe(antesP);
  });
});