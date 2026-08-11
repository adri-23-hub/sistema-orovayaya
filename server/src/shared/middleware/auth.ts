import { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../../db/index.js";
import { usuarios } from "../../db/schema/index.js";
import { eq } from "drizzle-orm";

// Extend Fastify types for JWT user
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { id: string; email: string; rol: string; nombre: string; tokenVersion: number };
    user: { id: string; email: string; rol: string; nombre: string; tokenVersion: number };
  }
}

/**
 * Authentication middleware — verifies JWT token and that the user is still active
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: "Token inválido o expirado" });
    return;
  }

  const [user] = await db
    .select({ id: usuarios.id, tokenVersion: usuarios.tokenVersion })
    .from(usuarios)
    .where(eq(usuarios.id, request.user.id))
    .limit(1);

  if (!user) {
    reply.status(401).send({ error: "Sesión inválida: el usuario ya no existe" });
    return;
  }

  if (user.tokenVersion !== request.user.tokenVersion) {
    reply.status(401).send({ error: "Sesión inválida: vuelve a iniciar sesión" });
    return;
  }
}

/**
 * RBAC guard factory — restricts access to specific roles
 */
export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await authenticate(request, reply);
    if (reply.sent) return; // authenticate already sent 401

    const user = request.user;
    if (!roles.includes(user.rol)) {
      reply.status(403).send({ error: "No tienes permisos para esta acción" });
    }
  };
}
