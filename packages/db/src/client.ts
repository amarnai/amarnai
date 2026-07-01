import { PrismaClient } from "@prisma/client";

// Cache the client on globalThis so Next.js dev Fast Refresh reuses one
// instance instead of leaking a new connection pool on every reload.
// In production this is a single, normal instance per process.
const globalForPrisma = globalThis as unknown as { db?: PrismaClient };

export const db = globalForPrisma.db ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.db = db;
}
