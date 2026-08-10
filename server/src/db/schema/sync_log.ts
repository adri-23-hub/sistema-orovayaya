import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const syncLog = pgTable("sync_log", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  status: text("status", { enum: ["processing", "completed", "failed"] }).notNull().default("processing"),
  syncedIds: text("synced_ids").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export type SyncLogEntry = typeof syncLog.$inferSelect;
export type NuevoSyncLogEntry = typeof syncLog.$inferInsert;
