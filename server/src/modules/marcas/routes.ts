import { FastifyInstance } from "fastify";
import { marcas } from "../../db/schema/index.js";
import { authenticate, requireRole } from "../../shared/middleware/auth.js";
import { GenericCrudService } from "../../services/crud.service.js";

export async function marcasRoutes(app: FastifyInstance) {
  const service = new GenericCrudService(marcas, marcas.nombre, marcas.id);

  // GET /v1/marcas
  app.get("/v1/marcas", { preHandler: [authenticate] }, async (request) => {
    const { search } = request.query as { search?: string };
    return await service.getAll(search);
  });

  // GET /v1/marcas/:id
  app.get("/v1/marcas/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getById(id);
    if (!row) return reply.status(404).send({ error: "Marca no encontrada" });
    return row;
  });

  // POST /v1/marcas
  app.post("/v1/marcas", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { nombre, descripcion } = request.body as { nombre: string; descripcion?: string };
    if (!nombre) return reply.status(400).send({ error: "Nombre es requerido" });
    try {
      const row = await service.create({ nombre, descripcion });
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
      const row = await service.update(id, updates, ["nombre", "descripcion"]);
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
    const row = await service.delete(id);
    if (!row) return reply.status(404).send({ error: "Marca no encontrada" });
    return { message: "Marca eliminada", id: row.id };
  });
}
