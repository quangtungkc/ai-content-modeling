import { describe, expect, it } from "vitest";

const lifecycle = require("./gemini-conversation-lifecycle.cjs") as {
  extractGeminiConversationId: (value: string) => string | null;
  conversationIdFromUrl: (value: string) => string | null;
  conversationNavigationDisposition: (requestedUrl: string, observedUrl: string) => string;
  conversationUrl: (value: string) => string | null;
  isBareGeminiAppUrl: (value: string) => boolean;
  normalizeConversationBinding: (value: unknown, runId: string) => Record<string, unknown>;
  bindConversationFromUrl: (value: unknown, runId: string, url: string, stage: string, commandId: string, at?: string) => Record<string, unknown>;
  markConversationStep: (value: unknown, runId: string, stage: string, commandId: string, at?: string) => Record<string, unknown>;
  markConversationStale: (value: unknown, runId: string, stage: string, at?: string) => Record<string, unknown>;
  assertConversationReady: (value: unknown, runId: string, currentUrl: string) => Record<string, unknown>;
};

describe("one-run one-Gemini-conversation lifecycle", () => {
  const runId = "run-1";
  const url = "https://gemini.google.com/app/conversation-1";

  it("extracts conversation IDs only from supported Gemini conversation URLs", () => {
    expect(lifecycle.conversationIdFromUrl(url)).toBe("conversation-1");
    expect(lifecycle.conversationIdFromUrl("https://gemini.google.com/app")).toBeNull();
    expect(lifecycle.conversationIdFromUrl("https://example.test/app/conversation-1")).toBeNull();
    expect(lifecycle.extractGeminiConversationId("https://gemini.google.com/app/conversation-1/")).toBe("conversation-1");
    expect(lifecycle.extractGeminiConversationId("https://gemini.google.com/app/conversation-1?hl=vi#reply")).toBe("conversation-1");
    expect(lifecycle.extractGeminiConversationId("https://gemini.google.com/app/conversation-1/extra")).toBeNull();
  });

  it("binds a legacy run once and preserves the owner", () => {
    const bound = lifecycle.bindConversationFromUrl({}, runId, url, "MODELING_IDEA", "command-1", "2026-09-17T00:00:00.000Z");
    expect(bound).toMatchObject({ geminiConversationId: "conversation-1", geminiConversationUrl: url, geminiConversationOwnerRunId: runId, geminiConversationState: "ACTIVE", lastGeminiStage: "MODELING_IDEA", lastGeminiCommandId: "command-1" });
    expect(() => lifecycle.bindConversationFromUrl(bound, runId, "https://gemini.google.com/app/conversation-2", "PROJECT", "command-2")).toThrow("GEMINI_CONVERSATION_REBIND_FORBIDDEN");
  });

  it("rejects a binding owned by another run", () => {
    expect(() => lifecycle.normalizeConversationBinding({ geminiConversationId: "conversation-1", geminiConversationUrl: url, geminiConversationOwnerRunId: "run-2" }, runId)).toThrow("GEMINI_CONVERSATION_OWNER_MISMATCH");
  });

  it("requires the same canonical conversation identity and active state before a command", () => {
    const bound = lifecycle.bindConversationFromUrl({}, runId, url, "PROJECT", "command-1");
    expect(lifecycle.assertConversationReady(bound, runId, url)).toMatchObject({ geminiConversationState: "ACTIVE" });
    expect(lifecycle.assertConversationReady(bound, runId, "https://gemini.google.com/app/conversation-1/?hl=vi#reply")).toMatchObject({ geminiConversationId: "conversation-1" });
    expect(() => lifecycle.assertConversationReady(bound, runId, "https://gemini.google.com/app/other")).toThrow("GEMINI_CONVERSATION_URL_MISMATCH");
    expect(() => lifecycle.assertConversationReady(bound, runId, "https://gemini.google.com/app")).toThrow("GEMINI_CONVERSATION_URL_MISMATCH");
    expect(() => lifecycle.assertConversationReady(bound, runId, "https://example.test/app/conversation-1")).toThrow("GEMINI_CONVERSATION_URL_MISMATCH");
    expect(() => lifecycle.assertConversationReady(bound, runId, "not-a-url")).toThrow("GEMINI_CONVERSATION_URL_MISMATCH");
  });

  it("classifies a generic Gemini app URL as retryable, never as the bound conversation", () => {
    expect(lifecycle.conversationNavigationDisposition(url, "https://gemini.google.com/app")).toBe("RETRY");
    expect(lifecycle.conversationNavigationDisposition(url, url)).toBe("MATCH");
    expect(lifecycle.conversationNavigationDisposition(url, "https://accounts.google.com/signin")).toBe("AUTH_REQUIRED");
    expect(lifecycle.conversationNavigationDisposition(url, "https://gemini.google.com/app/other")).toBe("MISMATCH");
  });

  it("recognizes the bare app route as the stale-conversation redirect target", () => {
    expect(lifecycle.isBareGeminiAppUrl("https://gemini.google.com/app")).toBe(true);
    expect(lifecycle.isBareGeminiAppUrl("https://gemini.google.com/app/?hl=vi")).toBe(true);
    expect(lifecycle.isBareGeminiAppUrl(url)).toBe(false);
    expect(lifecycle.isBareGeminiAppUrl("https://accounts.google.com/signin")).toBe(false);
  });

  it("marks the persisted binding stale without inventing a replacement", () => {
    const bound = lifecycle.bindConversationFromUrl({}, runId, url, "PROJECT", "command-1");
    const stale = lifecycle.markConversationStale(bound, runId, "CONTENT_PROJECT", "2026-09-21T00:00:00.000Z");
    expect(stale).toMatchObject({
      geminiConversationId: "conversation-1",
      geminiConversationUrl: url,
      geminiConversationState: "DELETED",
      geminiConversationDeletedAt: "2026-09-21T00:00:00.000Z",
      geminiConversationOwnerRunId: runId,
      lastGeminiStage: "CONTENT_PROJECT",
    });
    expect(() => lifecycle.assertConversationReady(stale, runId, url)).toThrow("GEMINI_CONVERSATION_NOT_ACTIVE");
  });

  it("records terminal step metadata without changing conversation identity", () => {
    const bound = lifecycle.bindConversationFromUrl({}, runId, url, "PROJECT", "command-1");
    const marked = lifecycle.markConversationStep(bound, runId, "ASSETS", "command-2", "2026-09-17T00:01:00.000Z");
    expect(marked).toMatchObject({ geminiConversationId: "conversation-1", geminiConversationUrl: url, geminiConversationOwnerRunId: runId, lastGeminiStage: "ASSETS", lastGeminiCommandId: "command-2" });
  });

  it("keeps harmless URL decoration out of identity comparison without rewriting raw URL", () => {
    const decorated = "https://gemini.google.com/app/conversation-1/?hl=vi#reply";
    expect(lifecycle.conversationUrl(decorated)).toBe(decorated);
    const bound = lifecycle.bindConversationFromUrl({}, runId, url, "PROJECT", "command-1");
    expect(lifecycle.assertConversationReady(bound, runId, decorated)).toMatchObject({ geminiConversationId: "conversation-1" });
  });
});
