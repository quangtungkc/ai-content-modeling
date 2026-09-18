import { db } from "@/lib/db";

let storagePromise: Promise<void> | null = null;

export function ensureCharacterIdentityStorage() {
  if (!storagePromise) {
    storagePromise = (async () => {
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CharacterIdentityPack" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "channelId" TEXT NOT NULL UNIQUE,
        "name" TEXT NOT NULL,
        "styleType" TEXT NOT NULL DEFAULT 'other',
        "lockedTraits" JSONB NOT NULL DEFAULT '{}',
        "allowedVariations" JSONB NOT NULL DEFAULT '[]',
        "negativeRules" JSONB NOT NULL DEFAULT '[]',
        "active" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CharacterIdentityPack_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`);
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CharacterIdentityReference" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "packId" TEXT NOT NULL,
        "assetId" TEXT NOT NULL UNIQUE,
        "storageKey" TEXT NOT NULL,
        "referenceId" TEXT,
        "viewRole" TEXT NOT NULL,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "name" TEXT,
        "mimeType" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CharacterIdentityReference_packId_fkey" FOREIGN KEY ("packId") REFERENCES "CharacterIdentityPack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`);
      await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CharacterIdentityPack_channelId_active_idx" ON "CharacterIdentityPack"("channelId", "active")`);
      await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CharacterIdentityReference_packId_active_viewRole_idx" ON "CharacterIdentityReference"("packId", "active", "viewRole")`);
    })().catch((error) => {
      storagePromise = null;
      throw error;
    });
  }
  return storagePromise;
}
