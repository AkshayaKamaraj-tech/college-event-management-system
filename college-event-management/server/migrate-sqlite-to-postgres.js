import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { initializeDatabase } from "./app.js";
import { PostgresDatabase } from "./postgres.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const sqlitePath = path.resolve(process.env.DB_PATH ?? path.join(directory, "data", "campus.sqlite"));
const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
const postgres = new PostgresDatabase(process.env.DATABASE_URL);
const tables = ["users", "events", "registrations", "event_waitlist", "payments", "certificates"];

try {
  await initializeDatabase(postgres);
  for (const table of tables) {
    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    if (!rows.length) {
      console.log(`${table}: 0 rows`);
      continue;
    }
    const columns = Object.keys(rows[0]);
    const columnSql = columns.map((column) => `"${column}"`).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const insert = postgres.prepare(`INSERT INTO ${table} (${columnSql}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`);
    let copied = 0;
    for (const row of rows) {
      const result = await insert.run(...columns.map((column) => row[column]));
      copied += result.changes;
    }
    console.log(`${table}: copied ${copied} of ${rows.length} rows`);
  }
} finally {
  sqlite.close();
  await postgres.close();
}
