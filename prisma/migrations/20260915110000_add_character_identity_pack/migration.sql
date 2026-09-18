CREATE TABLE "CharacterIdentityPack" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "channelId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "styleType" TEXT NOT NULL DEFAULT 'other',
  "lockedTraits" JSONB NOT NULL DEFAULT '{}',
  "allowedVariations" JSONB NOT NULL DEFAULT '[]',
  "negativeRules" JSONB NOT NULL DEFAULT '[]',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CharacterIdentityPack_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CharacterIdentityReference" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "packId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "referenceId" TEXT,
  "viewRole" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "name" TEXT,
  "mimeType" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CharacterIdentityReference_packId_fkey" FOREIGN KEY ("packId") REFERENCES "CharacterIdentityPack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CharacterIdentityPack_channelId_key" ON "CharacterIdentityPack"("channelId");
CREATE UNIQUE INDEX "CharacterIdentityReference_assetId_key" ON "CharacterIdentityReference"("assetId");
CREATE INDEX "CharacterIdentityPack_channelId_active_idx" ON "CharacterIdentityPack"("channelId", "active");
CREATE INDEX "CharacterIdentityReference_packId_active_viewRole_idx" ON "CharacterIdentityReference"("packId", "active", "viewRole");
