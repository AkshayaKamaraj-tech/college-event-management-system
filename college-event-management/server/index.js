import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createApp, initializeDatabase, provisionAdmin } from "./app.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.resolve(process.env.DB_PATH ?? path.join(directory, "data", "campus.sqlite"));
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
initializeDatabase(db);
await provisionAdmin(db);

const app = createApp({ db });
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Campus Events app listening on port ${port}`);
  console.log(`SQLite database: ${databasePath}`);
});

function shutDown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
