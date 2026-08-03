import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

// Extend Fastify types for JWT user
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { id: string; email: string; rol: string; nombre: string };
    user: { id: string; email: string; rol: string; nombre: string };
  }
}

/**
 * Authentication middleware — verifies JWT token
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: "Token inválido o expirado" });
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
