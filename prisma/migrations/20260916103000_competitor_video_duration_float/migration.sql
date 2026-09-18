-- SQLite changes a column type by rebuilding the table. The full row copy
-- preserves existing values, nullable rows, and the foreign-key target name.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_CompetitorVideo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "competitorId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "caption" TEXT,
    "thumbnailUrl" TEXT,
    "publishedAt" DATETIME,
    "duration" REAL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompetitorVideo_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_CompetitorVideo" ("id", "competitorId", "externalId", "url", "title", "caption", "thumbnailUrl", "publishedAt", "duration", "firstSeenAt", "lastSeenAt")
SELECT "id", "competitorId", "externalId", "url", "title", "caption", "thumbnailUrl", "publishedAt", "duration", "firstSeenAt", "lastSeenAt"
FROM "CompetitorVideo";

DROP TABLE "CompetitorVideo";
ALTER TABLE "new_CompetitorVideo" RENAME TO "CompetitorVideo";
CREATE UNIQUE INDEX "CompetitorVideo_competitorId_externalId_key" ON "CompetitorVideo"("competitorId", "externalId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
