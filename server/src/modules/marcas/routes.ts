import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { marcas } from "../../db/schema/index.js";
import { eq, like, asc } from "drizzle-orm";
import { authenticate, requireRole } from "../../shared/middleware/auth.js";

export async function marcasRoutes(app: FastifyInstance) {

  // GET /v1/marcas
  app.get("/v1/marcas", { preHandler: [authenticate] }, async (request) => {
    const { search } = request.query as { search?: string };
    let query = db.select().from(marcas).$dynamic();
    if (search) {
      query = query.where(like(marcas.nombre, `%${search}%`));
    }
    return await query.orderBy(asc(marcas.nombre));
  });

  // GET /v1/marcas/:id
  app.get("/v1/marcas/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db.select().from(marcas).where(eq(marcas.id, id)).limit(1);
    if (!row) return reply.status(404).send({ error: "Marca no encontrada" });
    return row;
  });

  // POST /v1/marcas
  app.post("/v1/marcas", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { nombre, descripcion } = request.body as { nombre: string; descripcion?: string };
    if (!nombre) return reply.status(400).send({ error: "Nombre es requerido" });
    try {
      const [row] = await db.insert(marcas).values({ nombre, descripcion }).returning();
      return reply.status(201).send(row);
    } catch (err: any) {
      if (err.code === "23505") return reply.status(409).send({ error: "Marca ya existe" });
      throw err;
    }
  });

  // PUT /v1/marcas/:id
  app.put("/v1/marcas/:id", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Partial<{ nombre: string; descripcion: string }>;
    try {
      const [row] = await db.update(marcas).set(updates).where(eq(marcas.id, id)).returning();
      if (!row) return reply.status(404).send({ error: "Marca no encontrada" });
      return row;
    } catch (err: any) {
      if (err.code === "23505") return reply.status(409).send({ error: "Ya existe una marca con ese nombre" });
      throw err;
    }
  });

  // DELETE /v1/marcas/:id
  app.delete("/v1/marcas/:id", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db.delete(marcas).where(eq(marcas.id, id)).returning();
    if (!row) return reply.status(404).send({ error: "Marca no encontrada" });
    return { message: "Marca eliminada", id: row.id };
  });
}
