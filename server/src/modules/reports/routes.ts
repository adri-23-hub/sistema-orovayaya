import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { ventas, productos, sucursales } from "../../db/schema/index.js";
import { eq, and, sql, gte, lte, count } from "drizzle-orm";
import { authenticate, requireRole } from "../../shared/middleware/auth.js";

export async function reportsRoutes(app: FastifyInstance) {

  // GET /v1/reports/ventas?fecha_inicio&fecha_fin&sucursal_id&page&limit
  app.get("/v1/reports/ventas", { preHandler: [authenticate] }, async (request) => {
    const { fecha_inicio, fecha_fin, sucursal_id, page = "1", limit = "500" } = request.query as {
      fecha_inicio?: string; fecha_fin?: string; sucursal_id?: string;
      page?: string; limit?: string;
    };

    const pageNum = Math.max(1, parseInt(page) || 1);
    const lim = Math.min(2000, Math.max(1, parseInt(limit) || 500));
    const offset = (pageNum - 1) * lim;

    // Build shared conditions
    const conditions = [];
    if (sucursal_id) conditions.push(eq(ventas.sucursalId, sucursal_id));
    if (fecha_inicio) conditions.push(gte(ventas.createdAt, new Date(fecha_inicio)));
    if (fecha_fin) conditions.push(lte(ventas.createdAt, new Date(fecha_fin)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Count total in range (parallel with data query)
    const [countResult, rows] = await Promise.all([
      db.select({ total: count() }).from(ventas)
        .$dynamic()
        .where(whereClause),
      db.select({
        id: ventas.id,
        sucursalId: ventas.sucursalId,
        sucursalNombre: sucursales.nombre,
        total: ventas.total,
        items: ventas.items,
        createdAt: ventas.createdAt,
      })
        .from(ventas)
        .innerJoin(sucursales, eq(ventas.sucursalId, sucursales.id))
        .$dynamic()
        .where(whereClause)
        .orderBy(sql`${ventas.createdAt} DESC`)
        .limit(lim)
        .offset(offset),
    ]);

    const totalVentasRango = Number(countResult[0]?.total ?? 0);
    const totalIngresos = rows.reduce((sum, v) => sum + parseFloat(String(v.total)), 0);
    const totalItems = rows.reduce((sum, v) => sum + (Array.isArray(v.items) ? v.items.length : 0), 0);

    return {
      total_ventas: totalVentasRango,
      total_ingresos: totalIngresos.toFixed(2),
      total_items: totalItems,
      pagina: pageNum,
      por_pagina: lim,
      ventas: rows,
    };
  });

  // GET /v1/reports/ganancias?fecha_inicio&fecha_fin&sucursal_id&page&limit
  app.get("/v1/reports/ganancias", { preHandler: [requireRole("admin")] }, async (request) => {
    const { fecha_inicio, fecha_fin, sucursal_id, page = "1", limit = "500" } = request.query as {
      fecha_inicio?: string; fecha_fin?: string; sucursal_id?: string;
      page?: string; limit?: string;
    };

    const pageNum = Math.max(1, parseInt(page) || 1);
    const lim = Math.min(2000, Math.max(1, parseInt(limit) || 500));
    const offset = (pageNum - 1) * lim;

    // Build shared conditions
    const conditions = [];
    if (sucursal_id) conditions.push(eq(ventas.sucursalId, sucursal_id));
    if (fecha_inicio) conditions.push(gte(ventas.createdAt, new Date(fecha_inicio)));
    if (fecha_fin) conditions.push(lte(ventas.createdAt, new Date(fecha_fin)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Count total in range + paginated data
    const [countResult, rows] = await Promise.all([
      db.select({ total: count() }).from(ventas)
        .$dynamic()
        .where(whereClause),
      db.select({
        id: ventas.id,
        sucursalId: ventas.sucursalId,
        total: ventas.total,
        items: ventas.items,
        createdAt: ventas.createdAt,
      })
        .from(ventas)
        .$dynamic()
        .where(whereClause)
        .orderBy(sql`${ventas.createdAt} DESC`)
        .limit(lim)
        .offset(offset),
    ]);

    const totalVentasRango = Number(countResult[0]?.total ?? 0);

    // Precargar todos los productos (evitar N+1)
    const prods = await db.select().from(productos);
    const prodMap = new Map(prods.map(p => [p.id, p]));

    const detallePorProducto = new Map<string, {
      productoId: string; productoNombre: string; cantidad: number;
      ventas: number; costo: number; ganancia: number;
    }>();

    for (const v of rows) {
      const items = (v.items ?? []) as Array<{
        productoId: string; productoNombre: string; cantidad: number;
        precioUnitario: number; subtotal: number;
      }>;
      for (const item of items) {
        const prod = prodMap.get(item.productoId);
        const costoUnitario = prod ? parseFloat(String(prod.costo ?? 0)) : 0;
        const costoItem = costoUnitario * item.cantidad;

        const d = detallePorProducto.get(item.productoId) ?? {
          productoId: item.productoId,
          productoNombre: item.productoNombre,
          cantidad: 0, ventas: 0, costo: 0, ganancia: 0,
        };
        d.cantidad += item.cantidad;
        d.ventas += item.subtotal;
        d.costo += costoItem;
        d.ganancia += item.subtotal - costoItem;
        detallePorProducto.set(item.productoId, d);
      }
    }

    const detalle = Array.from(detallePorProducto.values());
    const totalVentas = detalle.reduce((s, d) => s + d.ventas, 0);
    const totalCosto = detalle.reduce((s, d) => s + d.costo, 0);
    const totalGanancia = totalVentas - totalCosto;
    const margen = totalVentas > 0 ? (totalGanancia / totalVentas) * 100 : 0;

    return {
      total_ventas: totalVentasRango,
      total_ingresos: totalVentas.toFixed(2),
      total_costo: totalCosto.toFixed(2),
      total_ganancia: totalGanancia.toFixed(2),
      margen_porcentaje: margen.toFixed(2),
      pagina: pageNum,
      por_pagina: lim,
      detalle_por_producto: detalle.map(d => ({
        ...d,
        ventas: d.ventas.toFixed(2),
        costo: d.costo.toFixed(2),
        ganancia: d.ganancia.toFixed(2),
      })),
    };
  });
}
