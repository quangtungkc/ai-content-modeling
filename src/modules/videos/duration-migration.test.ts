import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../prisma/migrations/20260916103000_competitor_video_duration_float/migration.sql", import.meta.url), "utf8");

describe("CompetitorVideo duration Float migration", () => {
  it("CASE 1/2/3 targets nullable floating-point seconds", () => {
    expect(schema).toMatch(/model CompetitorVideo[\s\S]*?duration\s+Float\?/);
    expect(migration).toContain('"duration" REAL');
  });

  it("CASE 1/2 preserves every existing duration value through the row copy", () => {
    expect(migration).toContain('SELECT "id", "competitorId", "externalId", "url", "title", "caption", "thumbnailUrl", "publishedAt", "duration", "firstSeenAt", "lastSeenAt"');
    expect(migration).toContain('FROM "CompetitorVideo"');
  });

  it("CASE 3 permits decimal values and CASE 2 keeps nullable semantics", () => {
    expect(migration).not.toMatch(/duration" REAL NOT NULL/);
  });

  it("CASE 4 preserves all non-duration columns", () => {
    const columns = ["id", "competitorId", "externalId", "url", "title", "caption", "thumbnailUrl", "publishedAt", "firstSeenAt", "lastSeenAt"];
    for (const column of columns) expect(migration).toContain(`"${column}"`);
  });

  it("CASE 5 preserves the Competitor foreign key and VideoMetricSnapshot target name", () => {
    expect(migration).toContain('REFERENCES "Competitor" ("id")');
    expect(migration).toContain('ALTER TABLE "new_CompetitorVideo" RENAME TO "CompetitorVideo"');
  });

  it("CASE 6 preserves the composite uniqueness constraint", () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "CompetitorVideo_competitorId_externalId_key"');
  });
});
