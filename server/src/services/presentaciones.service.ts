import { eq, and, sql, gte } from "drizzle-orm";
import { inventario, movimientosInventario, ventas, presentacionesVenta, productos } from "../db/schema/index.js";
import type { VentaItem } from "../db/schema/ventas.js";
import { db } from "../db/index.js";

type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── Ingresar Stock ──────────────────────────────────────────────────────
export interface IngresarStockParams {
  productoId: string;
  sucursalId: string;
  factorConversion: number;
  cantidadRecibida: number;
  nota?: string;
  usuarioId?: string | null;
  proveedorId?: string | null;
}

export async function ingresarStock(tx: TxClient, params: IngresarStockParams) {
  const { productoId, sucursalId, factorConversion, cantidadRecibida, nota, usuarioId, proveedorId } = params;
  const unidades = cantidadRecibida * factorConversion;

  // Check if inventory record exists
  const [existing] = await tx
    .select()
    .from(inventario)
    .where(and(eq(inventario.productoId, productoId), eq(inventario.sucursalId, sucursalId)));

  let cantidadAnterior = 0;

  if (existing) {
    cantidadAnterior = existing.cantidad;
    await tx
      .update(inventario)
      .set({
        cantidad: sql`${inventario.cantidad} + ${unidades}`,
        updatedAt: new Date(),
      })
      .where(and(eq(inventario.productoId, productoId), eq(inventario.sucursalId, sucursalId)));
  } else {
    await tx.insert(inventario).values({
      productoId,
      sucursalId,
      cantidad: unidades,
    });
  }

  const cantidadPosterior = cantidadAnterior + unidades;

  await tx.insert(movimientosInventario).values({
    productoId,
    sucursalId,
    tipo: "entrada",
    cantidad: unidades,
    cantidadAnterior,
    cantidadPosterior,
    nota: nota || `Entrada de ${cantidadRecibida} presentaciones (×${factorConversion} = ${unidades} unidades)`,
    usuarioId: usuarioId ?? null,
    proveedorId: proveedorId ?? null,
  });

  return { cantidadAnterior, cantidadPosterior, unidadesIngresadas: unidades };
}

// ── Procesar Venta ──────────────────────────────────────────────────────
export interface VentaItemInput {
  presentacionId: string;
  cantidad: number;
}

export interface ProcesarVentaParams {
  sucursalId: string;
  items: VentaItemInput[];
  usuarioId?: string | null;
  ventaId?: string;        // id offline fijo (sync); si falta, genera la BD
  createdAt?: string;      // timestamp offline (sync); si falta, now()
}

export async function procesarVenta(tx: TxClient, params: ProcesarVentaParams) {
  const { sucursalId, items, usuarioId, ventaId, createdAt } = params;

  if (ventaId) {
    const [existing] = await tx.select().from(ventas).where(eq(ventas.id, ventaId));
    if (existing) {
      return undefined; // Ya existe, omitir procesamiento para evitar descontar stock 2 veces
    }
  }

  const ventaItems: VentaItem[] = [];
  const movementDataList: Array<{
    productoId: string;
    cantidadAnterior: number;
    cantidadPosterior: number;
    unidadesMinimas: number;
    nombrePresentacion: string;
    cantidadVendida: number;
  }> = [];
  let total = 0;

  for (const item of items) {
    // Resolve presentation + product from DB (never trust client-sent prices/factors)
    let [presentacion] = await tx
      .select({
        id: presentacionesVenta.id,
        productoId: presentacionesVenta.productoId,
        nombrePresentacion: presentacionesVenta.nombrePresentacion,
        factorConversion: presentacionesVenta.factorConversion,
        precioVenta: presentacionesVenta.precioVenta,
        productoNombre: productos.nombre,
      })
      .from(presentacionesVenta)
      .innerJoin(productos, eq(presentacionesVenta.productoId, productos.id))
      .where(eq(presentacionesVenta.id, item.presentacionId));

    if (!presentacion) {
      // Fallback: si no es presentación, asume que enviaron un productoId (venta legacy/unidad)
      const [prod] = await tx.select().from(productos).where(eq(productos.id, item.presentacionId));
      if (!prod) {
        throw Object.assign(new Error(`Presentación o Producto no encontrado: ${item.presentacionId}`), { statusCode: 400, isOperational: true });
      }
      presentacion = {
        id: prod.id,
        productoId: prod.id,
        nombrePresentacion: "Unidad",
        factorConversion: 1,
        precioVenta: prod.precio,
        productoNombre: prod.nombre,
      };
    }

    const precioUnitario = parseFloat(presentacion.precioVenta);
    const unidadesMinimas = item.cantidad * presentacion.factorConversion;
    const subtotal = precioUnitario * item.cantidad;

    // Atomic stock decrement — only succeeds if stock >= required units
    const updatedRows = await tx
      .update(inventario)
      .set({
        cantidad: sql`${inventario.cantidad} - ${unidadesMinimas}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(inventario.productoId, presentacion.productoId),
          eq(inventario.sucursalId, sucursalId),
          gte(inventario.cantidad, unidadesMinimas),
        ),
      )
      .returning();

    // If no row was updated, stock was insufficient → rollback
    if (updatedRows.length === 0) {
      throw Object.assign(
        new Error(`Stock insuficiente para ${presentacion.productoNombre} (${presentacion.nombrePresentacion}). Se requieren ${unidadesMinimas} unidades mínimas.`),
        { statusCode: 400, isOperational: true },
      );
    }

    // Get updated inventory for movement record
    const [invAfter] = await tx
      .select()
      .from(inventario)
      .where(
        and(
          eq(inventario.productoId, presentacion.productoId),
          eq(inventario.sucursalId, sucursalId),
        ),
      );

    const cantidadPosterior = invAfter.cantidad;
    const cantidadAnterior = cantidadPosterior + unidadesMinimas;

    ventaItems.push({
      productoId: presentacion.productoId,
      productoNombre: presentacion.productoNombre,
      presentacionId: presentacion.id,
      presentacionNombre: presentacion.nombrePresentacion,
      cantidad: item.cantidad,
      factorConversion: presentacion.factorConversion,
      unidadesMinimas,
      precioUnitario,
      subtotal,
    });

    total += subtotal;

    // Collect movement data for after sale insert
    movementDataList.push({
      productoId: presentacion.productoId,
      cantidadAnterior,
      cantidadPosterior,
      unidadesMinimas,
      nombrePresentacion: presentacion.nombrePresentacion,
      cantidadVendida: item.cantidad,
    });
  }

  // Insert sale
  const [sale] = await tx.insert(ventas).values({
    ...(ventaId ? { id: ventaId } : {}),
    sucursalId,
    total: total.toFixed(2),
    items: ventaItems,
    synced: true,
    ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
  }).onConflictDoNothing().returning();

  // Idempotencia: si ventaId ya existía, onConflictDoNothing no devuelve fila;
  // no registramos movimientos duplicados.
  if (!sale) return undefined;

  // Register inventory movements with sale reference
  for (const movData of movementDataList) {
    await tx.insert(movimientosInventario).values({
      productoId: movData.productoId,
      sucursalId,
      tipo: "venta",
      cantidad: -movData.unidadesMinimas,
      cantidadAnterior: movData.cantidadAnterior,
      cantidadPosterior: movData.cantidadPosterior,
      referencia: sale.id,
      nota: `Venta: ${movData.nombrePresentacion} ×${movData.cantidadVendida}`,
      usuarioId: usuarioId ?? null,
    });
  }

  return sale;
}

