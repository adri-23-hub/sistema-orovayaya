import { pgTable, uuid, integer, varchar, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { productos } from "./productos.js";
import { sucursales } from "./sucursales.js";
import { usuarios } from "./usuarios.js";
import { proveedores } from "./proveedores.js";

export const tipoMovimientoEnum = pgEnum("tipo_movimiento", [
  "entrada",
  "salida",
  "transferencia",
  "ajuste",
  "venta",
]);

export const movimientosInventario = pgTable("movimientos_inventario", {
  id: uuid("id").primaryKey().defaultRandom(),
  productoId: uuid("producto_id").notNull().references(() => productos.id, { onDelete: "cascade" }),
  sucursalId: uuid("sucursal_id").notNull().references(() => sucursales.id, { onDelete: "cascade" }),
  tipo: tipoMovimientoEnum("tipo").notNull(),
  cantidad: integer("cantidad").notNull(), // positive = entrada, negative = salida
  cantidadAnterior: integer("cantidad_anterior").notNull().default(0),
  cantidadPosterior: integer("cantidad_posterior").notNull().default(0),
  referencia: varchar("referencia", { length: 255 }), // e.g. venta_id, transferencia_id
  nota: varchar("nota", { length: 500 }),
  usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
  proveedorId: uuid("proveedor_id").references(() => proveedores.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("mov_inv_prod_suc_idx").on(table.productoId, table.sucursalId),
  index("mov_inv_referencia_idx").on(table.referencia),
  index("mov_inv_created_at_idx").on(table.createdAt),
]);

export type MovimientoInventario = typeof movimientosInventario.$inferSelect;
export type NuevoMovimientoInventario = typeof movimientosInventario.$inferInsert;
