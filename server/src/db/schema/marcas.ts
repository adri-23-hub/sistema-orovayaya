import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

export const marcas = pgTable("marcas", {
  id: uuid("id").primaryKey().defaultRandom(),
  nombre: varchar("nombre", { length: 255 }).notNull().unique(),
  descripcion: varchar("descripcion", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Marca = typeof marcas.$inferSelect;
export type NuevaMarca = typeof marcas.$inferInsert;
