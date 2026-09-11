import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";
import { AppError } from "@/lib/errors";

export async function getProviderApiKey(userId: string, providers: string[], kind: string) {
  const connection = await db.aIConnection.findFirst({
    where: { userId, kind, provider: { in: providers }, revokedAt: null },
    orderBy: { updatedAt: "desc" },
  });
  return connection ? decryptSecret(connection.encryptedKey) : null;
}

export async function requireProviderApiKey(userId: string, providers: string[], kind: string, label: string) {
  const apiKey = await getProviderApiKey(userId, providers, kind);
  if (!apiKey) throw new AppError("API_PROVIDER_UNAVAILABLE", `Chưa kết nối ${label} API trong Cài đặt AI.`, 503);
  return apiKey;
}
