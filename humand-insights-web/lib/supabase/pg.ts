import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

// Singleton across serverless invocations in the same warm container.
const globalForPg = globalThis as unknown as { __humand_pg?: Sql };

export function getPg(): Sql {
  if (globalForPg.__humand_pg) return globalForPg.__humand_pg;

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error("Missing SUPABASE_DB_URL (Supabase pooler connection string).");
  }

  const sql = postgres(url, {
    ssl: "require",
    max: 3, // small pool — serverless invocations are short-lived
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // pgbouncer transaction-pool mode incompatible with prepared statements
  });

  globalForPg.__humand_pg = sql;
  return sql;
}
