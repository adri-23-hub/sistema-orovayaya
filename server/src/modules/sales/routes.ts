import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { ventas, inventario, sucursales, movimientosInventario } from "../../db/schema/index.js";
import { eq, and, sql, desc, gte } from "drizzle-orm";
import { authenticate } from "../../shared/middleware/auth.js";
import { z } from "zod";
import { validateBody } from "../../shared/middleware/validation.js";

const saleItemSchema = z.object({
  productoId: z.string().uuid("ID de producto inválido"),
  productoNombre: z.string().min(1, "Nombre de producto requerido"),
  cantidad: z.number().int().positive("Cantidad debe ser mayor a 0"),
  precioUnitario: z.number().positive("Precio unitario debe ser positivo"),
  subtotal: z.number().positive("Subtotal debe ser positivo"),
});

const createSaleSchema = z.object({
  sucursal_id: z.string().uuid("ID de sucursal inválido"),
  items: z.array(saleItemSchema).min(1, "La venta debe tener al menos un producto"),
});

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
  app.post("/v1/sales", { preHandler: [authenticate, validateBody(createSaleSchema)] }, async (request, reply) => {
    const { sucursal_id, items } = request.body as z.infer<typeof createSaleSchema>;

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
      const operations = items.map(async (item) => {
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
      });

      await Promise.all(operations);

      return sale;
    });

    return reply.status(201).send(result);
  });
}
