import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { categorias } from "../../db/schema/index.js";
import { eq, like, asc } from "drizzle-orm";
import { authenticate, requireRole } from "../../shared/middleware/auth.js";

export async function categoriasRoutes(app: FastifyInstance) {

  // GET /v1/categorias
  app.get("/v1/categorias", { preHandler: [authenticate] }, async (request) => {
    const { search } = request.query as { search?: string };
    let query = db.select().from(categorias).$dynamic();
    if (search) {
      query = query.where(like(categorias.nombre, `%${search}%`));
    }
    return await query.orderBy(asc(categorias.nombre));
  });

  // POST /v1/categorias
  app.post("/v1/categorias", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { nombre, descripcion } = request.body as { nombre: string; descripcion?: string };
    if (!nombre) return reply.status(400).send({ error: "Nombre es requerido" });
    try {
      const [row] = await db.insert(categorias).values({ nombre, descripcion }).returning();
      return reply.status(201).send(row);
    } catch (err: any) {
      if (err.code === "23505") return reply.status(409).send({ error: "Categoría ya existe" });
      throw err;
    }
  });

  // PUT /v1/categorias/:id
  app.put("/v1/categorias/:id", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Partial<{ nombre: string; descripcion: string }>;
    try {
      const [row] = await db.update(categorias).set(updates).where(eq(categorias.id, id)).returning();
      if (!row) return reply.status(404).send({ error: "Categoría no encontrada" });
      return row;
    } catch (err: any) {
      if (err.code === "23505") return reply.status(409).send({ error: "Ya existe una categoría con ese nombre" });
      throw err;
    }
  });

  // DELETE /v1/categorias/:id
  app.delete("/v1/categorias/:id", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db.delete(categorias).where(eq(categorias.id, id)).returning();
    if (!row) return reply.status(404).send({ error: "Categoría no encontrada" });
    return { message: "Categoría eliminada", id: row.id };
  });
}
