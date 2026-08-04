import { db, pgClient } from "./index.js";
import { sucursales, usuarios, productos, inventario } from "./schema/index.js";
import { eq } from "drizzle-orm";
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

  // Get sucursales if they already existed
  const allSucursales = await db.select().from(sucursales);
  const ciudadId = allSucursales.find(s => s.tipo === "ciudad")!.id;
  const puebloId = allSucursales.find(s => s.tipo === "pueblo")!.id;

  // 2. Create default admin user
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

  // 3. Seed demo products
  const demoProducts = [
    { sku: "SKU-8821", nombre: "Aceite Sintético 5W-30 (5L)", descripcion: "Aceite de motor sintético completo de alta calidad", precio: "45.00", costo: "29.00", categoria: "Lubricantes" },
    { sku: "SKU-1044", nombre: "Filtro de Aceite Universal", descripcion: "Filtro de aceite compatible con múltiples marcas", precio: "18.50", costo: "11.00", categoria: "Filtros" },
    { sku: "SKU-9930", nombre: "Líquido de Frenos DOT 4 (1L)", descripcion: "Líquido de frenos de alto rendimiento", precio: "22.00", costo: "14.00", categoria: "Fluidos" },
    { sku: "SKU-2250", nombre: "Batería 12V 65Ah", descripcion: "Batería automotriz de larga duración", precio: "120.00", costo: "78.00", categoria: "Baterías" },
    { sku: "SKU-5512", nombre: "Bujías Platino (Set x4)", descripcion: "Set de 4 bujías de platino de alto rendimiento", precio: "32.00", costo: "20.00", categoria: "Eléctrico" },
    { sku: "SKU-8012", nombre: "Aceite Sintético 5W30", descripcion: "Aceite sintético premium para motores modernos", precio: "45.00", costo: "29.00", categoria: "Aceites" },
    { sku: "SKU-9941", nombre: "Filtro de Aire Premium", descripcion: "Filtro de aire de alta eficiencia", precio: "18.50", costo: "11.00", categoria: "Filtros" },
    { sku: "SKU-BAT75", nombre: "Batería 12V 75Ah", descripcion: "Batería de alto amperaje para vehículos pesados", precio: "150.00", costo: "98.00", categoria: "Baterías" },
    { sku: "SKU-1022", nombre: "Bujía Iridium X4", descripcion: "Set de bujías de iridium premium", precio: "48.00", costo: "31.00", categoria: "Eléctrico" },
    { sku: "SKU-3301", nombre: "Refrigerante Verde (4L)", descripcion: "Refrigerante anticongelante de larga vida", precio: "28.00", costo: "18.00", categoria: "Fluidos" },
    { sku: "SKU-4410", nombre: "Pastillas de Freno Cerámicas", descripcion: "Pastillas de freno de cerámica para uso intensivo", precio: "65.00", costo: "42.00", categoria: "Frenos" },
    { sku: "SKU-5520", nombre: "Llave Combinada Set 12pcs", descripcion: "Juego de llaves combinadas métricas", precio: "35.00", costo: "22.00", categoria: "Herramientas" },
  ];

  for (const product of demoProducts) {
    const [inserted] = await db.insert(productos).values(product).onConflictDoNothing().returning();
    if (inserted) {
      // Add inventory for both branches
      await db.insert(inventario).values([
        { productoId: inserted.id, sucursalId: ciudadId, cantidad: Math.floor(Math.random() * 100) + 10 },
        { productoId: inserted.id, sucursalId: puebloId, cantidad: Math.floor(Math.random() * 20) },
      ]).onConflictDoNothing();
    }
  }

  console.log("  ✅ Productos e inventario de demo creados");
  console.log("🎉 Seed completado!");

  await pgClient.end();
}

seed().catch((err) => {
  console.error("❌ Error en seed:", err);
  process.exit(1);
});
