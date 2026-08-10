import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { ventas, sucursales } from "../../db/schema/index.js";
import { eq, desc } from "drizzle-orm";
import { authenticate } from "../../shared/middleware/auth.js";
import { z } from "zod";
import { validateBody } from "../../shared/middleware/validation.js";
import { procesarVenta } from "../../services/presentaciones.service.js";

const saleItemSchema = z.object({
  presentacionId: z.string().uuid("ID de presentación inválido"),
  cantidad: z.number().int().positive("Cantidad debe ser mayor a 0"),
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

  // POST /v1/sales — create a sale via presentaciones (atomic stock decrement)
  app.post("/v1/sales", { preHandler: [authenticate, validateBody(createSaleSchema as any)] }, async (request, reply) => {
    const { sucursal_id, items } = request.body as z.infer<typeof createSaleSchema>;

    try {
      // ALL logic inside a single transaction — no pre-check outside (no TOCTOU)
      const sale = await db.transaction(async (tx) => {
        return await procesarVenta(tx, {
          sucursalId: sucursal_id,
          items: items.map(i => ({
            presentacionId: i.presentacionId,
            cantidad: i.cantidad,
          })),
          usuarioId: (request as any).user?.id ?? null,
        });
      });

      return reply.status(201).send(sale);
    } catch (error: any) {
      if (error.statusCode === 400) {
        return reply.status(400).send({ error: error.message });
      }
      throw error;
    }
  });
}
