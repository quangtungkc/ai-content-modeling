import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const dbMock = vi.hoisted(() => ({
  $executeRawUnsafe: vi.fn(async () => undefined),
  contentProject: { findFirst: vi.fn() },
  promptFidelityTrace: { findUnique: vi.fn(), update: vi.fn() },
  troubleshootingIncident: { findFirst: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/modules/troubleshooting/storage", () => ({ ensureTroubleshootingStorage: vi.fn(async () => undefined) }));

import { hashPrompt, markPromptSent, verifyPersistedPromptByScene, verifyPersistedPromptForScene } from "./service";

describe("Prompt Fidelity runtime hash enforcement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sanitizes provider-only URLs and named style triggers before sealing prompts", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/modules/prompt-fidelity/service.ts"), "utf8");
    expect(source).toContain("function sanitizeConsumerStyleReferences");
    expect(source).toContain("function sanitizeProviderPrompt");
    expect(source).toContain("source URL omitted; use the authoritative scene evidence above");
    expect(source).toContain("const providerDraftPrompt = sanitizeProviderPrompt(input.draftPrompt);");
  });

  it("CASE 33 verifies a persisted prompt belongs to the current project/scene/type", async () => {
    const prompt = "validated prompt";
    const promptHash = hashPrompt(prompt);
    dbMock.promptFidelityTrace.findUnique.mockResolvedValue({ id: "trace-1", projectId: "project-1", sceneId: "scene-1", promptType: "VIDEO", promptHash, validatedPrompt: prompt });
    await expect(verifyPersistedPromptForScene({ promptId: "trace-1", projectId: "project-1", sceneId: "scene-1", promptType: "VIDEO", prompt, promptHash })).resolves.toMatchObject({ id: "trace-1" });
  });

  it("CASE 34 records ACTUAL_SENT_PROMPT_HASH only when it equals the validated hash", async () => {
    const prompt = "validated prompt";
    const promptHash = hashPrompt(prompt);
    dbMock.promptFidelityTrace.findUnique.mockResolvedValue({ id: "trace-1", promptHash });
    await expect(markPromptSent("trace-1", prompt)).resolves.toBe(promptHash);
    expect(dbMock.promptFidelityTrace.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "trace-1" }, data: expect.objectContaining({ actualSentPromptHash: promptHash }) }));
  });

  it("CASE 35 blocks a one-character mutation after validation", async () => {
    const validatedPrompt = "validated prompt";
    dbMock.promptFidelityTrace.findUnique.mockResolvedValue({ id: "trace-1", projectId: "project-1", sceneId: "scene-1", promptType: "VIDEO", promptHash: hashPrompt(validatedPrompt), validatedPrompt });
    await expect(verifyPersistedPromptForScene({ promptId: "trace-1", projectId: "project-1", sceneId: "scene-1", promptType: "VIDEO", prompt: "validated prompT" })).rejects.toMatchObject({ code: "PROMPT_MUTATED_AFTER_VALIDATION" });
  });
  it("CASE 36 keeps a background trace bound to null sceneId", async () => {
    const prompt = "validated background prompt";
    dbMock.contentProject.findFirst.mockResolvedValue({ id: "project-1", scenes: [{ id: "scene-1" }] });
    dbMock.promptFidelityTrace.findUnique.mockResolvedValue({ id: "trace-background", projectId: "project-1", sceneId: null, promptType: "IMAGE", promptHash: hashPrompt(prompt), validatedPrompt: prompt });
    await expect(verifyPersistedPromptByScene({ promptId: "trace-background", projectId: "project-1", userId: "user-1", promptType: "IMAGE", prompt })).resolves.toMatchObject({ id: "trace-background" });
  });
});
