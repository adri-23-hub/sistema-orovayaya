import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { ventas, inventario, productos, sucursales, transferencias } from "../../db/schema/index.js";
import { eq, and, sql, gte, lte, count, sum } from "drizzle-orm";
import { authenticate } from "../../shared/middleware/auth.js";

export async function dashboardRoutes(app: FastifyInstance) {

  // GET /v1/dashboard/summary — main dashboard data
  app.get("/v1/dashboard/summary", { preHandler: [authenticate] }, async (request) => {
    const { fecha_inicio, fecha_fin } = request.query as {
      fecha_inicio?: string; fecha_fin?: string;
    };

    // Default to today
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);

    const start = fecha_inicio ? new Date(fecha_inicio) : startOfDay;
    const end = fecha_fin ? new Date(fecha_fin) : endOfDay;

    // 1. Total sales for the period
    const [salesTotal] = await db
      .select({
        totalVentas: sum(ventas.total),
        cantidadVentas: count(),
      })
      .from(ventas)
      .where(and(
        gte(ventas.createdAt, start),
        lte(ventas.createdAt, end),
      ));

    // 2. Low stock alerts (quantity < 5)
    const lowStockAlerts = await db
      .select({
        productoId: inventario.productoId,
        productoNombre: productos.nombre,
        productoSku: productos.sku,
        sucursalNombre: sucursales.nombre,
        sucursalTipo: sucursales.tipo,
        cantidad: inventario.cantidad,
      })
      .from(inventario)
      .innerJoin(productos, eq(inventario.productoId, productos.id))
      .innerJoin(sucursales, eq(inventario.sucursalId, sucursales.id))
      .where(sql`${inventario.cantidad} < 5`);

    // 4. Stock by branch
    const stockCiudad = await db
      .select({
        productoId: inventario.productoId,
        productoNombre: productos.nombre,
        productoSku: productos.sku,
        categoria: productos.categoria,
        cantidad: inventario.cantidad,
      })
      .from(inventario)
      .innerJoin(productos, eq(inventario.productoId, productos.id))
      .innerJoin(sucursales, eq(inventario.sucursalId, sucursales.id))
      .where(eq(sucursales.tipo, "ciudad"));

    const stockPueblo = await db
      .select({
        productoId: inventario.productoId,
        productoNombre: productos.nombre,
        productoSku: productos.sku,
        categoria: productos.categoria,
        cantidad: inventario.cantidad,
      })
      .from(inventario)
      .innerJoin(productos, eq(inventario.productoId, productos.id))
      .innerJoin(sucursales, eq(inventario.sucursalId, sucursales.id))
      .where(eq(sucursales.tipo, "pueblo"));

    // 5. Recent transfers
    const transferenciasRecientes = await db
      .select({
        id: transferencias.id,
        productoNombre: productos.nombre,
        cantidad: transferencias.cantidad,
        createdAt: transferencias.createdAt,
      })
      .from(transferencias)
      .innerJoin(productos, eq(transferencias.productoId, productos.id))
      .orderBy(sql`${transferencias.createdAt} DESC`)
      .limit(10);

    return {
      ventas_totales: salesTotal.totalVentas ?? "0",
      cantidad_ventas: Number(salesTotal.cantidadVentas),
      alertas_stock_bajo: lowStockAlerts.length,
      stock_ciudad: stockCiudad,
      stock_pueblo: stockPueblo,
      transferencias_recientes: transferenciasRecientes,
      low_stock_items: lowStockAlerts,
    };
  });
}
