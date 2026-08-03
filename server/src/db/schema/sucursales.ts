import { pgTable, uuid, varchar, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const tipoSucursalEnum = pgEnum("tipo_sucursal", ["ciudad", "pueblo"]);

export const sucursales = pgTable("sucursales", {
  id: uuid("id").primaryKey().defaultRandom(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  tipo: tipoSucursalEnum("tipo").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Sucursal = typeof sucursales.$inferSelect;
export type NuevaSucursal = typeof sucursales.$inferInsert;
