import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { inventario, productos, sucursales, transferencias, movimientosInventario, presentacionesVenta } from "../../db/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { authenticate, requireRole } from "../../shared/middleware/auth.js";

export async function inventoryRoutes(app: FastifyInstance) {

  // GET /v1/inventory?sucursal_id= — list inventory for a branch
  app.get("/v1/inventory", { preHandler: [authenticate] }, async (request) => {
    const { sucursal_id } = request.query as { sucursal_id?: string };
    const query = db
      .select({
        id: inventario.id,
        productoId: inventario.productoId,
        productoNombre: productos.nombre,
        productoSku: productos.sku,
        categoria: productos.categoria,
        precio: productos.precio,
        sucursalId: inventario.sucursalId,
        sucursalNombre: sucursales.nombre,
        sucursalTipo: sucursales.tipo,
        cantidad: inventario.cantidad,
        updatedAt: inventario.updatedAt,
      })
      .from(inventario)
      .innerJoin(productos, eq(inventario.productoId, productos.id))
      .innerJoin(sucursales, eq(inventario.sucursalId, sucursales.id));

    if (sucursal_id) return await query.where(eq(inventario.sucursalId, sucursal_id));
    return await query;
  });

  // GET /v1/inventory/global — inventory grouped by product with both branches
  app.get("/v1/inventory/global", { preHandler: [requireRole("admin")] }, async () => {
    const allInventory = await db
      .select({
        productoId: inventario.productoId,
        productoNombre: productos.nombre,
        productoSku: productos.sku,
        categoria: productos.categoria,
        precio: productos.precio,
        sucursalId: inventario.sucursalId,
        sucursalTipo: sucursales.tipo,
        cantidad: inventario.cantidad,
      })
      .from(inventario)
      .innerJoin(productos, eq(inventario.productoId, productos.id))
      .innerJoin(sucursales, eq(inventario.sucursalId, sucursales.id));

    const grouped = new Map<string, any>();
    for (const row of allInventory) {
      if (!grouped.has(row.productoId)) {
        grouped.set(row.productoId, {
          productoId: row.productoId,
          productoNombre: row.productoNombre,
          productoSku: row.productoSku,
          categoria: row.categoria,
          precio: row.precio,
          stockCiudad: 0,
          stockPueblo: 0,
        });
      }
      const entry = grouped.get(row.productoId)!;
      if (row.sucursalTipo === "ciudad") entry.stockCiudad = row.cantidad;
      else entry.stockPueblo = row.cantidad;
    }
    return Array.from(grouped.values());
  });

  // GET /v1/sucursales — list all branches
  app.get("/v1/sucursales", { preHandler: [authenticate] }, async () => {
    return await db.select().from(sucursales);
  });

  // ── POST /v1/inventory/adjust ──────────────────────────────────
  // Ingresa, descuenta o ajusta stock en cualquier sucursal (admin)
  // Body: { producto_id, sucursal_id, cantidad (positivo), tipo, nota?, presentacion_id? }
  // tipo: "entrada" | "salida" | "ajuste"
  // Si viene presentacion_id, la cantidad se multiplica por factorConversion
  app.post("/v1/inventory/adjust", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { producto_id, sucursal_id, cantidad, tipo, nota, proveedor_id, presentacion_id } = request.body as {
      producto_id: string;
      sucursal_id: string;
      cantidad: number;
      tipo: "entrada" | "salida" | "ajuste";
      nota?: string;
      proveedor_id?: string;
      presentacion_id?: string;
    };

    if (!producto_id || !sucursal_id || !cantidad || cantidad === 0) {
      return reply.status(400).send({ error: "producto_id, sucursal_id y cantidad (distinta de 0) son requeridos" });
    }
    if (!['entrada', 'salida', 'ajuste'].includes(tipo)) {
      return reply.status(400).send({ error: "tipo debe ser: entrada, salida o ajuste" });
    }

    // Resolve factor_conversion from presentacion if provided
    let factorConversion = 1;
    if (presentacion_id) {
      const [presentacion] = await db
        .select()
        .from(presentacionesVenta)
        .where(eq(presentacionesVenta.id, presentacion_id));

      if (!presentacion) {
        return reply.status(404).send({ error: "Presentación no encontrada" });
      }

      // Verify the presentation belongs to the specified product
      if (presentacion.productoId !== producto_id) {
        return reply.status(400).send({ error: "La presentación no pertenece al producto especificado" });
      }

      factorConversion = presentacion.factorConversion;
    }

    // cantidad in body is "units of presentation"; real units = cantidad * factorConversion
    const cantidadEnUnidadesMinimas = Math.abs(cantidad) * factorConversion;

    // Get current stock
    const [current] = await db
      .select()
      .from(inventario)
      .where(and(eq(inventario.productoId, producto_id), eq(inventario.sucursalId, sucursal_id)));

    if (!current) {
      return reply.status(404).send({ error: "Registro de inventario no encontrado para ese producto y sucursal" });
    }

    const cantidadAnterior = current.cantidad;
    // Tarea 4.4: salida siempre resta; ajuste permite positivo o negativo; entrada siempre suma
    const delta = tipo === "salida" ? -cantidadEnUnidadesMinimas : (tipo === "ajuste" ? (cantidad > 0 ? cantidadEnUnidadesMinimas : -cantidadEnUnidadesMinimas) : cantidadEnUnidadesMinimas);
    const cantidadPosterior = cantidadAnterior + delta;

    if (cantidadPosterior < 0) {
      return reply.status(400).send({
        error: "Stock insuficiente para realizar la salida",
        stockActual: cantidadAnterior,
      });
    }

    const result = await db.transaction(async (tx) => {
      await tx.update(inventario)
        .set({ cantidad: cantidadPosterior, updatedAt: new Date() })
        .where(and(eq(inventario.productoId, producto_id), eq(inventario.sucursalId, sucursal_id)));

      const [mov] = await tx.insert(movimientosInventario).values({
        productoId: producto_id,
        sucursalId: sucursal_id,
        tipo,
        cantidad: delta,
        cantidadAnterior,
        cantidadPosterior,
        nota: nota || (factorConversion > 1 ? `Ajuste: ${cantidad} presentaciones ×${factorConversion} = ${cantidadEnUnidadesMinimas} unidades` : null),
        usuarioId: (request as any).user?.id ?? null, // Tarea 2.2.4
        proveedorId: proveedor_id || null,
      }).returning();

      return {
        movimiento_id: mov.id,
        stock_anterior: cantidadAnterior,
        stock_nuevo: cantidadPosterior,
        delta,
        factor_conversion: factorConversion,
      };
    });

    return reply.status(201).send(result);
  });

  // ── POST /v1/inventory/adjust-batch ─────────────────────────────
  // Registra una planilla de ingresos (varias líneas) en una sola transacción atómica.
  // Body: { sucursal_id, nota?, items: [{ producto_id, presentacion_id?, cantidad, proveedor_id? }] }
  app.post("/v1/inventory/adjust-batch", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { sucursal_id, nota, items } = request.body as {
      sucursal_id: string;
      nota?: string;
      items: Array<{
        producto_id: string;
        presentacion_id?: string;
        cantidad: number;
        proveedor_id?: string;
      }>;
    };

    if (!sucursal_id || !Array.isArray(items) || items.length === 0) {
      return reply.status(400).send({ error: "sucursal_id e items (no vacío) son requeridos" });
    }

    const referencia = "planilla-" + randomUUID();
    const usuarioId = (request as any).user?.id ?? null;
    const resultadoItems: any[] = [];

    try {
      await db.transaction(async (tx) => {
        for (const item of items) {
          if (!item.producto_id || !item.cantidad || item.cantidad === 0) {
            throw Object.assign(new Error("Cada item requiere producto_id y cantidad distinta de 0"), { statusCode: 400 });
          }

          let factorConversion = 1;
          if (item.presentacion_id) {
            const [presentacion] = await tx
              .select()
              .from(presentacionesVenta)
              .where(eq(presentacionesVenta.id, item.presentacion_id));

            if (!presentacion) {
              throw Object.assign(new Error("Presentación no encontrada"), { statusCode: 404 });
            }
            if (presentacion.productoId !== item.producto_id) {
              throw Object.assign(new Error("La presentación no pertenece al producto especificado"), { statusCode: 400 });
            }
            factorConversion = presentacion.factorConversion;
          }

          const unidades = Math.abs(item.cantidad) * factorConversion;

          const [current] = await tx
            .select()
            .from(inventario)
            .where(and(eq(inventario.productoId, item.producto_id), eq(inventario.sucursalId, sucursal_id)));

          if (!current) {
            throw Object.assign(new Error("Registro de inventario no encontrado para ese producto y sucursal"), { statusCode: 404 });
          }

          const cantidadAnterior = current.cantidad;
          const cantidadPosterior = cantidadAnterior + unidades;

          await tx.update(inventario)
            .set({ cantidad: cantidadPosterior, updatedAt: new Date() })
            .where(and(eq(inventario.productoId, item.producto_id), eq(inventario.sucursalId, sucursal_id)));

          await tx.insert(movimientosInventario).values({
            productoId: item.producto_id,
            sucursalId: sucursal_id,
            tipo: "entrada",
            cantidad: unidades,
            cantidadAnterior,
            cantidadPosterior,
            referencia,
            nota: nota || `Ingreso: ${item.cantidad} presentaciones ×${factorConversion} = ${unidades} unidades`,
            usuarioId,
            proveedorId: item.proveedor_id || null,
          });

          resultadoItems.push({
            producto_id: item.producto_id,
            presentacion_id: item.presentacion_id || null,
            cantidad: item.cantidad,
            factor_conversion: factorConversion,
            unidades,
            stock_anterior: cantidadAnterior,
            stock_nuevo: cantidadPosterior,
          });
        }
      });
    } catch (error: any) {
      return reply.status(error.statusCode || 500).send({ error: error.message });
    }

    return reply.status(201).send({ referencia, items: resultadoItems });
  });

  // ── POST /v1/transfers-batch ────────────────────────────────────
  // Planilla de envíos ciudad → pueblo en una sola transacción atómica.
  // Body: { items: [{ producto_id, presentacion_id?, cantidad }] }
  app.post("/v1/transfers-batch", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { items } = request.body as {
      items: Array<{ producto_id: string; presentacion_id?: string; cantidad: number }>;
    };

    if (!Array.isArray(items) || items.length === 0) {
      return reply.status(400).send({ error: "items (no vacío) son requeridos" });
    }

    const allBranches = await db.select().from(sucursales);
    const origen = allBranches.find(s => s.tipo === "ciudad");
    const destino = allBranches.find(s => s.tipo === "pueblo");
    if (!origen || !destino) return reply.status(500).send({ error: "Sucursales no configuradas" });

    const usuarioId = (request as any).user?.id ?? null;
    const resultadoItems: any[] = [];

    try {
      await db.transaction(async (tx) => {
        for (const item of items) {
          if (!item.producto_id || !item.cantidad || item.cantidad <= 0) {
            throw Object.assign(new Error("Error item: producto_id y cantidad positiva requeridos"), { statusCode: 400 });
          }

          let factorConversion = 1;
          let nombrePresentacion = "Unidad";
          if (item.presentacion_id) {
            const [presentacion] = await tx
              .select()
              .from(presentacionesVenta)
              .where(eq(presentacionesVenta.id, item.presentacion_id));

            if (!presentacion) {
              throw Object.assign(new Error("Presentación no encontrada"), { statusCode: 404 });
            }
            if (presentacion.productoId !== item.producto_id) {
              throw Object.assign(new Error("La presentación no pertenece al producto especificado"), { statusCode: 400 });
            }
            factorConversion = presentacion.factorConversion;
            nombrePresentacion = presentacion.nombrePresentacion;
          }

          const unidades = item.cantidad * factorConversion;

          const [originStock] = await tx
            .select()
            .from(inventario)
            .where(and(eq(inventario.productoId, item.producto_id), eq(inventario.sucursalId, origen.id)));

          if (!originStock || originStock.cantidad < unidades) {
            const nombreProducto = item.producto_id;
            throw Object.assign(new Error(`Stock insuficiente en origen (se requieren ${unidades} unidades) para el producto ${nombreProducto}`), { statusCode: 400 });
          }

          const [stockOrigenAntes] = await tx.select().from(inventario)
            .where(and(eq(inventario.productoId, item.producto_id), eq(inventario.sucursalId, origen.id)));
          const [stockDestinoAntes] = await tx.select().from(inventario)
            .where(and(eq(inventario.productoId, item.producto_id), eq(inventario.sucursalId, destino.id)));

          await tx.update(inventario)
            .set({ cantidad: sql`${inventario.cantidad} - ${unidades}`, updatedAt: new Date() })
            .where(and(eq(inventario.productoId, item.producto_id), eq(inventario.sucursalId, origen.id)));

          await tx.update(inventario)
            .set({ cantidad: sql`${inventario.cantidad} + ${unidades}`, updatedAt: new Date() })
            .where(and(eq(inventario.productoId, item.producto_id), eq(inventario.sucursalId, destino.id)));

          const [transfer] = await tx.insert(transferencias).values({
            productoId: item.producto_id,
            origenId: origen.id,
            destinoId: destino.id,
            cantidad: unidades,
          }).returning();

          const notaOrigen = `Transferencia de ${item.cantidad} ${nombrePresentacion} a ` + destino.nombre;
          const notaDestino = `Transferencia de ${item.cantidad} ${nombrePresentacion} desde ` + origen.nombre;

          await tx.insert(movimientosInventario).values({
            productoId: item.producto_id,
            sucursalId: origen.id,
            tipo: "transferencia",
            cantidad: -unidades,
            cantidadAnterior: stockOrigenAntes?.cantidad ?? 0,
            cantidadPosterior: (stockOrigenAntes?.cantidad ?? 0) - unidades,
            referencia: transfer.id,
            nota: notaOrigen,
            usuarioId,
          });

          await tx.insert(movimientosInventario).values({
            productoId: item.producto_id,
            sucursalId: destino.id,
            tipo: "transferencia",
            cantidad: unidades,
            cantidadAnterior: stockDestinoAntes?.cantidad ?? 0,
            cantidadPosterior: (stockDestinoAntes?.cantidad ?? 0) + unidades,
            referencia: transfer.id,
            nota: notaDestino,
            usuarioId,
          });

          resultadoItems.push({
            producto_id: item.producto_id,
            presentacion_id: item.presentacion_id || null,
            cantidad: item.cantidad,
            factor_conversion: factorConversion,
            unidades,
            transfer_id: transfer.id,
          });
        }
      });
    } catch (error: any) {
      return reply.status(error.statusCode || 500).send({ error: error.message });
    }

    return reply.status(201).send({ items: resultadoItems });
  });

  // POST /v1/transfers — transfer stock ciudad → pueblo (admin only)
  app.post("/v1/transfers", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { producto_id, cantidad, presentacion_id } = request.body as { producto_id: string; cantidad: number; presentacion_id?: string };

    if (!producto_id || !cantidad || cantidad <= 0) {
      return reply.status(400).send({ error: "producto_id y cantidad positiva son requeridos" });
    }

    // Resolve factor_conversion from presentacion if provided
    let factorConversion = 1;
    if (presentacion_id) {
      const [presentacion] = await db
        .select()
        .from(presentacionesVenta)
        .where(eq(presentacionesVenta.id, presentacion_id));

      if (!presentacion) return reply.status(404).send({ error: "Presentación no encontrada" });
      if (presentacion.productoId !== producto_id) return reply.status(400).send({ error: "La presentación no pertenece al producto especificado" });

      factorConversion = presentacion.factorConversion;
    }

    // cantidad in body is "units of presentation"; real units = cantidad * factorConversion
    const unidades = cantidad * factorConversion;

    const allBranches = await db.select().from(sucursales);
    const origen = allBranches.find(s => s.tipo === "ciudad");
    const destino = allBranches.find(s => s.tipo === "pueblo");

    if (!origen || !destino) return reply.status(500).send({ error: "Sucursales no configuradas" });

    const [originStock] = await db.select().from(inventario)
      .where(and(eq(inventario.productoId, producto_id), eq(inventario.sucursalId, origen.id)));

    if (!originStock || originStock.cantidad < unidades) {
      return reply.status(400).send({
        error: "Stock insuficiente en origen",
        stockDisponible: originStock?.cantidad ?? 0,
      });
    }

    const result = await db.transaction(async (tx) => {
      // Capturar stocks previos
      const [stockOrigenAntes] = await tx.select().from(inventario)
        .where(and(eq(inventario.productoId, producto_id), eq(inventario.sucursalId, origen.id)));
      const [stockDestinoAntes] = await tx.select().from(inventario)
        .where(and(eq(inventario.productoId, producto_id), eq(inventario.sucursalId, destino.id)));

      await tx.update(inventario)
        .set({ cantidad: sql`${inventario.cantidad} - ${unidades}`, updatedAt: new Date() })
        .where(and(eq(inventario.productoId, producto_id), eq(inventario.sucursalId, origen.id)));

      await tx.update(inventario)
        .set({ cantidad: sql`${inventario.cantidad} + ${unidades}`, updatedAt: new Date() })
        .where(and(eq(inventario.productoId, producto_id), eq(inventario.sucursalId, destino.id)));

      const [transfer] = await tx.insert(transferencias).values({
        productoId: producto_id,
        origenId: origen.id,
        destinoId: destino.id,
        cantidad: unidades,
      }).returning();

      // Tarea 2.2.3: movimientos para origen y destino
      await tx.insert(movimientosInventario).values({
        productoId: producto_id,
        sucursalId: origen.id,
        tipo: "transferencia",
        cantidad: -unidades,
        cantidadAnterior: stockOrigenAntes?.cantidad ?? 0,
        cantidadPosterior: (stockOrigenAntes?.cantidad ?? 0) - unidades,
        referencia: transfer.id,
        nota: `Transferencia de ${cantidad} presentaciones (×${factorConversion}) a ` + destino.nombre,
        usuarioId: (request as any).user?.id ?? null,
      });

      await tx.insert(movimientosInventario).values({
        productoId: producto_id,
        sucursalId: destino.id,
        tipo: "transferencia",
        cantidad: unidades,
        cantidadAnterior: stockDestinoAntes?.cantidad ?? 0,
        cantidadPosterior: (stockDestinoAntes?.cantidad ?? 0) + unidades,
        referencia: transfer.id,
        nota: `Transferencia de ${cantidad} presentaciones (×${factorConversion}) desde ` + origen.nombre,
        usuarioId: (request as any).user?.id ?? null,
      });

      const [newOrigen] = await tx.select().from(inventario)
        .where(and(eq(inventario.productoId, producto_id), eq(inventario.sucursalId, origen.id)));
      const [newDestino] = await tx.select().from(inventario)
        .where(and(eq(inventario.productoId, producto_id), eq(inventario.sucursalId, destino.id)));

      return {
        transfer_id: transfer.id,
        stock_origen_restante: newOrigen.cantidad,
        stock_destino_nuevo: newDestino.cantidad,
        factor_conversion: factorConversion,
      };
    });

    return reply.status(201).send(result);
  });

  // GET /v1/transfers — list recent transfers
  app.get("/v1/transfers", { preHandler: [requireRole("admin")] }, async (request) => {
    const { limit = "20" } = request.query as { limit?: string };
    return await db
      .select({
        id: transferencias.id,
        productoId: transferencias.productoId,
        productoNombre: productos.nombre,
        cantidad: transferencias.cantidad,
        createdAt: transferencias.createdAt,
      })
      .from(transferencias)
      .innerJoin(productos, eq(transferencias.productoId, productos.id))
      .orderBy(sql`${transferencias.createdAt} DESC`)
      .limit(parseInt(limit));
  });
}
