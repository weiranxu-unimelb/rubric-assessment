import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalPool = globalThis as typeof globalThis & { rubricPool?: Pool };

export const pool = globalPool.rubricPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
  idleTimeoutMillis: 30_000,
});

if (process.env.NODE_ENV !== "production") globalPool.rubricPool = pool;

export const db = drizzle(pool, { schema });
