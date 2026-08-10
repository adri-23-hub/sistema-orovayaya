import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import dotenv from "dotenv";

import { db } from "../src/db/index.js";
import { sql } from "drizzle-orm";

import { authRoutes } from "../src/modules/auth/routes.js";
import { catalogRoutes } from "../src/modules/catalog/routes.js";
import { inventoryRoutes } from "../src/modules/inventory/routes.js";
import { salesRoutes } from "../src/modules/sales/routes.js";
import { syncRoutes } from "../src/modules/sync/routes.js";
import { dashboardRoutes } from "../src/modules/dashboard/routes.js";
import { proveedoresRoutes } from "../src/modules/proveedores/routes.js";
import { marcasRoutes } from "../src/modules/marcas/routes.js";
import { categoriasRoutes } from "../src/modules/categorias/routes.js";
import { usuariosRoutes } from "../src/modules/usuarios/routes.js";
import { movimientosRoutes } from "../src/modules/movimientos/routes.js";
import { historialCostosRoutes } from "../src/modules/historial_costos/routes.js";
import { reportsRoutes } from "../src/modules/reports/routes.js";
import { presentacionesRoutes } from "../src/modules/presentaciones/routes.js";

dotenv.config();

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(jwt, { secret: process.env.JWT_SECRET || "dev-secret-key" });

  await app.register(authRoutes);
  await app.register(catalogRoutes);
  await app.register(inventoryRoutes);
  await app.register(salesRoutes);
  await app.register(syncRoutes);
  await app.register(dashboardRoutes);
  await app.register(proveedoresRoutes);
  await app.register(marcasRoutes);
  await app.register(categoriasRoutes);
  await app.register(usuariosRoutes);
  await app.register(movimientosRoutes);
  await app.register(historialCostosRoutes);
  await app.register(reportsRoutes);
  await app.register(presentacionesRoutes);

  app.setErrorHandler((error: any, request, reply) => {
    if (error.code === "22P02" || error.cause?.code === "22P02" || (error.message && error.message.includes("invalid input syntax for type uuid"))) {
      return reply.status(422).send({ error: "Identificador inválido" });
    }
    reply.status(error.statusCode || 500).send({
      error: error.statusCode && error.statusCode < 500
        ? (error.isOperational ? error.message : "Solicitud inválida")
        : "Error interno del servidor",
    });
  });

  await app.ready();
  return app;
}

export async function loginToken(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email, password },
  });
  return res.json().token;
}

export async function truncateTestTables() {
  // Solo permitir TRUNCATE si estamos en entorno de pruebas
  if (process.env.NODE_ENV !== "test" && !process.env.DATABASE_URL?.includes("test")) {
    console.warn("⚠️ truncateTestTables skipped: Not in a test environment.");
    return;
  }
  
  await db.execute(sql.raw(`
    DELETE FROM sync_log;
    DELETE FROM transferencias;
    DELETE FROM movimientos_inventario;
    DELETE FROM ventas;
  `));
}
