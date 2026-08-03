import { pgTable, uuid, varchar, timestamp } from "drizzle-orm/pg-core";

export const categorias = pgTable("categorias", {
  id: uuid("id").primaryKey().defaultRandom(),
  nombre: varchar("nombre", { length: 100 }).notNull().unique(),
  descripcion: varchar("descripcion", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Categoria = typeof categorias.$inferSelect;
export type NuevaCategoria = typeof categorias.$inferInsert;
