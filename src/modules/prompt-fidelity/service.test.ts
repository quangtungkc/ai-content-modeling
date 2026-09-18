import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  $executeRawUnsafe: vi.fn(async () => undefined),
  promptFidelityTrace: { findUnique: vi.fn(), update: vi.fn() },
  troubleshootingIncident: { findFirst: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/modules/troubleshooting/storage", () => ({ ensureTroubleshootingStorage: vi.fn(async () => undefined) }));

import { hashPrompt, markPromptSent, verifyPersistedPromptForScene } from "./service";

describe("Prompt Fidelity runtime hash enforcement", () => {
  beforeEach(() => vi.clearAllMocks());

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
});
