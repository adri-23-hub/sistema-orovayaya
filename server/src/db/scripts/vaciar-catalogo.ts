import { db, pgClient } from "../index.js";
import { productos, inventario, presentacionesVenta, historialCostos, movimientosInventario } from "../schema/index.js";

async function run() {
  const [p, i, pv, hc, mi] = await Promise.all([
    db.select().from(productos),
    db.select().from(inventario),
    db.select().from(presentacionesVenta),
    db.select().from(historialCostos),
    db.select().from(movimientosInventario),
  ]);

  console.log("=== Vaciando catálogo de productos ===\n");
  console.log(`Antes → productos: ${p.length} | inventario: ${i.length} | presentaciones: ${pv.length} | historial_costos: ${hc.length} | movimientos: ${mi.length}`);

  await db.delete(productos);

  const [p2, i2, pv2, hc2, mi2] = await Promise.all([
    db.select().from(productos),
    db.select().from(inventario),
    db.select().from(presentacionesVenta),
    db.select().from(historialCostos),
    db.select().from(movimientosInventario),
  ]);

  console.log(`Después → productos: ${p2.length} | inventario: ${i2.length} | presentaciones: ${pv2.length} | historial_costos: ${hc2.length} | movimientos: ${mi2.length}`);

  await pgClient.end();
}

run().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});