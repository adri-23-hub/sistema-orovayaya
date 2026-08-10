import { FastifyInstance } from "fastify";
import { categorias } from "../../db/schema/index.js";
import { authenticate, requireRole } from "../../shared/middleware/auth.js";
import { GenericCrudService } from "../../services/crud.service.js";

export async function categoriasRoutes(app: FastifyInstance) {
  const service = new GenericCrudService(categorias, categorias.nombre, categorias.id);

  // GET /v1/categorias
  app.get("/v1/categorias", { preHandler: [authenticate] }, async (request) => {
    const { search } = request.query as { search?: string };
    return await service.getAll(search);
  });

  // POST /v1/categorias
  app.post("/v1/categorias", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { nombre, descripcion } = request.body as { nombre: string; descripcion?: string };
    if (!nombre) return reply.status(400).send({ error: "Nombre es requerido" });
    try {
      const row = await service.create({ nombre, descripcion });
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
      const row = await service.update(id, updates, ["nombre", "descripcion"]);
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
    const row = await service.delete(id);
    if (!row) return reply.status(404).send({ error: "Categoría no encontrada" });
    return { message: "Categoría eliminada", id: row.id };
  });
}
