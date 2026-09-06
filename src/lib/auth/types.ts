export type AuthSession = { userId: string; email?: string };

export interface AuthProvider {
  getSession(): Promise<AuthSession | null>;
}
