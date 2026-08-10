import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { syncLog } from "../../db/schema/index.js";
import { eq, sql } from "drizzle-orm";
import type { VentaItem } from "../../db/schema/ventas.js";
import { authenticate } from "../../shared/middleware/auth.js";
import { procesarVenta } from "../../services/presentaciones.service.js";

// Tiempo máximo en que un registro "processing" se considera obsoleto
const STALE_MS = 5 * 60 * 1000; // 5 minutos

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

interface SyncPayload {
  sucursal_id: string;
  ventas: Array<{
    id: string;
    items: VentaItem[];
    total: number;
    created_at: string;
  }>;
}

export async function syncRoutes(app: FastifyInstance) {

  // POST /v1/sync — batch sync from POS (with idempotency key)
  // Tarea 1.2: requiere autenticación
  app.post("/v1/sync", { preHandler: [authenticate] }, async (request, reply) => {
    const idempotencyKey = request.headers["idempotency-key"] as string;

    if (!idempotencyKey) {
      return reply.status(400).send({ error: "Idempotency-Key header es requerido" });
    }

    const payload = request.body as SyncPayload;

    if (!payload.sucursal_id || !payload.ventas || payload.ventas.length === 0) {
      return reply.status(400).send({ error: "sucursal_id y ventas son requeridos" });
    }

    // B2a: Claim atómico
    const [claimed] = await db.insert(syncLog).values({
      idempotencyKey,
      status: "processing",
    }).onConflictDoUpdate({
      target: syncLog.idempotencyKey,
      set: { status: "processing", updatedAt: new Date(), syncedIds: [] },
      // Update solo si falló, o si está trabado en processing por más de STALE_MS
      where: sql`${syncLog.status} = 'failed' OR (${syncLog.status} = 'processing' AND EXTRACT(EPOCH FROM (NOW() - ${syncLog.createdAt})) * 1000 >= ${STALE_MS})`
    }).returning();

    if (!claimed) {
      // Si no pudimos hacer claim, es porque ya está en processing (no stale) o completed.
      const [existing] = await db.select().from(syncLog).where(eq(syncLog.idempotencyKey, idempotencyKey));
      if (existing?.status === "completed") {
        return {
          synced_ids: existing.syncedIds ?? [],
          errors: [],
          message: "Sync ya procesado previamente",
        };
      }
      return reply.status(409).send({ error: "Sync en proceso, espere" });
    }

    try {
      const syncedIds: string[] = [];
      const errors: Array<{ ventaId: string; error: string }> = [];

      // Tarea 1.4: transacción con savepoints por venta
      await db.transaction(async (tx) => {
        for (const venta of payload.ventas) {
          let sp: string | undefined;
          try {
            // Validar UUID de la venta ANTES de construir cualquier savepoint
            if (!isUuid(venta.id)) {
              errors.push({ ventaId: venta.id, error: "Id de venta inválido" });
              continue;
            }
            sp = `sp_${venta.id.replace(/-/g, "_")}`;
            await tx.execute(sql.raw(`SAVEPOINT ${sp}`));

            // Resolver presentaciones server-side: nunca confiar en total/items del cliente
            const sale = await procesarVenta(tx, {
              sucursalId: payload.sucursal_id,
              items: (venta.items ?? []).map(it => ({
                presentacionId: it.presentacionId ?? it.productoId,   // fallback legacy "Unidad"
                cantidad: it.cantidad,
              })),
              usuarioId: (request as any).user?.id ?? null,
              ventaId: venta.id,
              createdAt: venta.created_at,
            });

            if (sale) {
              syncedIds.push(venta.id);
            } else {
              // idempotencia: la venta ya existía (ON CONFLICT DO NOTHING)
              syncedIds.push(venta.id);
            }

            await tx.execute(sql.raw(`RELEASE SAVEPOINT ${sp}`));
          } catch (err: any) {
            if (sp) {
              try { await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`)); } catch { /* ya liberado */ }
            }
            errors.push({ ventaId: venta.id, error: err.message });
          }
        }
      });

      // Step 4: Mark as completed
      await db.update(syncLog)
        .set({ status: "completed", syncedIds, updatedAt: new Date() })
        .where(eq(syncLog.idempotencyKey, idempotencyKey));

      return { synced_ids: syncedIds, errors };

    } catch (err: any) {
      // Mark as failed
      await db.update(syncLog)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(syncLog.idempotencyKey, idempotencyKey));

      request.log.error(err);
      return reply.status(500).send({ error: "Error en sincronización" });
    }
  });
}
