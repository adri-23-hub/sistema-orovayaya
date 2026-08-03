import { pgTable, uuid, varchar, decimal, timestamp } from "drizzle-orm/pg-core";
import { marcas } from "./marcas.js";
import { proveedores } from "./proveedores.js";

export const productos = pgTable("productos", {
  id: uuid("id").primaryKey().defaultRandom(),
  sku: varchar("sku", { length: 50 }).notNull().unique(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  descripcion: varchar("descripcion", { length: 1000 }),
  precio: decimal("precio", { precision: 12, scale: 2 }).notNull(),
  costo: decimal("costo", { precision: 12, scale: 2 }),
  categoria: varchar("categoria", { length: 100 }),
  marcaId: uuid("marca_id").references(() => marcas.id, { onDelete: "set null" }),
  proveedorId: uuid("proveedor_id").references(() => proveedores.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Producto = typeof productos.$inferSelect;
export type NuevoProducto = typeof productos.$inferInsert;
