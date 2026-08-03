import { pgTable, uuid, decimal, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { sucursales } from "./sucursales.js";

export interface VentaItem {
  productoId: string;
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export const ventas = pgTable("ventas", {
  id: uuid("id").primaryKey().defaultRandom(),
  sucursalId: uuid("sucursal_id").notNull().references(() => sucursales.id, { onDelete: "cascade" }),
  total: decimal("total", { precision: 12, scale: 2 }).notNull(),
  items: jsonb("items").$type<VentaItem[]>().notNull(),
  synced: boolean("synced").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Venta = typeof ventas.$inferSelect;
export type NuevaVenta = typeof ventas.$inferInsert;
