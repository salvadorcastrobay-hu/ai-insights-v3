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
    max: 5,
    idle_timeout: 20,
    connect_timeout: 8,
    // Recicla conexiones cada 5 min: evita sockets zombies tras restarts de
    // la DB / failovers del pooler (el pool cacheado quedaba colgado).
    max_lifetime: 300,
    prepare: false, // transaction-pool mode incompatible with prepared statements
    // Evita la query inicial de tipos (puede colgarse con transaction pooling).
    // Solo usamos tipos built-in (text/bool/numeric/timestamptz/jsonb).
    fetch_types: false,
  });

  globalForPg.__humand_pg = sql;
  return sql;
}
