ALTER TABLE "sync_log" ALTER COLUMN "idempotency_key" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "sync_log" ADD COLUMN "updated_at" timestamp with time zone;