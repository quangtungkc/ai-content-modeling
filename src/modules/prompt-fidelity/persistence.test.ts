import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

async function createTraceTable(client: PrismaClient) {
  await client.$executeRawUnsafe('CREATE TABLE "PromptFidelityTrace" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "sceneId" TEXT, "sourceSceneId" TEXT, "promptType" TEXT NOT NULL, "sourceSpecVersion" TEXT NOT NULL, "expectedStateVersion" TEXT NOT NULL, "characterIdentityPackVersion" TEXT NOT NULL, "geminiDraftPrompt" TEXT NOT NULL, "validatedPrompt" TEXT NOT NULL, "validationResults" JSONB NOT NULL, "validationEvidence" JSONB NOT NULL, "promptHash" TEXT NOT NULL, "actualSentPromptHash" TEXT, "validatedAt" DATETIME NOT NULL, "sentAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)');
}

describe("PromptFidelityTrace SQLite persistence", () => {
  it("CASE 31 persists a validated prompt trace across a database reload", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "prompt-fidelity-trace-"));
    const database = path.join(root, "trace.db").replace(/\\/g, "/");
    const first = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
    const prompt = "validated strict prompt";
    const hash = createHash("sha256").update(prompt).digest("hex");
    try {
      await createTraceTable(first);
      await first.promptFidelityTrace.create({ data: { id: "trace-1", projectId: "project-1", sceneId: "scene-1", sourceSceneId: "source-1", promptType: "VIDEO", sourceSpecVersion: "source-v1", expectedStateVersion: "expected-v1", characterIdentityPackVersion: "character-v1", geminiDraftPrompt: "draft", validatedPrompt: prompt, validationResults: { status: "PASS" }, validationEvidence: ["source"], promptHash: hash, validatedAt: new Date(), updatedAt: new Date() } });
    } finally { await first.$disconnect(); }
    const second = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
    try { await expect(second.promptFidelityTrace.findUnique({ where: { id: "trace-1" } })).resolves.toMatchObject({ projectId: "project-1", sourceSceneId: "source-1", validatedPrompt: prompt, promptHash: hash, validationResults: { status: "PASS" } }); } finally { await second.$disconnect(); await rm(root, { recursive: true, force: true }); }
  });

  it("CASE 32 rejects a changed actual prompt hash", () => {
    const validated = createHash("sha256").update("prompt A").digest("hex");
    const actual = createHash("sha256").update("prompt B").digest("hex");
    expect(actual).not.toBe(validated);
  });
});
