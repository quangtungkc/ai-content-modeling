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
// The desktop app is different: Electron already obtains a persisted database
// session, so its dev-mode server must authorize against that real session
// instead of the demo user (otherwise runtime videos/channels look missing).
export function shouldUseDatabaseAuth(nodeEnv = process.env.NODE_ENV, desktopMode = process.env.DESKTOP_MODE) {
  return nodeEnv !== "development" || desktopMode === "1";
}

export const authProvider: AuthProvider =
  shouldUseDatabaseAuth() ? new DatabaseAuthProvider() : new UnconfiguredAuthProvider();

export async function getRequiredSession(): Promise<AuthSession> {
  const session = await authProvider.getSession();
  if (!session) throw new Error("AUTHENTICATION_REQUIRED");
  return session;
}
