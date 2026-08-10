import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

const sql = postgres(process.env.DATABASE_URL || "postgres://orvayaya:orvayaya_secret@localhost:5433/orvayaya");

async function main() {
  try {
    await sql`CREATE DATABASE orvayaya_test;`;
    console.log("Database orvayaya_test created.");
  } catch (error) {
    if (error.message.includes("already exists")) {
      console.log("Database orvayaya_test already exists.");
    } else {
      console.error("Error creating test database:", error);
    }
  } finally {
    await sql.end();
  }
}

main();
