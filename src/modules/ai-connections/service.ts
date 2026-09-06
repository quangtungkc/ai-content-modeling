import { db } from "@/lib/db";
import { encryptSecret, maskSecret } from "@/lib/secrets";
import { aiConnectionSchema, type AIConnectionInput } from "./schema";

function present(connection: { id: string; provider: string; kind: string; label: string | null; keyLast4: string; createdAt: Date; updatedAt: Date; revokedAt: Date | null }) {
  return { id: connection.id, provider: connection.provider, kind: connection.kind, label: connection.label, maskedKey: maskSecret(connection.keyLast4), createdAt: connection.createdAt, updatedAt: connection.updatedAt, revokedAt: connection.revokedAt };
}

export async function listAIConnections(userId: string) {
  const connections = await db.aIConnection.findMany({ where: { userId }, orderBy: [{ revokedAt: "asc" }, { provider: "asc" }] });
  return connections.map(present);
}

export async function upsertAIConnection(userId: string, input: unknown) {
  const data: AIConnectionInput = aiConnectionSchema.parse(input);
  const connection = await db.aIConnection.upsert({
    where: { userId_provider_kind: { userId, provider: data.provider, kind: data.kind } },
    create: { userId, provider: data.provider, kind: data.kind, label: data.label, encryptedKey: encryptSecret(data.apiKey), keyLast4: data.apiKey.slice(-4), },
    update: { label: data.label, encryptedKey: encryptSecret(data.apiKey), keyLast4: data.apiKey.slice(-4), revokedAt: null },
  });
  return present(connection);
}

export async function revokeAIConnection(userId: string, id: string) {
  const connection = await db.aIConnection.findFirst({ where: { id, userId, revokedAt: null } });
  if (!connection) throw new Error("AI_CONNECTION_NOT_FOUND");
  return present(await db.aIConnection.update({ where: { id: connection.id }, data: { revokedAt: new Date() } }));
}
