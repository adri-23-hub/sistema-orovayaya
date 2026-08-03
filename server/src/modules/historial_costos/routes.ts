import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { historialCostos, productos } from "../../db/schema/index.js";
import { eq, desc } from "drizzle-orm";
import { authenticate, requireRole } from "../../shared/middleware/auth.js";

export async function historialCostosRoutes(app: FastifyInstance) {

  // GET /v1/historial-costos — list all cost history with product info
  app.get("/v1/historial-costos", { preHandler: [authenticate] }, async (request) => {
    const { producto_id, limit = "50" } = request.query as {
      producto_id?: string; limit?: string;
    };

    let query = db
      .select({
        id: historialCostos.id,
        costoAnterior: historialCostos.costoAnterior,
        costoNuevo: historialCostos.costoNuevo,
        precioAnterior: historialCostos.precioAnterior,
        precioNuevo: historialCostos.precioNuevo,
        motivo: historialCostos.motivo,
        createdAt: historialCostos.createdAt,
        productoNombre: productos.nombre,
        productoSku: productos.sku,
      })
      .from(historialCostos)
      .innerJoin(productos, eq(historialCostos.productoId, productos.id))
      .$dynamic();

    if (producto_id) {
      query = query.where(eq(historialCostos.productoId, producto_id));
    }

    return await query.orderBy(desc(historialCostos.createdAt)).limit(parseInt(limit));
  });
}
