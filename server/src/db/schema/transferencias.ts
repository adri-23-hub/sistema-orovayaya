import { pgTable, uuid, integer, timestamp } from "drizzle-orm/pg-core";
import { productos } from "./productos.js";
import { sucursales } from "./sucursales.js";

export const transferencias = pgTable("transferencias", {
  id: uuid("id").primaryKey().defaultRandom(),
  productoId: uuid("producto_id").notNull().references(() => productos.id, { onDelete: "cascade" }),
  origenId: uuid("origen_id").notNull().references(() => sucursales.id, { onDelete: "cascade" }),
  destinoId: uuid("destino_id").notNull().references(() => sucursales.id, { onDelete: "cascade" }),
  cantidad: integer("cantidad").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Transferencia = typeof transferencias.$inferSelect;
export type NuevaTransferencia = typeof transferencias.$inferInsert;
