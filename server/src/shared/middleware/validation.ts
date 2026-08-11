import { FastifyRequest, FastifyReply } from "fastify";
import { z, ZodError } from "zod";

/**
 * Validates the request body against a Zod schema.
 * @param schema Zod schema to validate against
 */
export function validateBody(schema: z.ZodTypeAny) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      request.body = await schema.parseAsync(request.body);
    } catch (error) {
      if (error instanceof ZodError) {
        reply.status(400).send({
          error: "Error de validación",
          detalles: error.issues.map(e => ({
            campo: e.path.join('.'),
            mensaje: e.message
          }))
        });
        return;
      } else {
        reply.status(500).send({ error: "Error interno durante la validación" });
        return;
      }
    }
  };
}

/**
 * Validates the request query parameters against a Zod schema.
 * @param schema Zod schema to validate against
 */
export function validateQuery(schema: z.ZodTypeAny) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      request.query = await schema.parseAsync(request.query);
    } catch (error) {
      if (error instanceof ZodError) {
        reply.status(400).send({
          error: "Error de validación en parámetros de consulta",
          detalles: error.issues.map(e => ({
            campo: e.path.join('.'),
            mensaje: e.message
          }))
        });
        return;
      } else {
        reply.status(500).send({ error: "Error interno durante la validación" });
        return;
      }
    }
  };
}
