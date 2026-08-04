import { FastifyInstance } from "fastify";
import { proveedores } from "../../db/schema/index.js";
import { authenticate, requireRole } from "../../shared/middleware/auth.js";
import { GenericCrudService } from "../../services/crud.service.js";

export async function proveedoresRoutes(app: FastifyInstance) {
  const service = new GenericCrudService(proveedores, proveedores.nombre, proveedores.id);

  // GET /v1/proveedores
  app.get("/v1/proveedores", { preHandler: [authenticate] }, async (request) => {
    const { search } = request.query as { search?: string };
    return await service.getAll(search);
  });

  // GET /v1/proveedores/:id
  app.get("/v1/proveedores/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.getById(id);
    if (!row) return reply.status(404).send({ error: "Proveedor no encontrado" });
    return row;
  });

  // POST /v1/proveedores
  app.post("/v1/proveedores", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { nombre, contacto, telefono, email, direccion } = request.body as {
      nombre: string; contacto?: string; telefono?: string; email?: string; direccion?: string;
    };
    if (!nombre) return reply.status(400).send({ error: "Nombre es requerido" });
    const row = await service.create({ nombre, contacto, telefono, email, direccion });
    return reply.status(201).send(row);
  });

  // PUT /v1/proveedores/:id
  app.put("/v1/proveedores/:id", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Partial<{ nombre: string; contacto: string; telefono: string; email: string; direccion: string }>;
    const row = await service.update(id, updates);
    if (!row) return reply.status(404).send({ error: "Proveedor no encontrado" });
    return row;
  });

  // DELETE /v1/proveedores/:id
  app.delete("/v1/proveedores/:id", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await service.delete(id);
    if (!row) return reply.status(404).send({ error: "Proveedor no encontrado" });
    return { message: "Proveedor eliminado", id: row.id };
  });
}
