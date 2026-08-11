import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { usuarios } from "../../db/schema/index.js";
import { eq, asc, sql } from "drizzle-orm";
import { authenticate, requireRole } from "../../shared/middleware/auth.js";
import bcrypt from "bcryptjs";

export async function usuariosRoutes(app: FastifyInstance) {

  // GET /v1/usuarios — list all users (admin only)
  app.get("/v1/usuarios", { preHandler: [requireRole("admin")] }, async () => {
    const rows = await db
      .select({
        id: usuarios.id,
        nombre: usuarios.nombre,
        email: usuarios.email,
        rol: usuarios.rol,
        createdAt: usuarios.createdAt,
      })
      .from(usuarios)
      .orderBy(asc(usuarios.nombre));
    return rows;
  });

  // GET /v1/usuarios/:id
  app.get("/v1/usuarios/:id", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [row] = await db
      .select({ id: usuarios.id, nombre: usuarios.nombre, email: usuarios.email, rol: usuarios.rol, createdAt: usuarios.createdAt })
      .from(usuarios).where(eq(usuarios.id, id)).limit(1);
    if (!row) return reply.status(404).send({ error: "Usuario no encontrado" });
    return row;
  });

  // PUT /v1/usuarios/:id — update user info or password
  app.put("/v1/usuarios/:id", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { nombre, email, rol, password } = request.body as {
      nombre?: string; email?: string; rol?: "admin" | "cajero"; password?: string;
    };

    const updates: Record<string, any> = {};
    if (nombre) updates.nombre = nombre;
    if (email) updates.email = email;
    if (rol) updates.rol = rol;
    if (password) {
      updates.passwordHash = await bcrypt.hash(password, 10);
      updates.tokenVersion = sql`${usuarios.tokenVersion} + 1`;
    }

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: "No hay datos para actualizar" });
    }

    try {
      const [row] = await db.update(usuarios).set(updates).where(eq(usuarios.id, id)).returning({
        id: usuarios.id, nombre: usuarios.nombre, email: usuarios.email, rol: usuarios.rol,
      });
      if (!row) return reply.status(404).send({ error: "Usuario no encontrado" });
      return row;
    } catch (err: any) {
      if (err.code === "23505") return reply.status(409).send({ error: "El email ya está en uso" });
      throw err;
    }
  });

  // DELETE /v1/usuarios/:id — delete user (cannot delete self)
  app.delete("/v1/usuarios/:id", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const currentUser = request.user;

    if (id === currentUser.id) {
      return reply.status(400).send({ error: "No puedes eliminarte a ti mismo" });
    }

    const [row] = await db.delete(usuarios).where(eq(usuarios.id, id)).returning({
      id: usuarios.id, nombre: usuarios.nombre,
    });
    if (!row) return reply.status(404).send({ error: "Usuario no encontrado" });
    return { message: `Usuario ${row.nombre} eliminado`, id: row.id };
  });
}
