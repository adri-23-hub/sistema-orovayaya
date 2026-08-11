import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { usuarios } from "../../db/schema/index.js";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { authenticate, requireRole } from "../../shared/middleware/auth.js";

export async function authRoutes(app: FastifyInstance) {

  // POST /v1/auth/login
  app.post("/v1/auth/login", async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    if (!email || !password) {
      return reply.status(400).send({ error: "Email y password son requeridos" });
    }

    // Find user
    const [user] = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);
    if (!user) {
      return reply.status(401).send({ error: "Credenciales inválidas" });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return reply.status(401).send({ error: "Credenciales inválidas" });
    }

    // Generate JWT
    const token = app.jwt.sign({
      id: user.id,
      email: user.email,
      rol: user.rol,
      nombre: user.nombre,
      tokenVersion: user.tokenVersion,
    }, { expiresIn: "24h" });

    return {
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
      },
    };
  });

  // POST /v1/auth/register (admin only can register new users)
  app.post("/v1/auth/register", {
    preHandler: [requireRole("admin")],
  }, async (request, reply) => {
    const { email, password, nombre, rol } = request.body as {
      email: string; password: string; nombre: string; rol: "admin" | "cajero";
    };

    if (!email || !password || !nombre || !rol) {
      return reply.status(400).send({ error: "Todos los campos son requeridos" });
    }

    // Check if user already exists
    const [existing] = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);
    if (existing) {
      return reply.status(409).send({ error: "El email ya está registrado" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [newUser] = await db.insert(usuarios).values({
      email,
      passwordHash: hashedPassword,
      nombre,
      rol,
    }).returning();

    return reply.status(201).send({
      user: {
        id: newUser.id,
        nombre: newUser.nombre,
        email: newUser.email,
        rol: newUser.rol,
      },
    });
  });

  // GET /v1/auth/me — get current user info
  app.get("/v1/auth/me", {
    preHandler: [authenticate],
  }, async (request) => {
    return { user: request.user };
  });
}
