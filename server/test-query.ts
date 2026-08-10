import { db } from "./src/db/index.js";
import { presentacionesVenta } from "./src/db/schema/presentaciones.js";
import { productos } from "./src/db/schema/productos.js";
import { eq } from "drizzle-orm";

async function main() {
  const gaseosa = await db.select().from(productos).where(eq(productos.nombre, "Gaseosa Cola 500ml"));
  console.log("Gaseosa:", gaseosa);
  
  if (gaseosa.length) {
    const pres = await db.select().from(presentacionesVenta).where(eq(presentacionesVenta.productoId, gaseosa[0].id));
    console.log("Presentaciones de Gaseosa:");
    console.log(pres);
  }
  process.exit(0);
}
main();
