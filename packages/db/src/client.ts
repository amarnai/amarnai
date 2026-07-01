import { PrismaClient } from "@prisma/client";

// Bound the connection pool size explicitly. Container CPU counts (e.g. on
// Railway) are unreliable, so Prisma's automatic sizing can over-allocate.
// When DB_CONNECTION_LIMIT is set, pin the pool size via the datasource URL;
// otherwise fall back to Prisma's default so dev/self-host stay unchanged.
function resolveDatasourceUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  const limit = process.env.DB_CONNECTION_LIMIT;
  if (!url || !limit) return undefined;
  const parsed = new URL(url);
  parsed.searchParams.set("connection_limit", limit);
  return parsed.toString();
}

function createClient(): PrismaClient {
  const datasourceUrl = resolveDatasourceUrl();
  return datasourceUrl ? new PrismaClient({ datasourceUrl }) : new PrismaClient();
}

// Cache the client on globalThis so Next.js dev Fast Refresh reuses one
// instance instead of leaking a new connection pool on every reload.
// In production this is a single, normal instance per process.
const globalForPrisma = globalThis as unknown as { db?: PrismaClient };

export const db = globalForPrisma.db ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.db = db;
}
