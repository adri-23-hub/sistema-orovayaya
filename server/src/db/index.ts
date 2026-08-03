import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import dotenv from "dotenv";
import * as schema from "./schema/index.js";

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set in environment variables");
}

// Create postgres.js client
const client = postgres(connectionString);

// Create drizzle instance with all schemas
export const db = drizzle(client, { schema });

// Export the client for cleanup
export const pgClient = client;
