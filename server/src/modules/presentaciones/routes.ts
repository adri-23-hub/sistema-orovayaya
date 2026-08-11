import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { presentacionesVenta, productos, ventas, crearPresentacionSchema, actualizarPresentacionSchema } from "../../db/schema/index.js";
import { eq, sql } from "drizzle-orm";
import { authenticate, requireRole } from "../../shared/middleware/auth.js";
import { validateBody } from "../../shared/middleware/validation.js";

export async function presentacionesRoutes(app: FastifyInstance) {

  // GET /v1/presentaciones?producto_id= — list presentations for a product
  app.get("/v1/presentaciones", { preHandler: [authenticate] }, async (request, reply) => {
    const { producto_id } = request.query as { producto_id?: string };

    let query = db
      .select({
        id: presentacionesVenta.id,
        productoId: presentacionesVenta.productoId,
        nombrePresentacion: presentacionesVenta.nombrePresentacion,
        factorConversion: presentacionesVenta.factorConversion,
        precioVenta: presentacionesVenta.precioVenta,
        createdAt: presentacionesVenta.createdAt,
        updatedAt: presentacionesVenta.updatedAt,
      })
      .from(presentacionesVenta)
      .$dynamic();

    if (producto_id) {
      query = query.where(eq(presentacionesVenta.productoId, producto_id));
    }

    return await query.orderBy(presentacionesVenta.factorConversion);
  });

  // POST /v1/presentaciones — create a presentation (admin)
  app.post("/v1/presentaciones", { preHandler: [requireRole("admin"), validateBody(crearPresentacionSchema)] }, async (request, reply) => {
    const { producto_id, nombre_presentacion, factor_conversion, precio_venta } = request.body as {
      producto_id: string;
      nombre_presentacion: string;
      factor_conversion: number;
      precio_venta: number;
    };

    // Verify product exists
    const [producto] = await db.select().from(productos).where(eq(productos.id, producto_id));
    if (!producto) {
      return reply.status(404).send({ error: "Producto no encontrado" });
    }

    try {
      const [presentacion] = await db.insert(presentacionesVenta).values({
        productoId: producto_id,
        nombrePresentacion: nombre_presentacion,
        factorConversion: factor_conversion,
        precioVenta: precio_venta.toFixed(2),
      }).returning();

      return reply.status(201).send(presentacion);
    } catch (error: any) {
      // Handle unique constraint violation
      if (error.code === "23505") {
        return reply.status(409).send({ error: `Ya existe una presentación "${nombre_presentacion}" para este producto` });
      }
      throw error;
    }
  });

  // PUT /v1/presentaciones/:id — edit a presentation (admin, affects future operations only)
  app.put("/v1/presentaciones/:id", { preHandler: [requireRole("admin"), validateBody(actualizarPresentacionSchema)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as {
      nombre_presentacion?: string;
      factor_conversion?: number;
      precio_venta?: number;
    };

    const setData: any = { updatedAt: new Date() };
    if (updates.nombre_presentacion !== undefined) setData.nombrePresentacion = updates.nombre_presentacion;
    if (updates.factor_conversion !== undefined) setData.factorConversion = updates.factor_conversion;
    if (updates.precio_venta !== undefined) setData.precioVenta = updates.precio_venta.toFixed(2);

    try {
      const [updated] = await db
        .update(presentacionesVenta)
        .set(setData)
        .where(eq(presentacionesVenta.id, id))
        .returning();

      if (!updated) {
        return reply.status(404).send({ error: "Presentación no encontrada" });
      }

      return updated;
    } catch (error: any) {
      if (error.code === "23505") {
        return reply.status(409).send({ error: "Ya existe una presentación con ese nombre para este producto" });
      }
      throw error;
    }
  });

  // DELETE /v1/presentaciones/:id — delete only if no sale references it (admin)
  app.delete("/v1/presentaciones/:id", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    // Check if any sale references this presentation
    const [presentacion] = await db
      .select()
      .from(presentacionesVenta)
      .where(eq(presentacionesVenta.id, id));

    if (!presentacion) {
      return reply.status(404).send({ error: "Presentación no encontrada" });
    }

    // Check sales — items is a JSONB array, search for presentacionId inside it
    const salesWithPresentation = await db
      .select({ id: ventas.id })
      .from(ventas)
      .where(sql`${ventas.items}::jsonb @> ${JSON.stringify([{ presentacionId: id }])}::jsonb`)
      .limit(1);

    if (salesWithPresentation.length > 0) {
      return reply.status(409).send({
        error: "No se puede eliminar: existen ventas que referencian esta presentación",
      });
    }

    await db.delete(presentacionesVenta).where(eq(presentacionesVenta.id, id));

    return { message: "Presentación eliminada", id };
  });
}
