import { pgTable, uuid, varchar, decimal, integer, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { productos } from "./productos.js";
import { z } from "zod";

export const presentacionesVenta = pgTable("presentaciones_venta", {
  id: uuid("id").primaryKey().defaultRandom(),
  productoId: uuid("producto_id").notNull().references(() => productos.id, { onDelete: "cascade" }),
  nombrePresentacion: varchar("nombre_presentacion", { length: 100 }).notNull(),
  factorConversion: integer("factor_conversion").notNull(),
  precioVenta: decimal("precio_venta", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("pv_producto_nombre_idx").on(table.productoId, table.nombrePresentacion),
  check("factor_conversion_positivo", sql`${table.factorConversion} > 0`),
]);

export type PresentacionVenta = typeof presentacionesVenta.$inferSelect;
export type NuevaPresentacionVenta = typeof presentacionesVenta.$inferInsert;

// Zod schemas for route validation
export const crearPresentacionSchema = z.object({
  producto_id: z.string().uuid("ID de producto inválido"),
  nombre_presentacion: z.string().min(1, "Nombre de presentación requerido"),
  factor_conversion: z.number().int().min(1, "Factor de conversión debe ser >= 1"),
  precio_venta: z.number().positive("Precio de venta debe ser > 0"),
});

export const actualizarPresentacionSchema = z.object({
  nombre_presentacion: z.string().min(1, "Nombre de presentación requerido").optional(),
  factor_conversion: z.number().int().min(1, "Factor de conversión debe ser >= 1").optional(),
  precio_venta: z.number().positive("Precio de venta debe ser > 0").optional(),
});
