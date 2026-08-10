import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp, loginToken, truncateTestTables } from "./helpers.js";
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

describe("Presentaciones de Venta", () => {
  beforeAll(async () => {
    await truncateTestTables();
  });

  let gaseosaProductoId: string;
  let presentacionUnidadId: string;
  let presentacionPaqueteId: string;
  let sucursalCiudadId: string;

  it("puede listar presentaciones de un producto", async () => {
    // First get inventory to find a product with presentations
    const invRes = await app.inject({
      method: "GET",
      url: "/v1/inventory",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const inv = invRes.json();
    expect(inv.length).toBeGreaterThan(0);

    // Find the Gaseosa product
    const gaseosaInv = inv.find((i: any) => i.productoNombre?.includes("Gaseosa"));
    if (gaseosaInv) {
      gaseosaProductoId = gaseosaInv.productoId;
      sucursalCiudadId = gaseosaInv.sucursalId;
    } else {
      // Use first product
      gaseosaProductoId = inv[0].productoId;
      sucursalCiudadId = inv[0].sucursalId;
    }

    const res = await app.inject({
      method: "GET",
      url: `/v1/presentaciones?producto_id=${gaseosaProductoId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const presentaciones = res.json();
    console.log("Producto ID:", gaseosaProductoId, "Presentaciones:", presentaciones);
    expect(Array.isArray(presentaciones)).toBe(true);
    expect(presentaciones.length).toBeGreaterThan(0);

    // Find Unidad and Paquete de 6
    const unidad = presentaciones.find((p: any) => p.nombrePresentacion === "Unidad");
    const paquete = presentaciones.find((p: any) => p.nombrePresentacion === "Paquete de 6");

    if (unidad) presentacionUnidadId = unidad.id;
    if (paquete) presentacionPaqueteId = paquete.id;
  });

  it("GET /v1/presentaciones sin producto_id lista todas las presentaciones (necesario para caché offline del POS)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/presentaciones",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(res.json().length).toBeGreaterThan(0);
  });

  it("venta con stock suficiente (1 Unidad) se completa correctamente", async () => {
    expect(presentacionUnidadId).toBeDefined();
    expect(sucursalCiudadId).toBeDefined();

    const res = await app.inject({
      method: "POST",
      url: "/v1/sales",
      headers: { authorization: `Bearer ${cajeroToken}` },
      payload: {
        sucursal_id: sucursalCiudadId,
        items: [
          {
            presentacionId: presentacionUnidadId,
            cantidad: 1,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const sale = res.json();
    expect(sale.id).toBeDefined();
    expect(sale.items).toBeDefined();
    expect(sale.items.length).toBe(1);
    expect(sale.items[0].unidadesMinimas).toBe(1); // 1 * factor 1
    expect(sale.items[0].presentacionId).toBe(presentacionUnidadId);
  });

  it("venta con stock insuficiente → error 400 y rollback", async () => {
    expect(presentacionUnidadId).toBeDefined();
    expect(sucursalCiudadId).toBeDefined();

    const res = await app.inject({
      method: "POST",
      url: "/v1/sales",
      headers: { authorization: `Bearer ${cajeroToken}` },
      payload: {
        sucursal_id: sucursalCiudadId,
        items: [
          {
            presentacionId: presentacionUnidadId,
            cantidad: 999999,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Stock insuficiente");
  });

  it("precio del paquete es independiente del precio por unidad", async () => {
    expect(presentacionUnidadId).toBeDefined();
    expect(presentacionPaqueteId).toBeDefined();
    expect(sucursalCiudadId).toBeDefined();

    // Sell 1 Unidad
    const resUnidad = await app.inject({
      method: "POST",
      url: "/v1/sales",
      headers: { authorization: `Bearer ${cajeroToken}` },
      payload: {
        sucursal_id: sucursalCiudadId,
        items: [
          {
            presentacionId: presentacionUnidadId,
            cantidad: 1,
          },
        ],
      },
    });
    expect(resUnidad.statusCode).toBe(201);
    const saleUnidad = resUnidad.json();

    // Sell 1 Paquete de 6
    const resPaquete = await app.inject({
      method: "POST",
      url: "/v1/sales",
      headers: { authorization: `Bearer ${cajeroToken}` },
      payload: {
        sucursal_id: sucursalCiudadId,
        items: [
          {
            presentacionId: presentacionPaqueteId,
            cantidad: 1,
          },
        ],
      },
    });
    expect(resPaquete.statusCode).toBe(201);
    const salePaquete = resPaquete.json();

    // Unit price: 10.00 for 1 unit
    const precioUnidad = parseFloat(saleUnidad.items[0].precioUnitario);
    // Package price: 55.00 for 6 units (NOT 6 * 10 = 60)
    const precioPaquete = parseFloat(salePaquete.items[0].precioUnitario);

    // Prices are independent
    expect(precioUnidad).toBe(10);
    expect(precioPaquete).toBe(55);

    // Stock deduction: package deducts 6 minimum units
    expect(salePaquete.items[0].unidadesMinimas).toBe(6);
    expect(saleUnidad.items[0].unidadesMinimas).toBe(1);
  });

  it("CRUD de presentaciones (crear, editar, eliminar)", async () => {
    // Create a new presentation
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/presentaciones",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        producto_id: gaseosaProductoId,
        nombre_presentacion: "Display de 12",
        factor_conversion: 12,
        precio_venta: 110.00,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.nombrePresentacion).toBe("Display de 12");
    expect(created.factorConversion).toBe(12);

    // Update the presentation
    const updateRes = await app.inject({
      method: "PUT",
      url: `/v1/presentaciones/${created.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        precio_venta: 105.00,
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(parseFloat(updateRes.json().precioVenta)).toBe(105);

    // Delete the presentation (no sales reference it)
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/presentaciones/${created.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().message).toContain("eliminada");
  });

  it("no se puede eliminar una presentación referenciada por ventas", async () => {
    expect(presentacionUnidadId).toBeDefined();

    // This presentation was used in sales above, so delete should fail
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/presentaciones/${presentacionUnidadId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("ventas que referencian");
  });

  it("ajuste de inventario con presentacion_id multiplica por factor", async () => {
    expect(gaseosaProductoId).toBeDefined();
    expect(sucursalCiudadId).toBeDefined();
    expect(presentacionPaqueteId).toBeDefined();

    // Get current stock
    const invRes = await app.inject({
      method: "GET",
      url: `/v1/inventory?sucursal_id=${sucursalCiudadId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const inv = invRes.json();
    const gaseosaInv = inv.find((i: any) => i.productoId === gaseosaProductoId);
    const stockAntes = gaseosaInv?.cantidad ?? 0;

    // Adjust: add 2 "Paquete de 6" = 12 minimum units
    const adjustRes = await app.inject({
      method: "POST",
      url: "/v1/inventory/adjust",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        producto_id: gaseosaProductoId,
        sucursal_id: sucursalCiudadId,
        cantidad: 2,
        tipo: "entrada",
        presentacion_id: presentacionPaqueteId,
        nota: "Entrada de 2 paquetes de 6",
      },
    });

    expect(adjustRes.statusCode).toBe(201);
    const result = adjustRes.json();
    expect(result.delta).toBe(12); // 2 * 6
    expect(result.factor_conversion).toBe(6);
    expect(result.stock_nuevo).toBe(stockAntes + 12);
  });
});
