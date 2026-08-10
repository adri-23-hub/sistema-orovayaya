import { db } from "../index.js";
import { sucursales, inventario, ventas, movimientosInventario, transferencias } from "../schema/index.js";
import { eq, inArray, sql } from "drizzle-orm";

async function run() {
  const allSucursales = await db.select().from(sucursales);

  const ciudadBranches = allSucursales.filter((s: any) => s.tipo === "ciudad").sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());
  const puebloBranches = allSucursales.filter((s: any) => s.tipo === "pueblo").sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime());

  if (ciudadBranches.length > 1 || puebloBranches.length > 1) {
    console.log("Found duplicates. Cleaning up...");
    const primaryCiudad = ciudadBranches[0];
    const primaryPueblo = puebloBranches[0];

    const duplicates = [
      ...ciudadBranches.slice(1),
      ...puebloBranches.slice(1)
    ];
    const dupIds = duplicates.map(d => d.id);

    for (const dup of duplicates) {
      const primaryId = dup.tipo === "ciudad" ? primaryCiudad.id : primaryPueblo.id;

      const dupInv = await db.select().from(inventario).where(eq(inventario.sucursalId, dup.id));
      for (const item of dupInv) {
        if (item.cantidad > 0) {
          await db.update(inventario)
            .set({ cantidad: sql`${inventario.cantidad} + ${item.cantidad}` })
            .where(sql`${inventario.productoId} = ${item.productoId} AND ${inventario.sucursalId} = ${primaryId}`);
        }
      }

      await db.update(ventas).set({ sucursalId: primaryId }).where(eq(ventas.sucursalId, dup.id));
      await db.update(movimientosInventario).set({ sucursalId: primaryId }).where(eq(movimientosInventario.sucursalId, dup.id));

      await db.update(transferencias).set({ origenId: primaryId }).where(eq(transferencias.origenId, dup.id));
      await db.update(transferencias).set({ destinoId: primaryId }).where(eq(transferencias.destinoId, dup.id));
    }

    await db.delete(inventario).where(inArray(inventario.sucursalId, dupIds));
    await db.delete(sucursales).where(inArray(sucursales.id, dupIds));
    console.log("Cleanup complete!");
  } else {
    console.log("No duplicates found.");
  }

  process.exit(0);
}

run();
