import postgres from "postgres";

async function main() {
  const sql = postgres("postgres://orvayaya:orvayaya_secret@localhost:5433/postgres");
  try {
    // Kill existing connections to the test db before dropping
    await sql`SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = 'orvayaya_test' AND pid <> pg_backend_pid();`;
    await sql`DROP DATABASE IF EXISTS orvayaya_test;`;
    await sql`CREATE DATABASE orvayaya_test;`;
    console.log("Database orvayaya_test recreated from scratch.");
  } catch (err) {
    console.error("Error recreating db:", err);
  } finally {
    await sql.end();
  }
}
main();
