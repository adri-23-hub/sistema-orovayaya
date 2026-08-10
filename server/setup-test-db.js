import { execSync } from "child_process";

process.env.DATABASE_URL = "postgres://orvayaya:orvayaya_secret@localhost:5433/orvayaya_test";
process.env.SUCURSAL_CIUDAD_NOMBRE = "Central Ciudad Test";
process.env.SUCURSAL_PUEBLO_NOMBRE = "Sucursal Pueblo Test";
process.env.ADMIN_PASSWORD = "admin123";
process.env.CAJERO_PASSWORD = "cajero123";

try {
  console.log("Pushing schema to test DB...");
  execSync("npx drizzle-kit push --force", { stdio: "inherit" });
  
  console.log("Seeding test DB...");
  execSync("npx tsx src/db/seed.ts", { stdio: "inherit" });
  
  console.log("Test DB setup complete.");
} catch (err) {
  console.error("Setup failed:", err);
  process.exit(1);
}
