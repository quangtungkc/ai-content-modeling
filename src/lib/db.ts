import { PrismaClient } from "@prisma/client";
import { resolveDesktopDatabaseUrl } from "./env";

const resolvedDatabaseUrl = resolveDesktopDatabaseUrl();
if (resolvedDatabaseUrl) process.env.DATABASE_URL = resolvedDatabaseUrl;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
