import { pgTable, uuid, integer, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { productos } from "./productos.js";
import { sucursales } from "./sucursales.js";

export const inventario = pgTable("inventario", {
  id: uuid("id").primaryKey().defaultRandom(),
  productoId: uuid("producto_id").notNull().references(() => productos.id, { onDelete: "cascade" }),
  sucursalId: uuid("sucursal_id").notNull().references(() => sucursales.id, { onDelete: "cascade" }),
  cantidad: integer("cantidad").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("inv_producto_sucursal_idx").on(table.productoId, table.sucursalId),
  check("cantidad_no_negativa", sql`${table.cantidad} >= 0`),
]);

export type Inventario = typeof inventario.$inferSelect;
export type NuevoInventario = typeof inventario.$inferInsert;
