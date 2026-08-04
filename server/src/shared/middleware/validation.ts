import { FastifyRequest, FastifyReply } from "fastify";
import { ZodObject, ZodError } from "zod";

/**
 * Validates the request body against a Zod schema.
 * @param schema Zod schema to validate against
 */
export function validateBody(schema: ZodObject) {
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
      } else {
        reply.status(500).send({ error: "Error interno durante la validación" });
      }
    }
  };
}

/**
 * Validates the request query parameters against a Zod schema.
 * @param schema Zod schema to validate against
 */
export function validateQuery(schema: ZodObject) {
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
      } else {
        reply.status(500).send({ error: "Error interno durante la validación" });
      }
    }
  };
}
