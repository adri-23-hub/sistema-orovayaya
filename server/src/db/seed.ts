import { db, pgClient } from "./index.js";
import { sucursales, usuarios } from "./schema/index.js";
import bcrypt from "bcryptjs";

async function seed() {
  console.log("🌱 Seeding database...");

  // 1. Create branches
  const [ciudad] = await db.insert(sucursales).values({
    nombre: process.env.SUCURSAL_CIUDAD_NOMBRE || "Central Ciudad",
    tipo: "ciudad",
  }).onConflictDoNothing().returning();

  const [pueblo] = await db.insert(sucursales).values({
    nombre: process.env.SUCURSAL_PUEBLO_NOMBRE || "Sucursal Pueblo",
    tipo: "pueblo",
  }).onConflictDoNothing().returning();

  console.log("  ✅ Sucursales creadas:", ciudad?.nombre, pueblo?.nombre);

  // 2. Create default admin user
  // ⚠️ Los tests (server/tests/) usan admin123 / cajero123.
  // Mantener sincronizado con .env.example y helpers.ts:loginToken()
  const adminPassword = process.env.ADMIN_PASSWORD || "CambiarEnProduccion123";
  const hashedPassword = await bcrypt.hash(adminPassword, 10);
  await db.insert(usuarios).values({
    email: "admin@orvayaya.com",
    passwordHash: hashedPassword,
    rol: "admin",
    nombre: "Administrador",
  }).onConflictDoNothing();

  // Create default cashier user
  const cajeroPassword = process.env.CAJERO_PASSWORD || "CambiarEnProduccion123";
  const cajeroHash = await bcrypt.hash(cajeroPassword, 10);
  await db.insert(usuarios).values({
    email: "cajero@orvayaya.com",
    passwordHash: cajeroHash,
    rol: "cajero",
    nombre: "Cajero Principal",
  }).onConflictDoNothing();

  console.log("  ✅ Usuarios creados (admin@orvayaya.com, cajero@orvayaya.com)");

  console.log("🎉 Seed completado!");

  await pgClient.end();
}

seed().catch((err) => {
  console.error("❌ Error en seed:", err);
  process.exit(1);
});
