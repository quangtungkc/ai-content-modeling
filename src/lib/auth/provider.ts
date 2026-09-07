import type { AuthProvider, AuthSession } from "./types";
import { getEnv } from "@/lib/env";
import { getDatabaseSession } from "./session";

/** Replace with the selected session provider without changing application services. */
export class UnconfiguredAuthProvider implements AuthProvider {
  async getSession(): Promise<AuthSession | null> {
    const env = getEnv();
    if (env.NODE_ENV === "production") return null;
    return { userId: "demo-user", email: "demo@example.com" };
  }
}

export class DatabaseAuthProvider implements AuthProvider {
  async getSession(): Promise<AuthSession | null> { return getDatabaseSession(); }
}

// Local development opens the seeded workspace without requiring browser login.
// Production always uses persisted database sessions.
export const authProvider: AuthProvider =
  process.env.NODE_ENV === "development"
    ? new UnconfiguredAuthProvider()
    : new DatabaseAuthProvider();

export async function getRequiredSession(): Promise<AuthSession> {
  const session = await authProvider.getSession();
  if (!session) throw new Error("AUTHENTICATION_REQUIRED");
  return session;
}
