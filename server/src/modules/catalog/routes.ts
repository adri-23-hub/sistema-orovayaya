import { FastifyInstance } from "fastify";
import { db } from "../../db/index.js";
import { productos, inventario, sucursales, historialCostos, presentacionesVenta } from "../../db/schema/index.js";
import { eq, like, or, sql, desc, asc, count } from "drizzle-orm";
import { authenticate, requireRole } from "../../shared/middleware/auth.js";
import { z } from "zod";
import { validateBody } from "../../shared/middleware/validation.js";

const presentacionInputSchema = z.object({
  nombre_presentacion: z.string().min(1, "Nombre de presentación requerido"),
  factor_conversion: z.number().int().min(1, "Factor de conversión debe ser >= 1"),
  precio_venta: z.number().positive("Precio de venta debe ser > 0"),
});

const productSchema = z.object({
  sku: z.string().min(1, "SKU es requerido"),
  nombre: z.string().min(1, "Nombre es requerido"),
  descripcion: z.string().optional(),
  precio: z.union([z.string(), z.number()]).transform(String),
  categoria: z.string().optional(),
  costo: z.union([z.string(), z.number()]).optional().transform(v => v != null ? String(v) : undefined),
  marcaId: z.string().uuid("ID de marca inválido").optional().or(z.literal("")),
  proveedorId: z.string().uuid("ID de proveedor inválido").optional().or(z.literal("")),
  presentaciones: z.array(presentacionInputSchema).optional()
});

const updateProductSchema = productSchema.partial();

export async function catalogRoutes(app: FastifyInstance) {

  // GET /v1/products — list all products with pagination and search
  app.get("/v1/products", { preHandler: [authenticate] }, async (request) => {
    const { page = "1", limit = "50", search, categoria } = request.query as {
      page?: string; limit?: string; search?: string; categoria?: string;
    };

    // Tarea 2.5.3: validar page/limit
    const pageNum = Math.max(1, parseInt(page) || 1);
    const lim = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * lim;

    let query = db.select().from(productos).$dynamic();

    // Search filter
    if (search) {
      const s = escapeLike(search);
      query = query.where(
        or(
          like(productos.sku, `%${s}%`),
          like(productos.nombre, `%${s}%`),
        )
      );
    }

    // Category filter
    if (categoria) {
      query = query.where(eq(productos.categoria, categoria));
    }

    const items = await query.orderBy(asc(productos.nombre)).limit(lim).offset(offset);

    // Tarea 2.5.2: contar con los mismos filtros
    let countQuery = db.select({ total: count() }).from(productos).$dynamic();
    if (search) {
      const s = escapeLike(search);
      countQuery = countQuery.where(
        or(
          like(productos.sku, `%${s}%`),
          like(productos.nombre, `%${s}%`),
        )
      );
    }
    if (categoria) {
      countQuery = countQuery.where(eq(productos.categoria, categoria));
    }
    const [{ total }] = await countQuery;

    return {
      items,
      pagination: {
        page: pageNum,
        limit: lim,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / lim),
      },
    };
  });

  // GET /v1/products/categories — list unique categories
  app.get("/v1/products/categories", { preHandler: [authenticate] }, async () => {
    const result = await db
      .selectDistinct({ categoria: productos.categoria })
      .from(productos)
      .where(sql`${productos.categoria} IS NOT NULL`)
      .orderBy(asc(productos.categoria));

    return result.map(r => r.categoria).filter(Boolean);
  });

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

  // GET /v1/products/:id — get single product
  app.get("/v1/products/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!isUuid(id)) {
      return reply.status(422).send({ error: "Identificador inválido" });
    }

    const [product] = await db.select().from(productos).where(eq(productos.id, id)).limit(1);
    if (!product) {
      return reply.status(404).send({ error: "Producto no encontrado" });
    }

    return product;
  });

  // POST /v1/products — create product (admin only)
  // Tarea 2.1: persistir costo, marcaId, proveedorId + historial
  app.post("/v1/products", { preHandler: [requireRole("admin"), validateBody(productSchema)] }, async (request, reply) => {
    const { sku, nombre, descripcion, precio, categoria, costo, marcaId, proveedorId, presentaciones } = request.body as z.infer<typeof productSchema>;

    if (!sku || !nombre || !precio) {
      return reply.status(400).send({ error: "SKU, nombre y precio son requeridos" });
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [product] = await tx.insert(productos).values({
          sku, nombre, descripcion, precio, categoria,
          costo: costo != null ? String(costo) : null,
          marcaId: marcaId || null,
          proveedorId: proveedorId || null,
        }).returning();

        // Create inventory entries for all branches
        const allBranches = await tx.select().from(sucursales);
        for (const branch of allBranches) {
          await tx.insert(inventario).values({
            productoId: product.id,
            sucursalId: branch.id,
            cantidad: 0,
          }).onConflictDoNothing();
        }

        // Tarea 2.3: registrar historial de costos inicial
        if (costo != null) {
          await tx.insert(historialCostos).values({
            productoId: product.id,
            costoNuevo: String(costo),
            precioNuevo: precio,
            motivo: "Creación de producto",
          });
        }

        // Presentaciones opcionales (mismo producto, creación atómica)
        let createdPresentaciones: any[] = [];
        if (presentaciones && presentaciones.length > 0) {
          const rows = presentaciones.map(p => ({
            productoId: product.id,
            nombrePresentacion: p.nombre_presentacion,
            factorConversion: p.factor_conversion,
            precioVenta: p.precio_venta.toFixed(2),
          }));
          createdPresentaciones = await tx.insert(presentacionesVenta).values(rows).returning();
        }

        return { product, presentaciones: createdPresentaciones };
      });

      return reply.status(201).send({ ...result.product, presentaciones: result.presentaciones });
    } catch (err: any) {
      const dbCode = err?.code ?? err?.cause?.code;
      if (dbCode === "23505") {
        return reply.status(409).send({ error: "SKU ya existe o presentación duplicada para este producto" });
      }
      if (dbCode === "23503") {
        return reply.status(400).send({ error: "Marca o proveedor inválido" });
      }
      throw err;
    }
  });

  // PUT /v1/products/:id — update product (admin only)
  // Tarea 2.1: persistir costo, marcaId, proveedorId + historial al cambiar precio/costo
  app.put("/v1/products/:id", { preHandler: [requireRole("admin"), validateBody(updateProductSchema)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isUuid(id)) return reply.status(422).send({ error: "Identificador inválido" });
    const updates = request.body as z.infer<typeof updateProductSchema>;

    const [existing] = await db.select().from(productos).where(eq(productos.id, id)).limit(1);
    if (!existing) return reply.status(404).send({ error: "Producto no encontrado" });

    const [updated] = await db.update(productos)
      .set({
        ...updates,
        costo: updates.costo !== undefined ? String(updates.costo) : existing.costo,
        marcaId: updates.marcaId !== undefined ? updates.marcaId : existing.marcaId,
        proveedorId: updates.proveedorId !== undefined ? updates.proveedorId : existing.proveedorId,
        updatedAt: new Date(),
      })
      .where(eq(productos.id, id))
      .returning();

    if (!updated) {
      return reply.status(404).send({ error: "Producto no encontrado" });
    }

    // Tarea 2.3: registrar historial si cambia precio o costo
    if (updates.precio !== undefined || updates.costo !== undefined) {
      await db.insert(historialCostos).values({
        productoId: id,
        costoAnterior: existing.costo,
        costoNuevo: updates.costo !== undefined ? String(updates.costo) : (existing.costo ?? "0"),
        precioAnterior: existing.precio,
        precioNuevo: updates.precio !== undefined ? updates.precio : existing.precio,
        motivo: "Actualización de producto",
      });
    }

    return updated;
  });

  // DELETE /v1/products/:id — delete product (admin only)
  app.delete("/v1/products/:id", { preHandler: [requireRole("admin")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isUuid(id)) return reply.status(422).send({ error: "Identificador inválido" });

    const [deleted] = await db.delete(productos)
      .where(eq(productos.id, id))
      .returning();

    if (!deleted) {
      return reply.status(404).send({ error: "Producto no encontrado" });
    }

    return { message: "Producto eliminado", id: deleted.id };
  });
}
