import { db } from "../db/index.js";
import { eq, like, asc } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

export class GenericCrudService<T extends PgTable> {
  constructor(
    private table: T,
    private nameColumn: AnyPgColumn,
    private idColumn: AnyPgColumn,
    private defaultOrderColumn: AnyPgColumn = nameColumn
  ) {}

  async getAll(search?: string) {
    let query = db.select().from(this.table as any).$dynamic();
    
    if (search) {
      query = query.where(like(this.nameColumn, `%${search}%`));
    }
    
    return await query.orderBy(asc(this.defaultOrderColumn));
  }

  async getById(id: string) {
    const [row] = await db.select().from(this.table as any).where(eq(this.idColumn, id)).limit(1);
    return row || null;
  }

  async create(data: any) {
    const [row] = await db.insert(this.table as any).values(data).returning();
    return row;
  }

  async update(id: string, data: any) {
    const [row] = await db
      .update(this.table as any)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(this.idColumn, id))
      .returning();
    return row || null;
  }

  async delete(id: string) {
    const [row] = await db.delete(this.table as any).where(eq(this.idColumn, id)).returning();
    return row || null;
  }
}
