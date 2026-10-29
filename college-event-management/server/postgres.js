import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";

const { Pool } = pg;

function postgresPlaceholders(sql) {
  let index = 0;
  return sql
    .replace(/\bLIKE\b/g, "ILIKE")
    .replace(/CURRENT_TIMESTAMP/g, "CURRENT_TIMESTAMP::TEXT")
    .replace(/\?/g, () => `$${++index}`);
}

export class PostgresDatabase {
  constructor(connectionString) {
    if (!connectionString) throw new Error("DATABASE_URL must be configured.");
    this.isPostgres = true;
    this.pool = new Pool({ connectionString, max: 5 });
    this.transactions = new AsyncLocalStorage();
    pg.types.setTypeParser(20, Number);
  }

  query(sql, values = []) {
    const client = this.transactions.getStore() ?? this.pool;
    return client.query(postgresPlaceholders(sql), values);
  }

  exec(sql) {
    return this.query(sql);
  }

  prepare(sql) {
    return {
      get: (...values) => this.query(sql, values).then((result) => result.rows[0]),
      all: (...values) => this.query(sql, values).then((result) => result.rows),
      run: (...values) => this.query(sql, values).then((result) => ({ changes: result.rowCount })),
    };
  }

  transaction(callback) {
    const execute = async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const result = await this.transactions.run(client, callback);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
    execute.immediate = execute;
    return execute;
  }

  close() {
    return this.pool.end();
  }
}
