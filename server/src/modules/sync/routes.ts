import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { ventas, inventario, sucursales, syncLog, movimientosInventario } from "../../db/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import type { VentaItem } from "../../db/schema/ventas.js";
import { authenticate } from "../../shared/middleware/auth.js";

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

    // Step 1: Check if already processed
    const [existing] = await db
      .select()
      .from(syncLog)
      .where(eq(syncLog.idempotencyKey, idempotencyKey));

    if (existing && existing.status === "completed") {
      // Return previous result without duplicating
      return {
        synced_ids: existing.syncedIds ?? [],
        errors: [],
        message: "Sync ya procesado previamente",
      };
    }

    // Tarea 1.6: expiración de "processing" obsoleto
    if (existing && existing.status === "processing") {
      const age = Date.now() - new Date(existing.createdAt).getTime();
      if (age < STALE_MS) {
        return reply.status(409).send({ error: "Sync en proceso, espere" });
      }
      // Registro obsoleto: reseteamos y seguimos
      await db.update(syncLog)
        .set({ status: "processing", syncedIds: [] })
        .where(eq(syncLog.idempotencyKey, idempotencyKey));
    }

    // Step 2: Mark as processing
    await db.insert(syncLog).values({
      idempotencyKey,
      status: "processing",
    }).onConflictDoNothing();

    try {
      const syncedIds: string[] = [];
      const errors: Array<{ ventaId: string; error: string }> = [];

      // Tarea 1.4: transacción con savepoints por venta
      await db.transaction(async (tx) => {
        for (const venta of payload.ventas) {
          const sp = `sp_${venta.id.replace(/-/g, "_")}`;
          try {
            await tx.execute(sql.raw(`SAVEPOINT ${sp}`));

            // Validar UUID de la venta
            if (!isUuid(venta.id)) {
              errors.push({ ventaId: venta.id, error: "Id de venta inválido" });
              await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`));
              continue;
            }

            // Insertar venta (ON CONFLICT DO NOTHING → idempotencia)
            const [inserted] = await tx.insert(ventas).values({
              id: venta.id,
              sucursalId: payload.sucursal_id,
              total: venta.total.toFixed(2),
              items: venta.items,
              synced: true,
              createdAt: new Date(venta.created_at),
            }).onConflictDoNothing().returning();

            if (inserted) {
              // Tarea 1.5: validar stock antes de descontar
              for (const item of venta.items) {
                const [inv] = await tx.select()
                  .from(inventario)
                  .where(and(
                    eq(inventario.productoId, item.productoId),
                    eq(inventario.sucursalId, payload.sucursal_id),
                  ));

                if (!inv || inv.cantidad < item.cantidad) {
                  throw new Error(`Stock insuficiente para ${item.productoNombre}`);
                }
              }

              for (const item of venta.items) {
                const [inv] = await tx.select()
                  .from(inventario)
                  .where(and(
                    eq(inventario.productoId, item.productoId),
                    eq(inventario.sucursalId, payload.sucursal_id),
                  ));

                const cantidadAnterior = inv?.cantidad ?? 0;

                await tx.update(inventario)
                  .set({
                    cantidad: sql`${inventario.cantidad} - ${item.cantidad}`,
                    updatedAt: new Date(),
                  })
                  .where(and(
                    eq(inventario.productoId, item.productoId),
                    eq(inventario.sucursalId, payload.sucursal_id),
                    sql`${inventario.cantidad} >= ${item.cantidad}`,
                  ));

                // Tarea 2.2.2: registrar movimiento de salida
                await tx.insert(movimientosInventario).values({
                  productoId: item.productoId,
                  sucursalId: payload.sucursal_id,
                  tipo: "venta",
                  cantidad: -item.cantidad,
                  cantidadAnterior,
                  cantidadPosterior: cantidadAnterior - item.cantidad,
                  referencia: venta.id,
                  nota: "Venta POS sincronizada",
                  usuarioId: (request as any).user?.id ?? null,
                });
              }
            }

            syncedIds.push(venta.id);
            await tx.execute(sql.raw(`RELEASE SAVEPOINT ${sp}`));
          } catch (err: any) {
            try { await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`)); } catch { /* ya liberado */ }
            errors.push({ ventaId: venta.id, error: err.message });
          }
        }
      });

      // Step 4: Mark as completed
      await db.update(syncLog)
        .set({ status: "completed", syncedIds })
        .where(eq(syncLog.idempotencyKey, idempotencyKey));

      return { synced_ids: syncedIds, errors };

    } catch (err: any) {
      // Mark as failed
      await db.update(syncLog)
        .set({ status: "failed" })
        .where(eq(syncLog.idempotencyKey, idempotencyKey));

      return reply.status(500).send({ error: "Error en sincronización", details: err.message });
    }
  });
}
