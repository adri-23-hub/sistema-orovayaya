import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import compress from "@fastify/compress";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Module routes
import { authRoutes } from "./modules/auth/routes.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { inventoryRoutes } from "./modules/inventory/routes.js";
import { salesRoutes } from "./modules/sales/routes.js";
import { syncRoutes } from "./modules/sync/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { proveedoresRoutes } from "./modules/proveedores/routes.js";
import { marcasRoutes } from "./modules/marcas/routes.js";
import { categoriasRoutes } from "./modules/categorias/routes.js";
import { usuariosRoutes } from "./modules/usuarios/routes.js";
import { movimientosRoutes } from "./modules/movimientos/routes.js";
import { historialCostosRoutes } from "./modules/historial_costos/routes.js";
import { reportsRoutes } from "./modules/reports/routes.js";
import { presentacionesRoutes } from "./modules/presentaciones/routes.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurar logger: solo pino-pretty en desarrollo
const isProduction = process.env.NODE_ENV === "production";
const loggerConfig = isProduction
  ? { level: "warn" }
  : {
      level: "info",
      transport: {
        target: "pino-pretty",
        options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" },
      },
    };

const app = Fastify({ logger: loggerConfig });

// --- Plugins ---

// CORS: permitir todo en dev; en prod desactivado (servimos todo del mismo origen)
if (!isProduction) {
  await app.register(cors, {
    origin: true,
    credentials: true,
  });
}

await app.register(compress); // gzip/deflate/brotli para todo

// JWT — Tarea 4.7.2: JWT_SECRET obligatorio en producción (ahora en todos los entornos)
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET es obligatorio en las variables de entorno");
}

await app.register(jwt, {
  secret: process.env.JWT_SECRET,
});

// Serve static client files (1h cache for assets)
const clientPath = path.resolve(__dirname, "../../client");
await app.register(fastifyStatic, {
  root: clientPath,
  prefix: "/",
  decorateReply: true,
  maxAge: 60 * 60 * 1000, // 1 hora para assets (JS/CSS), controlada con ?v= desde el HTML
  setHeaders(res, path) {
    // HTML siempre revalida: así los bump de ?v= se propagan en la siguiente recarga
    if (path.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
});

// Redirects for convenience
app.get("/login", async (request, reply) => {
  return reply.redirect("/login.html");
});

app.get("/", async (request, reply) => {
  return reply.redirect("/login.html");
});

// --- API Routes ---
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

// Tarea 4.7.3: Error handler global
app.setErrorHandler((error: any, request, reply) => {
  // PostgreSQL 22P02 = invalid text representation (UUID mal formado)
  if (error.code === "22P02" || error.cause?.code === "22P02" || (error.message && error.message.includes("invalid input syntax for type uuid"))) {
    return reply.status(422).send({ error: "Identificador inválido" });
  }
  request.log.error(error);
  reply.status(error.statusCode || 500).send({
    error: error.statusCode && error.statusCode < 500
      ? (error.isOperational ? error.message : "Solicitud inválida")
      : "Error interno del servidor",
  });
});

// --- Health Check ---
app.get("/v1/health", async () => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

// --- Start ---
const port = parseInt(process.env.PORT || "3000");
const host = "0.0.0.0";

try {
  await app.listen({ port, host });
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║        SISTEMA OROVAYAYA — SERVIDOR           ║
  ╠══════════════════════════════════════════════╣
  ║  🟢 API:       http://localhost:${port}/v1     ║
  ║  🔐 Login:     http://localhost:${port}/login.html ║
  ║  📊 Admin:     http://localhost:${port}/admin/ ║
  ║  🛒 POS:       http://localhost:${port}/pos/   ║
  ╚══════════════════════════════════════════════╝
  `);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
