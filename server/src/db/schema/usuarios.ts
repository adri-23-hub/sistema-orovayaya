import { pgTable, uuid, varchar, timestamp, pgEnum, integer } from "drizzle-orm/pg-core";

export const rolEnum = pgEnum("rol", ["admin", "cajero"]);

export const usuarios = pgTable("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  rol: rolEnum("rol").notNull().default("cajero"),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  tokenVersion: integer("token_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Usuario = typeof usuarios.$inferSelect;
export type NuevoUsuario = typeof usuarios.$inferInsert;
