import { createApp, initializeDatabase, provisionAdmin } from "./app.js";
import { PostgresDatabase } from "./postgres.js";

const db = globalThis.gatherDatabase ??= new PostgresDatabase(process.env.DATABASE_URL);
await initializeDatabase(db);
await provisionAdmin(db);

export default createApp({ db });
