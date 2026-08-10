import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { movimientosInventario, productos, sucursales, usuarios, proveedores } from "../../db/schema/index.js";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { authenticate } from "../../shared/middleware/auth.js";

export async function movimientosRoutes(app: FastifyInstance) {

  // GET /v1/movimientos — list inventory movements with filters
  app.get("/v1/movimientos", { preHandler: [authenticate] }, async (request) => {
    const {
      sucursal_id,
      producto_id,
      tipo,
      limit = "50",
      page = "1",
      fecha_inicio,
      fecha_fin,
    } = request.query as {
      sucursal_id?: string;
      producto_id?: string;
      tipo?: string;
      limit?: string;
      page?: string;
      fecha_inicio?: string;
      fecha_fin?: string;
    };

    const pageNum = Math.max(1, parseInt(page) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * lim;

    let baseQuery = db
      .select({
        id: movimientosInventario.id,
        tipo: movimientosInventario.tipo,
        cantidad: movimientosInventario.cantidad,
        cantidadAnterior: movimientosInventario.cantidadAnterior,
        cantidadPosterior: movimientosInventario.cantidadPosterior,
        referencia: movimientosInventario.referencia,
        nota: movimientosInventario.nota,
        createdAt: movimientosInventario.createdAt,
        productoNombre: productos.nombre,
        productoSku: productos.sku,
        sucursalNombre: sucursales.nombre,
        sucursalTipo: sucursales.tipo,
        usuarioNombre: usuarios.nombre,
        proveedorNombre: proveedores.nombre,
      })
      .from(movimientosInventario)
      .innerJoin(productos, eq(movimientosInventario.productoId, productos.id))
      .innerJoin(sucursales, eq(movimientosInventario.sucursalId, sucursales.id))
      .leftJoin(usuarios, eq(movimientosInventario.usuarioId, usuarios.id))
      .leftJoin(proveedores, eq(movimientosInventario.proveedorId, proveedores.id))
      .$dynamic();

    // Filters
    const conditions = [];
    if (sucursal_id) conditions.push(eq(movimientosInventario.sucursalId, sucursal_id));
    if (producto_id) conditions.push(eq(movimientosInventario.productoId, producto_id));
    if (tipo) conditions.push(eq(movimientosInventario.tipo, tipo as any)); // Tarea 2.5.1: filtro tipo funcionando
    if (fecha_inicio) conditions.push(gte(movimientosInventario.createdAt, new Date(fecha_inicio)));
    if (fecha_fin) conditions.push(lte(movimientosInventario.createdAt, new Date(fecha_fin)));

    if (conditions.length > 0) {
      baseQuery = baseQuery.where(and(...conditions));
    }

    const rows = await baseQuery
      .orderBy(desc(movimientosInventario.createdAt))
      .limit(lim)
      .offset(offset);

    return rows;
  });
}
