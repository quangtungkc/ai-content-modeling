import { describe, expect, it, vi } from "vitest";
import { TROUBLESHOOTING_KNOWLEDGE_BASE_KEY, VERIFIED_TROUBLESHOOTING_RULES } from "./seed";
import { TroubleshootingKnowledgeBaseRepository, type TroubleshootingPersistence } from "./repository";

function memoryPersistence(): TroubleshootingPersistence {
  const documents = new Map<string, unknown>();
  return {
    upsertKnowledgeBase: vi.fn(async () => ({})),
    upsertRule: vi.fn(async ({ rule }) => { documents.set(rule.issueId, rule); }),
    findRules: vi.fn(async () => [...documents.values()].map((document) => ({ document }))),
  };
}

describe("TroubleshootingKnowledgeBaseRepository", () => {
  it("persists and reloads the complete VERIFIED seed set", async () => {
    const persistence = memoryPersistence();
    const ensureStorage = vi.fn(async () => undefined);
    const repository = new TroubleshootingKnowledgeBaseRepository(persistence, ensureStorage);

    await expect(repository.seedVerifiedRules()).resolves.toMatchObject({ key: TROUBLESHOOTING_KNOWLEDGE_BASE_KEY, ruleCount: 33 });
    await expect(repository.loadVerifiedRules()).resolves.toEqual(VERIFIED_TROUBLESHOOTING_RULES.filter(rule => rule.verificationStatus === "VERIFIED"));
    expect(ensureStorage).toHaveBeenCalledTimes(2);
  });
});
