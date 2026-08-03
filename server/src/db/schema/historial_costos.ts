import { pgTable, uuid, decimal, timestamp, varchar } from "drizzle-orm/pg-core";
import { productos } from "./productos.js";

export const historialCostos = pgTable("historial_costos", {
  id: uuid("id").primaryKey().defaultRandom(),
  productoId: uuid("producto_id").notNull().references(() => productos.id, { onDelete: "cascade" }),
  costoAnterior: decimal("costo_anterior", { precision: 12, scale: 2 }),
  costoNuevo: decimal("costo_nuevo", { precision: 12, scale: 2 }).notNull(),
  precioAnterior: decimal("precio_anterior", { precision: 12, scale: 2 }),
  precioNuevo: decimal("precio_nuevo", { precision: 12, scale: 2 }).notNull(),
  motivo: varchar("motivo", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HistorialCosto = typeof historialCostos.$inferSelect;
export type NuevoHistorialCosto = typeof historialCostos.$inferInsert;
