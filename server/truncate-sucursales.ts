import { db, pgClient } from "./src/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql.raw("TRUNCATE TABLE sucursales, sync_log CASCADE"));
  await pgClient.end();
  console.log("Tablas truncadas.");
}

main().catch(console.error);
