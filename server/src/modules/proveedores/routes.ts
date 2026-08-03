import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { proveedores } from "../../db/schema/index.js";
import { eq, like, asc } from "drizzle-orm";
import { authenticate, requireRole } from "../../shared/middleware/auth.js";

export async function proveedoresRoutes(app: FastifyInstance) {

  // GET /v1/proveedores
  app.get("/v1/proveedores", { preHandler: [authenticate] }, async (request) => {
    const { search } = request.query as { search?: string };
    let query = db.select().from(proveedores).$dynamic();
    if (search) {
      query = query.where(like(proveedores.nombre, `%${search}%`));
    }
    return await query.orderBy(asc(proveedores.nombre));
  });

  // GET /v1/proveedores/:id
  app.get("/v1/proveedores/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db.select().from(proveedores).where(eq(proveedores.id, id)).limit(1);
    if (!row) return reply.status(404).send({ error: "Proveedor no encontrado" });
    return row;
  });

  // POST /v1/proveedores
  app.post("/v1/proveedores", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { nombre, contacto, telefono, email, direccion } = request.body as {
      nombre: string; contacto?: string; telefono?: string; email?: string; direccion?: string;
    };
    if (!nombre) return reply.status(400).send({ error: "Nombre es requerido" });
    const [row] = await db.insert(proveedores).values({ nombre, contacto, telefono, email, direccion }).returning();
    return reply.status(201).send(row);
  });

  // PUT /v1/proveedores/:id
  app.put("/v1/proveedores/:id", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const updates = request.body as Partial<{ nombre: string; contacto: string; telefono: string; email: string; direccion: string }>;
    const [row] = await db.update(proveedores).set({ ...updates, updatedAt: new Date() }).where(eq(proveedores.id, id)).returning();
    if (!row) return reply.status(404).send({ error: "Proveedor no encontrado" });
    return row;
  });

  // DELETE /v1/proveedores/:id
  app.delete("/v1/proveedores/:id", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db.delete(proveedores).where(eq(proveedores.id, id)).returning();
    if (!row) return reply.status(404).send({ error: "Proveedor no encontrado" });
    return { message: "Proveedor eliminado", id: row.id };
  });
}
