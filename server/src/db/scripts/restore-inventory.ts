import { db, pgClient } from "../index.js";
import { productos, presentacionesVenta, inventario, sucursales } from "../schema/index.js";
import { eq } from "drizzle-orm";

async function run() {
  console.log("=== Restaurar SKU-8821 + backfill de inventario ===\n");

  const allSucursales = await db.select().from(sucursales);
  const ciudad = allSucursales.find((s: any) => s.tipo === "ciudad");
  const pueblo = allSucursales.find((s: any) => s.tipo === "pueblo");

  if (!ciudad || !pueblo) {
    console.error("Faltan sucursales. ciudad:", !!ciudad, "pueblo:", !!pueblo);
    process.exit(1);
  }
  console.log(`Sucursales: ${ciudad.nombre} (${ciudad.id}) | ${pueblo.nombre} (${pueblo.id})`);

  // 1. Restaurar SKU-8821
  const existing = await db.select().from(productos).where(eq(productos.sku, "SKU-8821"));
  let productoId: string;
  if (existing.length > 0) {
    productoId = existing[0].id;
    console.log(`SKU-8821 ya existe (${productoId}).`);
  } else {
    const [inserted] = await db.insert(productos).values({
      sku: "SKU-8821",
      nombre: "Aceite Sintético 5W-30 (5L)",
      descripcion: "Aceite de motor sintético completo de alta calidad",
      precio: "45.00",
      costo: "29.00",
      categoria: "Lubricantes",
    }).returning();
    productoId = inserted.id;
    console.log(`SKU-8821 restaurado: ${productoId}`);
  }

  // 2. Presentación "Unidad" para SKU-8821
  const existingPres = await db.select().from(presentacionesVenta).where(eq(presentacionesVenta.productoId, productoId));
  if (existingPres.length === 0) {
    await db.insert(presentacionesVenta).values({
      productoId,
      nombrePresentacion: "Unidad",
      factorConversion: 1,
      precioVenta: "45.00",
    }).onConflictDoNothing();
    console.log(`Presentación "Unidad" creada para SKU-8821.`);
  } else {
    console.log(`Presentaciones ya existentes para SKU-8821: ${existingPres.length}.`);
  }

  // 3. Backfill de inventario (cantidad 0) para TODOS los productos x 2 sucursales
  const allProducts = await db.select().from(productos);
  const inserts = [];
  for (const prod of allProducts) {
    for (const suc of [ciudad, pueblo]) {
      inserts.push({ productoId: prod.id, sucursalId: suc.id, cantidad: 0 });
    }
  }
  await db.insert(inventario).values(inserts).onConflictDoNothing();
  console.log(`Backfill completado: ${inserts.length} filas intentadas (${allProducts.length} productos x 2 sucursales).`);

  const invCount = await db.select().from(inventario);
  console.log(`Total filas en inventario ahora: ${invCount.length}`);
  console.log(`Total productos: ${allProducts.length}`);

  await pgClient.end();
  process.exit(0);
}

run().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});