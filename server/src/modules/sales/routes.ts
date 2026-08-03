import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { ventas, inventario, sucursales, movimientosInventario } from "../../db/schema/index.js";
import { eq, and, sql, desc, gte } from "drizzle-orm";
import { authenticate } from "../../shared/middleware/auth.js";
import type { VentaItem } from "../../db/schema/ventas.js";

export async function salesRoutes(app: FastifyInstance) {

  // GET /v1/sales — list sales with optional filters
  app.get("/v1/sales", { preHandler: [authenticate] }, async (request) => {
    const { sucursal_id, limit = "50", page = "1" } = request.query as {
      sucursal_id?: string; limit?: string; page?: string;
    };

    // Tarea 2.5.3: validar page/limit
    const pageNum = Math.max(1, parseInt(page) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * lim;

    let query = db.select({
      id: ventas.id,
      sucursalId: ventas.sucursalId,
      sucursalNombre: sucursales.nombre,
      total: ventas.total,
      items: ventas.items,
      synced: ventas.synced,
      createdAt: ventas.createdAt,
    })
    .from(ventas)
    .innerJoin(sucursales, eq(ventas.sucursalId, sucursales.id))
    .$dynamic();

    if (sucursal_id) {
      query = query.where(eq(ventas.sucursalId, sucursal_id));
    }

    return await query.orderBy(desc(ventas.createdAt)).limit(lim).offset(offset);
  });

  // POST /v1/sales — create a sale (direct, from admin)
  app.post("/v1/sales", { preHandler: [authenticate] }, async (request, reply) => {
    const { sucursal_id, items } = request.body as {
      sucursal_id: string;
      items: VentaItem[];
    };

    if (!sucursal_id || !items || items.length === 0) {
      return reply.status(400).send({ error: "sucursal_id e items son requeridos" });
    }

    // Tarea 1.5: pre-validación de stock
    for (const item of items) {
      const [inv] = await db.select().from(inventario).where(and(
        eq(inventario.productoId, item.productoId),
        eq(inventario.sucursalId, sucursal_id),
      ));
      if (!inv || inv.cantidad < item.cantidad) {
        return reply.status(400).send({
          error: `Stock insuficiente para ${item.productoNombre}`,
          stockActual: inv?.cantidad ?? 0,
        });
      }
    }

    // Calculate total
    const total = items.reduce((sum, item) => sum + item.subtotal, 0).toFixed(2);

    // Insert sale and update stock in transaction
    const result = await db.transaction(async (tx) => {
      const [sale] = await tx.insert(ventas).values({
        sucursalId: sucursal_id,
        total,
        items,
        synced: true,
      }).returning();

      // Tarea 1.5 + 2.2.1: actualizar stock con bloqueo optimista + registrar movimiento
      for (const item of items) {
        const [inv] = await tx.select()
          .from(inventario)
          .where(and(
            eq(inventario.productoId, item.productoId),
            eq(inventario.sucursalId, sucursal_id),
          ));

        const cantidadAnterior = inv?.cantidad ?? 0;

        await tx.update(inventario)
          .set({
            cantidad: sql`${inventario.cantidad} - ${item.cantidad}`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(inventario.productoId, item.productoId),
            eq(inventario.sucursalId, sucursal_id),
            gte(inventario.cantidad, item.cantidad), // bloqueo optimista contra negativos
          ));

        // Tarea 2.2.1: registrar movimiento de salida tipo "venta"
        await tx.insert(movimientosInventario).values({
          productoId: item.productoId,
          sucursalId: sucursal_id,
          tipo: "venta",
          cantidad: -item.cantidad,
          cantidadAnterior,
          cantidadPosterior: cantidadAnterior - item.cantidad,
          referencia: sale.id,
          nota: "Venta directa",
          usuarioId: (request as any).user?.id ?? null,
        });
      }

      return sale;
    });

    return reply.status(201).send(result);
  });
}
