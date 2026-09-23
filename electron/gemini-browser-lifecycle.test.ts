import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GeminiCommandLifecycle, hashText, normalizePromptIdentity, promptIdentityHash, createGeminiConversationResetError, evaluateGeminiSubmission, redactNetworkUrl, normalizeNetworkInitiator, normalizeDocumentNavigationRequest, extractGeminiJsonCandidate, isGeminiGenerationRequest, findAttributedGeminiGenerationRequest, shouldRetryGeminiSend, authorizeGeminiSendRetry, isGeminiTargetReady, deriveLatencyBuckets, summarizeRendererHeartbeat, isResponseComplete, isStructuredResponseComplete, describeResponseCompletion, canRunFormatRetry, isGenerationTerminal, assertParentTerminal, normalizeGeminiResponseSnapshot, buildGeminiBindingDiagnostic, buildGeminiResponseContentDiagnostic, extractFinalResponseContent } = require("./gemini-browser-lifecycle.cjs") as {
  GeminiCommandLifecycle: typeof import("./gemini-browser-lifecycle.cjs").GeminiCommandLifecycle;
  hashText: typeof import("./gemini-browser-lifecycle.cjs").hashText;
  normalizePromptIdentity: typeof import("./gemini-browser-lifecycle.cjs").normalizePromptIdentity;
  promptIdentityHash: typeof import("./gemini-browser-lifecycle.cjs").promptIdentityHash;
  createGeminiConversationResetError: typeof import("./gemini-browser-lifecycle.cjs").createGeminiConversationResetError;
  evaluateGeminiSubmission: typeof import("./gemini-browser-lifecycle.cjs").evaluateGeminiSubmission;
  isResponseComplete: typeof import("./gemini-browser-lifecycle.cjs").isResponseComplete;
  isStructuredResponseComplete: typeof import("./gemini-browser-lifecycle.cjs").isStructuredResponseComplete;
  canRunFormatRetry: typeof import("./gemini-browser-lifecycle.cjs").canRunFormatRetry;
  isGenerationTerminal: typeof import("./gemini-browser-lifecycle.cjs").isGenerationTerminal;
  assertParentTerminal: typeof import("./gemini-browser-lifecycle.cjs").assertParentTerminal;
  normalizeGeminiResponseSnapshot: typeof import("./gemini-browser-lifecycle.cjs").normalizeGeminiResponseSnapshot;
  buildGeminiBindingDiagnostic: typeof import("./gemini-browser-lifecycle.cjs").buildGeminiBindingDiagnostic;
  buildGeminiResponseContentDiagnostic: typeof import("./gemini-browser-lifecycle.cjs").buildGeminiResponseContentDiagnostic;
  extractFinalResponseContent: typeof import("./gemini-browser-lifecycle.cjs").extractFinalResponseContent;
  deriveLatencyBuckets: typeof import("./gemini-browser-lifecycle.cjs").deriveLatencyBuckets;
  summarizeRendererHeartbeat: typeof import("./gemini-browser-lifecycle.cjs").summarizeRendererHeartbeat;
  redactNetworkUrl: typeof import("./gemini-browser-lifecycle.cjs").redactNetworkUrl;
  normalizeNetworkInitiator: typeof import("./gemini-browser-lifecycle.cjs").normalizeNetworkInitiator;
  normalizeDocumentNavigationRequest: typeof import("./gemini-browser-lifecycle.cjs").normalizeDocumentNavigationRequest;
  extractGeminiJsonCandidate: typeof import("./gemini-browser-lifecycle.cjs").extractGeminiJsonCandidate;
  isGeminiGenerationRequest: typeof import("./gemini-browser-lifecycle.cjs").isGeminiGenerationRequest;
  findAttributedGeminiGenerationRequest: typeof import("./gemini-browser-lifecycle.cjs").findAttributedGeminiGenerationRequest;
  shouldRetryGeminiSend: typeof import("./gemini-browser-lifecycle.cjs").shouldRetryGeminiSend;
  authorizeGeminiSendRetry: typeof import("./gemini-browser-lifecycle.cjs").authorizeGeminiSendRetry;
  isGeminiTargetReady: typeof import("./gemini-browser-lifecycle.cjs").isGeminiTargetReady;
  describeResponseCompletion: typeof import("./gemini-browser-lifecycle.cjs").describeResponseCompletion;
};

const candidate = (candidateId: string, parentTurnId: string, overrides: Record<string, unknown> = {}) => ({
  candidateId,
  parentTurnId,
  parentContainerId: "conversation-1",
  domPath: candidateId,
  tag: "message-content",
  role: "model",
  visible: true,
  attached: true,
  detached: false,
  ariaHidden: false,
  zeroSize: false,
  boundingBox: { x: 10, y: 10, width: 600, height: 200 },
  text: '{"storyboard":[]}',
  textLength: 17,
  textHash: "hash",
  orderIndex: 1,
  isTurnRoot: false,
  ancestorMetadata: [{ tag: "model-response", role: "model" }],
  turnVisible: true,
  turnAttached: true,
  turnAriaHidden: false,
  turnZeroSize: false,
  insideComposer: false,
  insidePreviousAssistantTurn: false,
  existedBeforeSubmit: false,
  appearedAfterSubmit: true,
  stopButtonPresent: false,
  streamingIndicatorPresent: false,
  ...overrides,
});

const conversationUrl = "https://gemini.google.com/app/conversation-1";
const userTurn = (text: string, turnId: string) => ({ turnId, candidateId: turnId, normalizedTextHash: promptIdentityHash(text), textHash: hashText(text), textLength: text.length, visible: true, attached: true });
const baselinePrompt = "old prompt";
const submissionPrompt = "prompt hiện tại";
const baselineUserTurns = [userTurn(baselinePrompt, "user-old")];
const strictSubmissionSnapshot = (prompt = submissionPrompt) => ({
  conversationUrl,
  userTurnCount: 2,
  assistantTurnCount: 1,
  userTurns: [...baselineUserTurns, userTurn(prompt, "user-new")],
  composerReady: true,
  userMessagePresent: true,
  stopButtonPresent: false,
  streamingIndicatorPresent: false,
  newResponseCount: 0,
});

describe("ISSUE-002 strict Gemini submission contract", () => {
  const expected = { expectedConversationUrl: conversationUrl, baselineUserTurnCount: 1, baselineAssistantTurnCount: 1, baselineUserTurnHashes: baselineUserTurns.map((turn) => turn.normalizedTextHash), promptIdentityHash: promptIdentityHash(submissionPrompt) };

  it("A/E rejects composer clear and generic /app without a new user turn", () => {
    expect(evaluateGeminiSubmission({ conversationUrl: "https://gemini.google.com/app", userTurnCount: 1, assistantTurnCount: 1, userTurns: baselineUserTurns, composerReady: true }, expected)).toMatchObject({ conversationOwnershipConfirmed: false, newUserTurnConfirmed: false, submissionConfirmed: false, userTurnDelta: 0 });
  });

  it("B/D confirms only one exact new user turn in the intended conversation", () => {
    expect(evaluateGeminiSubmission(strictSubmissionSnapshot(), expected)).toMatchObject({ conversationOwnershipConfirmed: true, newUserTurnConfirmed: true, submissionConfirmed: true, userTurnDelta: 1, exactPromptDelta: 1 });
  });

  it("allows a new conversation to remain on /app until Gemini assigns its conversation id", () => {
    expect(evaluateGeminiSubmission({ ...strictSubmissionSnapshot(), conversationUrl: "https://gemini.google.com/app" }, { ...expected, allowNewConversation: true, expectedConversationUrl: "https://gemini.google.com/app", expectedConversationId: null })).toMatchObject({ conversationOwnershipConfirmed: true, newUserTurnConfirmed: true, submissionConfirmed: true });
  });

  it("F does not count an old matching prompt as the current send", () => {
    expect(evaluateGeminiSubmission({ ...strictSubmissionSnapshot(), userTurnCount: 1, userTurns: [userTurn(submissionPrompt, "user-old-matching")] }, { ...expected, baselineUserTurnCount: 1, baselineUserTurnHashes: [promptIdentityHash(submissionPrompt)] })).toMatchObject({ newUserTurnConfirmed: false, submissionConfirmed: false, userTurnDelta: 0, exactPromptDelta: 0 });
  });

  it("G rejects a new user turn whose normalized text is not the current prompt", () => {
    expect(evaluateGeminiSubmission(strictSubmissionSnapshot("different prompt"), expected)).toMatchObject({ conversationOwnershipConfirmed: true, newUserTurnConfirmed: false, submissionConfirmed: false, userTurnDelta: 1, exactPromptDelta: 0 });
  });

  it("normalizes prompt identity deterministically before hashing", () => {
    expect(normalizePromptIdentity("  prompt  \n hiện tại ")).toBe("prompt hiện tại");
    expect(promptIdentityHash(" prompt  hiện tại ")).toBe(promptIdentityHash("prompt hiện tại"));
  });
});

describe("ISSUE-003 structured reset failure", () => {
  it("preserves reset code and non-secret evidence after recovery is exhausted", () => {
    const error = createGeminiConversationResetError({
      commandId: "command-1",
      expectedConversationUrl: conversationUrl,
      actualUrl: "https://gemini.google.com/app",
      recoveryAttempt: 1,
      recoveryBudget: 1,
      userTurnDelta: 0,
      assistantTurnDelta: 0,
      generationRequestObserved: true,
      composerCleared: true,
      authenticatedState: null,
      cookieRotationObserved: true,
    });
    expect(error.code).toBe("GEMINI_CONVERSATION_RESET_DURING_SEND");
    expect(error.context).toMatchObject({ recoveryAttempt: 1, recoveryBudget: 1, userTurnDelta: 0, assistantTurnDelta: 0, generationRequestObserved: true, composerCleared: true, cookieRotationObserved: true });
    expect(error.message).toContain("GEMINI_CONVERSATION_RESET_DURING_SEND");
    expect(error.message).not.toContain("password");
  });

  it("persists the structured primary error on the terminal command", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt" });
    const error = createGeminiConversationResetError({ expectedConversationUrl: conversationUrl, actualUrl: "https://gemini.google.com/app", recoveryAttempt: 1, recoveryBudget: 1 });
    command.markFailed(error);
    expect(command.snapshot()).toMatchObject({ state: "FAILED", primaryErrorCode: "GEMINI_CONVERSATION_RESET_DURING_SEND", primaryErrorContext: { recoveryAttempt: 1, recoveryBudget: 1 } });
    expect(command.snapshot().error).toContain("GEMINI_CONVERSATION_RESET_DURING_SEND");
  });
});

const contentCandidate = (candidateId: string, text: string, overrides: Record<string, unknown> = {}) => ({
  ...candidate(candidateId, "turn-final", { text, textLength: text.length, textHash: hashText(text) }),
  isMessageContent: true,
  selector: "message-content",
  contentDepth: 2,
  ...overrides,
});

const finalContentSnapshot = (overrides: Record<string, unknown> = {}) => normalizeGeminiResponseSnapshot({
  candidates: [candidate("root-final", "turn-final", {
    isTurnRoot: true,
    text: "Initiating the Analysis\nGemini đã nói\n{\"storyboard\":[]}",
    contentExtractionAvailable: true,
    statusText: "Initiating the Analysis\nGemini đã nói",
    contentCandidates: [
      contentCandidate("status", "Initiating the Analysis", { statusLike: true, isMessageContent: false }),
      contentCandidate("accessibility", "Gemini đã nói", { accessibilityChrome: true, isMessageContent: false }),
      contentCandidate("body", "{\"storyboard\":[]}", { hasMarkdownClass: true }),
    ],
    ...overrides,
  })],
  composerReady: true,
}, null);

describe("Gemini browser command lifecycle", () => {
  it("production malformed suffix: safely rejoins one trailing top-level property", () => {
    const raw = '{"schemaVersion":"1.0","sourceModelingSpec":{"scenes":[]},"storyboard":[]}],"safetyReview":{"isSafe":true,"notes":["ok"]}}';
    expect(extractGeminiJsonCandidate(raw)).toEqual({ schemaVersion: "1.0", sourceModelingSpec: { scenes: [] }, storyboard: [], safetyReview: { isSafe: true, notes: ["ok"] } });
  });

  it("JSON extraction preserves valid objects and rejects non-canonical trailing structures", () => {
    expect(extractGeminiJsonCandidate('{"schemaVersion":"1.0","storyboard":[]}')).toEqual({ schemaVersion: "1.0", storyboard: [] });
    expect(() => extractGeminiJsonCandidate('{"schemaVersion":"1.0","storyboard":[]} trailing {"unsafe":true}')).toThrow();
    expect(() => extractGeminiJsonCandidate('{"schemaVersion":"1.0","safetyReview":{}}],"safetyReview":{"isSafe":true}}')).toThrow();
  });

  it("INCIDENT 1J CASE 3/4 redacts navigation initiator URLs and excludes request secrets", () => {
    const initiator = normalizeNetworkInitiator({ type: "script", url: "https://gemini.google.com/app?secret=hidden", lineNumber: 12, columnNumber: 4, stack: { callFrames: [{ functionName: "send", url: "https://gemini.google.com/main.js?token=hidden", lineNumber: 18, columnNumber: 2 }] } });
    expect(initiator).toEqual({ type: "script", url: "https://gemini.google.com/app", lineNumber: 12, columnNumber: 4, stack: [{ functionName: "send", url: "https://gemini.google.com/main.js", lineNumber: 18, columnNumber: 2 }] });
    expect(JSON.stringify(initiator)).not.toContain("secret");
    expect(JSON.stringify(initiator)).not.toContain("token");
  });

  it("INCIDENT 1J CASE 1/3/5 preserves safe Document navigation metadata", () => {
    const navigation = normalizeDocumentNavigationRequest({ requestId: "request-1", loaderId: "loader-1", frameId: "frame-1", documentURL: "https://gemini.google.com/app?query=hidden", type: "Document", wallTime: 1789559332.897, hasUserGesture: false, mixedContentType: "none", request: { url: "https://gemini.google.com/app?query=hidden", method: "GET", referrerPolicy: "strict-origin", postData: "must-not-be-captured" }, initiator: { type: "script", url: "https://gemini.google.com/app?token=hidden", lineNumber: 3, columnNumber: 5 }, redirectResponse: {} });
    expect(navigation).toMatchObject({ requestId: "request-1", loaderId: "loader-1", frameId: "frame-1", documentURL: "https://gemini.google.com/app", url: "https://gemini.google.com/app", method: "GET", redirectResponsePresent: true, hasUserGesture: false, referrerPolicy: "strict-origin", type: "Document", initiator: { type: "script", url: "https://gemini.google.com/app", lineNumber: 3, columnNumber: 5 } });
    expect(JSON.stringify(navigation)).not.toContain("must-not-be-captured");
    expect(JSON.stringify(navigation)).not.toContain("token");
  });

  it("keeps one command in GENERATING until terminal response evidence exists", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt-1" });
    command.markSubmitted();
    command.markGenerating();
    expect(command.isTerminal()).toBe(false);
    expect(isResponseComplete({ newResponseCount: 1, responseText: "partial", stopButtonPresent: true, streamingIndicatorPresent: false, composerReady: false }, 10)).toBe(false);
  });

  it("does not complete while streaming indicators remain", () => {
    const snapshot = { newResponseCount: 1, responseText: "stable text", stopButtonPresent: false, streamingIndicatorPresent: true, composerReady: true };
    expect(isResponseComplete(snapshot, 10)).toBe(false);
  });

  it("accepts a validated structured response when only the stale processing indicator remains", () => {
    const json = '{"ok":true}';
    const snapshot = {
      newResponseCount: 1,
      responseText: json,
      composerReady: true,
      boundTurn: {
        finalResponseText: json,
        finalResponseBodyFound: true,
        stopButtonPresent: false,
        streamingIndicatorPresent: true,
        attached: true,
        detached: false,
      },
    };
    expect(isResponseComplete(snapshot, 3)).toBe(false);
    expect(isStructuredResponseComplete(snapshot, 3)).toBe(true);
  });

  it("requires a new uniquely bound response node and a bounded stability window", () => {
    const complete = { newResponseCount: 1, responseText: "complete", stopButtonPresent: false, streamingIndicatorPresent: false, composerReady: true };
    const ambiguous = { ...complete, newResponseCount: 2 };
    expect(isResponseComplete(complete, 2)).toBe(false);
    expect(isResponseComplete(complete, 3)).toBe(true);
    expect(isResponseComplete(ambiguous, 10)).toBe(false);
  });

  it("persists raw response metadata before parse state", () => {
    const events: Array<Record<string, unknown>> = [];
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt-1", persist: (event: Record<string, unknown>) => events.push(event) });
    command.markSubmitted();
    command.markGenerating();
    command.markResponseStarted({ index: 3, textLength: 24 });
    command.markResponseComplete({ responseNode: { index: 3, textLength: 24 } });
    command.captureRawResponse("{invalid", { index: 3, textLength: 8 });
    command.markParseStarted();
    command.markInvalidResponse("JSON_PARSE_FAILED");
    const captured = events.findIndex((event) => event.event === "RESPONSE_CAPTURED");
    const parseStarted = events.findIndex((event) => event.event === "PARSE_STARTED");
    expect(captured).toBeGreaterThanOrEqual(0);
    expect(captured).toBeLessThan(parseStarted);
    expect(events[captured]?.rawResponseHash).toBe(hashText("{invalid"));
  });

  it("keeps invalid JSON evidence after the command reaches INVALID_RESPONSE", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt-1" });
    command.markSubmitted();
    command.markGenerating();
    command.markResponseStarted({ index: 2 });
    command.markResponseComplete({ responseNode: { index: 2 } });
    command.captureRawResponse("not-json", { index: 2 });
    command.markParseStarted();
    command.markInvalidResponse("JSON_PARSE_FAILED");
    expect(command.snapshot().state).toBe("INVALID_RESPONSE");
    expect(command.snapshot().rawResponseHash).toBe(hashText("not-json"));
  });

  it("binds format retry to the parent command and records ordering", () => {
    let now = 1_000;
    const parent = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt-1", now: () => now });
    parent.markSubmitted();
    parent.markGenerating();
    parent.markResponseStarted({ index: 1 });
    parent.markResponseComplete({ responseNode: { index: 1 } });
    parent.captureRawResponse("invalid", { index: 1 });
    parent.markParseStarted();
    parent.markInvalidResponse("JSON_PARSE_FAILED");
    now += 10;
    const retry = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_FORMAT_RETRY", prompt: "retry", parentCommandId: parent.snapshot().commandId, now: () => now });
    retry.markSubmitted();
    parent.markNextCommandSent(retry.snapshot().commandSentAt);
    expect(retry.snapshot().parentCommandId).toBe(parent.snapshot().commandId);
    expect(new Date(retry.snapshot().commandSentAt).getTime()).toBeGreaterThan(new Date(parent.snapshot().responseCapturedAt).getTime());
  });

  it("does not treat a timeout as a successful response", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "SOURCE_ANALYSIS", prompt: "prompt-1" });
    command.markSubmitted();
    command.markGenerating();
    command.markTimeout("GEMINI_COMMAND_TIMEOUT");
    expect(command.snapshot().state).toBe("TIMEOUT");
    expect(command.isTerminal()).toBe(true);
  });

  it("hashes prompts and preserves session identity across commands", () => {
    const parent = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "SOURCE_ANALYSIS", prompt: "same" });
    const child = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "SOURCE_ANALYSIS_FORMAT_RETRY", prompt: "same", parentCommandId: parent.snapshot().commandId });
    expect(parent.snapshot().promptHash).toBe(hashText("same"));
    expect(child.snapshot().promptHash).toBe(parent.snapshot().promptHash);
    expect(child.snapshot().sessionId).toBe(parent.snapshot().sessionId);
  });

  it("blocks a child command while the parent is still active", () => {
    const parent = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt-1" });
    expect(() => assertParentTerminal(parent)).toThrow(/PARENT_NOT_TERMINAL/);
    parent.markSubmitted();
    parent.markGenerating();
    parent.markResponseStarted({ index: 1 });
    parent.markResponseComplete({ responseNode: { index: 1 } });
    parent.captureRawResponse("{}", { index: 1 });
    parent.markParseStarted();
    parent.markInvalidResponse("JSON_PARSE_FAILED");
    expect(() => assertParentTerminal(parent)).not.toThrow();
  });

  it("records required command metadata and response timestamps", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "SOURCE_ANALYSIS", prompt: "prompt" });
    command.markSubmitted();
    command.markGenerating();
    command.markResponseStarted({ index: 4 });
    command.markResponseComplete({ responseNode: { index: 4 } });
    command.captureRawResponse("{}", { index: 4 });
    const metadata = command.snapshot();
    expect(metadata.commandId).toEqual(expect.any(String));
    expect(metadata.sessionId).toBe("session-1");
    expect(metadata.purpose).toBe("SOURCE_ANALYSIS");
    expect(metadata.promptHash).toBe(hashText("prompt"));
    expect(metadata.commandQueuedAt).toEqual(expect.any(String));
    expect(metadata.commandSentAt).toEqual(expect.any(String));
    expect(metadata.responseCompletedAt).toEqual(expect.any(String));
    expect(metadata.responseCapturedAt).toEqual(expect.any(String));
  });

  it("rejects invalid lifecycle transitions instead of guessing", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "SOURCE_ANALYSIS", prompt: "prompt" });
    expect(() => command.markParsed()).toThrow(/INVALID_TRANSITION/);
  });

  it("requires the composer to be ready before declaring completion", () => {
    expect(isResponseComplete({ newResponseCount: 1, responseText: "done", stopButtonPresent: false, streamingIndicatorPresent: false, composerReady: false }, 10)).toBe(false);
  });

  it("CASE 1/6 collapses nested markdown and code nodes into one assistant turn", () => {
    const snapshot = normalizeGeminiResponseSnapshot({ candidates: [candidate("root", "turn-1", { isTurnRoot: true }), candidate("markdown", "turn-1"), candidate("code", "turn-1", { tag: "code" })], composerReady: true }, null);
    expect(snapshot.newResponseCount).toBe(1);
    expect(snapshot.boundTurn?.turnId).toBe("turn-1");
    expect(snapshot.boundTurn?.nestedNodeCount).toBe(3);
  });

  it("CASE 2 filters a hidden duplicate without losing the visible turn", () => {
    const snapshot = normalizeGeminiResponseSnapshot({ candidates: [candidate("visible", "turn-visible", { isTurnRoot: true }), candidate("hidden", "turn-hidden", { visible: false })], composerReady: true }, null);
    expect(snapshot.newResponseCount).toBe(1);
    expect(snapshot.boundTurn?.turnId).toBe("turn-visible");
  });

  it("CASE 3 binds the assistant turn that appeared after the pre-submit snapshot", () => {
    const snapshot = normalizeGeminiResponseSnapshot({ candidates: [candidate("old", "turn-old"), candidate("new", "turn-new", { isTurnRoot: true })], composerReady: true }, { assistantTurns: [{ turnId: "turn-old" }] });
    expect(snapshot.newResponseCount).toBe(1);
    expect(snapshot.boundTurn?.turnId).toBe("turn-new");
  });

  it("CASE 4 ignores composer content even when its text matches the response", () => {
    const snapshot = normalizeGeminiResponseSnapshot({ candidates: [candidate("response", "turn-response", { isTurnRoot: true }), candidate("composer", "turn-composer", { insideComposer: true })], composerReady: true }, null);
    expect(snapshot.newResponseCount).toBe(1);
    expect(snapshot.boundTurn?.turnId).toBe("turn-response");
  });

  it("CASE 5 ignores a user prompt bubble", () => {
    const snapshot = normalizeGeminiResponseSnapshot({ candidates: [candidate("user", "turn-user", { role: "user" }), candidate("assistant", "turn-assistant", { isTurnRoot: true })], composerReady: true }, null);
    expect(snapshot.newResponseCount).toBe(1);
    expect(snapshot.boundTurn?.turnId).toBe("turn-assistant");
  });

  it("CASE 7 reports two genuinely new assistant turns as ambiguous", () => {
    const snapshot = normalizeGeminiResponseSnapshot({ candidates: [candidate("one", "turn-one", { isTurnRoot: true }), candidate("two", "turn-two", { isTurnRoot: true })], composerReady: true }, null);
    expect(snapshot.newResponseCount).toBe(2);
    expect(snapshot.boundTurn).toBeNull();
  });

  it("CASE 8 reports zero new assistant turns when the DOM is unchanged", () => {
    const snapshot = normalizeGeminiResponseSnapshot({ candidates: [candidate("old", "turn-old", { isTurnRoot: true })], composerReady: true }, { assistantTurns: [{ turnId: "turn-old" }] });
    expect(snapshot.newResponseCount).toBe(0);
    expect(snapshot.boundTurn).toBeNull();
  });

  it("CASE 9 persists diagnostic metadata for every candidate", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt-1" });
    const snapshot = normalizeGeminiResponseSnapshot({ candidates: [candidate("one", "turn-one", { isTurnRoot: true }), candidate("two", "turn-two", { isTurnRoot: true })], composerReady: true }, { assistantTurns: [] });
    const diagnostic = buildGeminiBindingDiagnostic({ command, beforeSnapshot: { assistantTurns: [] }, snapshot, timestamp: "2026-09-15T00:00:00.000Z" });
    expect(diagnostic).toMatchObject({ commandId: command.snapshot().commandId, candidateCount: 2, preSubmitTurnCount: 0, postSubmitTurnCount: 2 });
    expect(diagnostic.candidateMetadata).toHaveLength(2);
    expect(diagnostic.candidateMetadata[0]).not.toHaveProperty("text");
  });

  it("CASE 10 uses the bound turn for completion, not global page state", () => {
    const snapshot = finalContentSnapshot({ stopButtonPresent: false, streamingIndicatorPresent: false });
    snapshot.stopButtonPresent = true;
    snapshot.streamingIndicatorPresent = true;
    expect(isResponseComplete(snapshot, 3)).toBe(true);
  });

  it("CASE 13 blocks format retry for binding ambiguity", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt-1" });
    command.markSubmitted();
    command.markGenerating();
    command.markFailed("RESPONSE_BINDING_AMBIGUOUS");
    expect(canRunFormatRetry({ ok: false, command })).toBe(false);
  });

  it("extracts only final markdown content rather than status chrome", () => {
    const snapshot = finalContentSnapshot();
    expect(snapshot.responseText).toBe('{"storyboard":[]}');
    expect(snapshot.boundTurn?.statusText).toContain("Initiating the Analysis");
    expect(snapshot.boundTurn?.finalResponseSelector).toBe("message-content");
  });

  it("does not complete a status-only bound turn", () => {
    const snapshot = finalContentSnapshot({
      text: "Initiating the Analysis",
      statusText: "Initiating the Analysis",
      contentCandidates: [],
    });
    expect(snapshot.boundTurn?.finalResponseBodyFound).toBe(false);
    expect(isResponseComplete(snapshot, 10)).toBe(false);
  });

  it("excludes accessibility chrome when a final response body is present", () => {
    const snapshot = finalContentSnapshot();
    expect(snapshot.responseText).not.toContain("Gemini đã nói");
  });

  it("does not complete stable status text while the bound turn is generating", () => {
    const snapshot = finalContentSnapshot({
      stopButtonPresent: true,
      streamingIndicatorPresent: true,
    });
    expect(isResponseComplete(snapshot, 10)).toBe(false);
  });

  it("waits when Stop is gone but final response content has not appeared", () => {
    const snapshot = finalContentSnapshot({
      text: "Initiating the Analysis",
      statusText: "Initiating the Analysis",
      contentCandidates: [],
      stopButtonPresent: false,
      streamingIndicatorPresent: false,
    });
    expect(isGenerationTerminal(snapshot)).toBe(true);
    expect(isResponseComplete(snapshot, 10)).toBe(false);
  });

  it("captures a final response that appears after status text", () => {
    const snapshot = finalContentSnapshot({ contentCandidates: [contentCandidate("late-body", "{\"scenes\":[]}", { hasMarkdownClass: true })] });
    expect(snapshot.responseText).toBe('{"scenes":[]}');
  });

  it("preserves fenced JSON and plain JSON final response bodies", () => {
    const fenced = finalContentSnapshot({ contentCandidates: [contentCandidate("fenced", "```json\n{\"scenes\":[]}\n```", { hasMarkdownClass: true })] });
    const plain = finalContentSnapshot({ contentCandidates: [contentCandidate("plain", "{\"scenes\":[]}", { hasMarkdownClass: true })] });
    expect(fenced.responseText).toBe("```json\n{\"scenes\":[]}\n```");
    expect(plain.responseText).toBe('{"scenes":[]}');
  });

  it("records a content-not-found diagnostic instead of treating status chrome as JSON", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt-1" });
    const snapshot = finalContentSnapshot({ text: "Initiating the Analysis", statusText: "Initiating the Analysis", contentCandidates: [] });
    const diagnostic = buildGeminiResponseContentDiagnostic({ command, beforeSnapshot: { assistantTurns: [] }, snapshot, reason: "FINAL_RESPONSE_CONTENT_NOT_FOUND" });
    expect(diagnostic).toMatchObject({ reason: "FINAL_RESPONSE_CONTENT_NOT_FOUND", finalResponseBodyFound: false, statusText: "Initiating the Analysis", finalResponseText: "" });
  });

  it("does not allow a format retry when final response content was not found", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt-1" });
    command.markSubmitted(); command.markGenerating(); command.markFailed("FINAL_RESPONSE_CONTENT_NOT_FOUND");
    expect(canRunFormatRetry({ ok: false, command })).toBe(false);
  });

  it("still allows a format retry only after captured final content fails JSON parsing", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt-1" });
    command.markSubmitted(); command.markGenerating(); command.markResponseStarted({}); command.markResponseComplete({}); command.captureRawResponse("final but invalid", {}); command.markParseStarted(); command.markInvalidResponse("JSON_PARSE_FAILED");
    expect(canRunFormatRetry({ ok: false, command })).toBe(true);
  });

  it("keeps turn, status, and final response diagnostics distinct", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt-1" });
    const snapshot = finalContentSnapshot();
    const diagnostic = buildGeminiResponseContentDiagnostic({ command, beforeSnapshot: { assistantTurns: [] }, snapshot, reason: "TEST" });
    expect(diagnostic.turnText).toContain("Gemini đã nói");
    expect(diagnostic.statusText).toContain("Gemini đã nói");
    expect(diagnostic.finalResponseText).toBe('{"storyboard":[]}');
  });

  it("CASE 1 rejects the production generic div false positive even when score is zero", () => {
    const result = extractFinalResponseContent({ contentExtractionAvailable: true, contentCandidates: [{ ...candidate("generic-status", "turn-final", { tag: "div", text: "Defining the Parameters\\nGemini đã nói", textLength: 37, isMessageContent: false, hasResponseData: false, hasMarkdownClass: false, hasMarkdownTestId: false, statusLike: false, accessibilityChrome: false }) }] });
    expect(result).toMatchObject({ found: false, candidate: null, score: null, candidateCount: 1, qualifiedCandidateCount: 0 });
    expect(result.diagnostics[0]).toMatchObject({ tag: "div", score: 0, positiveSignals: [], qualifiedFinalResponse: false, rejectionReasons: ["NO_POSITIVE_RESPONSE_SIGNAL"] });
  });

  it("CASE 2 rejects a generic div with large meaningful-looking text without semantic identity", () => {
    const result = extractFinalResponseContent({ contentExtractionAvailable: true, contentCandidates: [{ ...candidate("generic-long", "turn-final", { tag: "div", text: "A".repeat(600), textLength: 600, isMessageContent: false, hasResponseData: false, hasMarkdownClass: false, hasMarkdownTestId: false, statusLike: false, accessibilityChrome: false }) }] });
    expect(result.found).toBe(false);
    expect(result.diagnostics[0]?.rejectionReasons).toContain("NO_POSITIVE_RESPONSE_SIGNAL");
  });

  it("CASE 3 selects message-content with a valid JSON response", () => {
    const result = extractFinalResponseContent({ contentExtractionAvailable: true, contentCandidates: [contentCandidate("message-body", '{"sourceModelingSpec":{"scenes":[]}}')] });
    expect(result).toMatchObject({ found: true, text: '{"sourceModelingSpec":{"scenes":[]}}', selector: "message-content", qualifiedCandidateCount: 1 });
    expect(result.diagnostics[0]).toMatchObject({ isMessageContent: true, positiveSignals: ["MESSAGE_CONTENT"], qualifiedFinalResponse: true });
  });

  it("CASE 4 rejects status and accessibility chrome while selecting the real body", () => {
    const result = extractFinalResponseContent({ contentExtractionAvailable: true, contentCandidates: [
      { ...candidate("status-div", "turn-final", { tag: "div", text: "Defining the Parameters", textLength: 23, statusLike: true, isMessageContent: false, hasResponseData: false, hasMarkdownClass: false, hasMarkdownTestId: false }) },
      { ...candidate("accessibility-div", "turn-final", { tag: "div", text: "Gemini đã nói", textLength: 13, accessibilityChrome: true, isMessageContent: false, hasResponseData: false, hasMarkdownClass: false, hasMarkdownTestId: false }) },
      contentCandidate("real-body", '{"ok":true}'),
    ] });
    expect(result.text).toBe('{"ok":true}');
    expect(result.diagnostics.filter((item) => item.qualifiedFinalResponse)).toHaveLength(1);
    expect(result.diagnostics.find((item) => item.candidateId === "status-div")?.rejectionReasons).toEqual(expect.arrayContaining(["STATUS_CHROME", "NO_POSITIVE_RESPONSE_SIGNAL"]));
    expect(result.diagnostics.find((item) => item.candidateId === "accessibility-div")?.rejectionReasons).toEqual(expect.arrayContaining(["ACCESSIBILITY_CHROME", "NO_POSITIVE_RESPONSE_SIGNAL"]));
  });

  it("CASE 5 exposes no qualified body for a status-only assistant turn", () => {
    const snapshot = normalizeGeminiResponseSnapshot({ candidates: [candidate("status-turn", "turn-status", { isTurnRoot: true, text: "Defining the Parameters\\nGemini đã nói", textLength: 37, statusText: "Defining the Parameters\\nGemini đã nói", contentExtractionAvailable: true, contentCandidates: [{ ...candidate("status-node", "turn-status", { tag: "div", text: "Defining the Parameters\\nGemini đã nói", textLength: 37, isMessageContent: false, statusLike: false, accessibilityChrome: false, hasResponseData: false, hasMarkdownClass: false, hasMarkdownTestId: false }) }] })], composerReady: true }, null);
    expect(snapshot.boundTurn?.finalResponseBodyFound).toBe(false);
    expect(snapshot.boundTurn?.finalResponseContainer).toBeNull();
    expect(snapshot.boundTurn?.qualifiedFinalResponseCandidateCount).toBe(0);
  });

  it("accepts parse-checked JSON exposed only through status text when the body node is hidden", () => {
    const payload = '{"sourceModelingSpec":{"scenes":[]}}';
    const snapshot = normalizeGeminiResponseSnapshot({ candidates: [candidate("hidden-turn", "turn-hidden", {
      isTurnRoot: true,
      text: "Gemini đã nói\\n" + payload,
      textLength: payload.length + 14,
      statusText: "Gemini đã nói\\n" + payload,
      contentExtractionAvailable: true,
      contentCandidates: [{ ...candidate("hidden-body", "turn-hidden", { text: payload, textLength: payload.length, visible: false, zeroSize: true, isMessageContent: true }) }],
    })], composerReady: true }, null);
    expect(snapshot.responseText).toBe(payload);
    expect(snapshot.boundTurn?.finalResponseBodyFound).toBe(true);
    expect(snapshot.boundTurn?.finalResponseContainer?.statusTextFallback).toBe(true);
    expect(snapshot.boundTurn?.finalResponseSelector).toBe("status-text-json-fallback");
  });

  it("uses the first complete status-text JSON object when Gemini repeats a formatted copy", () => {
    const first = '{"sourceModelingSpec":{"scenes":[]}}';
    const repeated = `${first}\\n{\\n  "sourceModelingSpec": {\\n    "scenes": []\\n  }\\n}`;
    const snapshot = normalizeGeminiResponseSnapshot({ candidates: [candidate("repeated-turn", "turn-repeated", {
      isTurnRoot: true,
      text: "Gemini đã nói\\n" + repeated,
      statusText: "Gemini đã nói\\n" + repeated,
      contentExtractionAvailable: true,
      contentCandidates: [{ ...candidate("repeated-body", "turn-repeated", { text: first, visible: false, zeroSize: true, isMessageContent: true }) }],
    })], composerReady: true }, null);
    expect(snapshot.responseText).toBe(first);
    expect(snapshot.boundTurn?.finalResponseBodyFound).toBe(true);
  });

  it("CASE 6 terminal status-only content remains FINAL_RESPONSE_CONTENT_NOT_FOUND", () => {
    const snapshot = finalContentSnapshot({ text: "Defining the Parameters\\nGemini đã nói", statusText: "Defining the Parameters\\nGemini đã nói", contentCandidates: [], stopButtonPresent: false, streamingIndicatorPresent: false });
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt-1" });
    command.markSubmitted(); command.markGenerating(); command.markFailed("FINAL_RESPONSE_CONTENT_NOT_FOUND");
    const diagnostic = buildGeminiResponseContentDiagnostic({ command, beforeSnapshot: { assistantTurns: [] }, snapshot, reason: "FINAL_RESPONSE_CONTENT_NOT_FOUND" });
    expect(diagnostic).toMatchObject({ reason: "FINAL_RESPONSE_CONTENT_NOT_FOUND", finalResponseBodyFound: false, selectedCandidateIdentity: null, qualifiedCandidateCount: 0 });
    expect(canRunFormatRetry({ ok: false, command })).toBe(false);
  });

  it("CASE 7/8 never permits parser or format retry from an unqualified body", () => {
    const result = extractFinalResponseContent({ contentExtractionAvailable: true, contentCandidates: [{ ...candidate("unqualified", "turn-final", { tag: "div", text: "processing", isMessageContent: false, hasResponseData: false, hasMarkdownClass: false, hasMarkdownTestId: false }) }] });
    expect(result.found).toBe(false);
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt-1" });
    command.markSubmitted(); command.markGenerating(); command.markFailed("FINAL_RESPONSE_CONTENT_NOT_FOUND");
    expect(canRunFormatRetry({ ok: false, command })).toBe(false);
  });

  it("CASE 9/10 keeps format retry for qualified captured content only", () => {
    const result = extractFinalResponseContent({ contentExtractionAvailable: true, contentCandidates: [contentCandidate("qualified-invalid", "not-json")] });
    expect(result.found).toBe(true);
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt-1" });
    command.markSubmitted(); command.markGenerating(); command.markResponseStarted({}); command.markResponseComplete({}); command.captureRawResponse(result.text, {}); command.markParseStarted(); command.markInvalidResponse("JSON_PARSE_FAILED");
    expect(canRunFormatRetry({ ok: false, command })).toBe(true);
  });

  it("CASE 14 rejects changed English/Vietnamese status chrome without positive response identity", () => {
    const result = extractFinalResponseContent({ contentExtractionAvailable: true, contentCandidates: [{ ...candidate("changed-status", "turn-final", { tag: "div", text: "Analyzing source\\nAssistant said", isMessageContent: false, hasResponseData: false, hasMarkdownClass: false, hasMarkdownTestId: false, statusLike: false, accessibilityChrome: false }) }] });
    expect(result.found).toBe(false);
    expect(result.diagnostics[0]?.positiveSignals).toEqual([]);
  });

  it("LATENCY CASE 1/2/3 records submission confirmation only from positive UI evidence", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: submissionPrompt });
    command.setSubmissionBaseline({ expectedConversationUrl: conversationUrl, expectedConversationId: "conversation-1", userTurnCount: 1, assistantTurnCount: 1, userTurns: baselineUserTurns });
    command.markSubmitAttempt("2026-09-16T10:00:00.000Z");
    command.observeSubmission({ composerReady: false, userMessagePresent: false, stopButtonPresent: false, streamingIndicatorPresent: false, newResponseCount: 0 }, "2026-09-16T10:00:01.000Z");
    expect(command.snapshot()).toMatchObject({ state: "QUEUED", submitAttemptAt: "2026-09-16T10:00:00.000Z", submissionConfirmed: false, composerClearedAt: null, userMessageRenderedAt: null });
    command.observeSubmission(strictSubmissionSnapshot(), "2026-09-16T10:00:02.000Z");
    expect(command.snapshot()).toMatchObject({ submissionConfirmed: true, submissionConfirmationSource: "DOM_USER_TURN_EXACT", submissionConfirmedAt: "2026-09-16T10:00:02.000Z", composerClearedAt: "2026-09-16T10:00:02.000Z", userMessageRenderedAt: "2026-09-16T10:00:02.000Z", conversationOwnershipConfirmed: true, newUserTurnConfirmed: true, userTurnDelta: 1, exactPromptDelta: 1 });
  });

  it("LATENCY CASE 4 records send-retry reason and snapshot without changing state", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt" });
    command.markSubmitAttempt("2026-09-16T10:00:00.000Z");
    command.markSubmitted(); command.markGenerating();
    command.markSendRetry("COMPOSER_STILL_CONTAINS_PROMPT_AND_NO_RESPONSE", { composerHasPrompt: true, userMessagePresent: false, generationIndicatorPresent: false, responseTurnPresent: false }, "2026-09-16T10:00:01.000Z");
    expect(command.snapshot()).toMatchObject({ state: "GENERATING", sendRetryAt: "2026-09-16T10:00:01.000Z", sendRetryReason: "COMPOSER_STILL_CONTAINS_PROMPT_AND_NO_RESPONSE", sendRetrySnapshot: { composerHasPrompt: true, responseTurnPresent: false } });
  });

  it("LATENCY CASE 5/6 records network candidates and keeps unknown generation request unclassified", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt" });
    command.recordNetworkTimeline({ generationRequestIdentified: false, requests: [{ requestId: "req-1", url: "https://gemini.google.com/api", method: "POST", resourceType: "Fetch", startedAt: "2026-09-16T10:00:03.000Z", responseHeadersAt: "2026-09-16T10:00:04.000Z", firstDataAt: "2026-09-16T10:00:05.000Z", finishedAt: null, failedAt: null, generationRequestCandidate: true }] });
    expect(command.latencySnapshot()).toMatchObject({ networkGenerationRequestIdentified: false, networkRequestStartedAt: null, networkRequests: [{ requestId: "req-1", firstDataAt: "2026-09-16T10:00:05.000Z" }] });
  });

  it("LATENCY CASE 5 redacts network query credentials by retaining only origin and path", () => {
    expect(redactNetworkUrl("https://gemini.google.com/api/generate?access_token=secret&prompt=private")).toBe("https://gemini.google.com/api/generate");
    expect(redactNetworkUrl("not-a-url")).toBeNull();
  });

  it("LATENCY CASE 7 computes renderer heartbeat max and P95 drift", () => {
    expect(summarizeRendererHeartbeat([{ timestamp: "t1", expectedDeltaMs: 1000, actualDeltaMs: 1001, driftMs: 1 }, { timestamp: "t2", expectedDeltaMs: 1000, actualDeltaMs: 1005, driftMs: 5 }, { timestamp: "t3", expectedDeltaMs: 1000, actualDeltaMs: 1010, driftMs: 10 }])).toMatchObject({ expectedIntervalMs: 1000, sampleCount: 3, maxDriftMs: 10, p95DriftMs: 10 });
  });

  it("LATENCY CASE 8/11 records page/conversation state and leaves absent values null", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt" });
    command.recordPageState("SUBMIT", { renderer: { url: "https://gemini.google.com/app", visibilityState: "visible", hidden: false, hasFocus: true }, browserWindow: { visible: true, focused: true, minimized: false, backgroundThrottling: null } }, "2026-09-16T10:00:00.000Z");
    command.recordConversationState({ url: "https://gemini.google.com/app", mode: "EXISTING", assistantTurnCount: 4, userTurnCount: 4, approximateMessageNodeCount: 8 });
    const latency = command.latencySnapshot();
    expect(latency.pageStates).toHaveLength(1);
    expect(latency.conversation).toMatchObject({ mode: "EXISTING", assistantTurnCountBeforeSubmit: 4, userTurnCountBeforeSubmit: 4, approximateMessageNodeCount: 8 });
    expect(latency.networkRequestStartedAt).toBeNull();
  });

  it("LATENCY CASE 9/12 preserves command timeout/state transitions and prompt hash/size", () => {
    let now = Date.parse("2026-09-16T10:00:00.000Z");
    const prompt = "Tiếng Việt ✓";
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt, now: () => now });
    expect(command.snapshot()).toMatchObject({ promptCharacterLength: prompt.length, promptByteLength: Buffer.byteLength(prompt, "utf8"), promptHash: hashText(prompt), state: "QUEUED" });
    command.markSubmitAttempt(); command.markSubmitted(); command.markGenerating();
    now += 1000; command.markTimeout("GEMINI_COMMAND_TIMEOUT");
    expect(command.snapshot()).toMatchObject({ state: "TIMEOUT", timeoutAt: "2026-09-16T10:00:01.000Z", error: "GEMINI_COMMAND_TIMEOUT" });
  });

  it("LATENCY CASE 6 computes only latency buckets with complete timestamps", () => {
    expect(deriveLatencyBuckets({ submitAttemptAt: "2026-09-16T10:00:00.000Z", submissionConfirmedAt: "2026-09-16T10:00:00.100Z", networkRequestStartedAt: "2026-09-16T10:00:00.300Z", networkFirstByteAt: "2026-09-16T10:00:01.300Z", firstQualifiedResponseDomAt: "2026-09-16T10:00:01.500Z", finalResponseVisibleAt: "2026-09-16T10:00:02.500Z", responseCapturedAt: "2026-09-16T10:00:02.600Z", queuedAt: "2026-09-16T09:59:59.900Z" })).toEqual({ appToSubmissionConfirmMs: 100, submissionToNetworkRequestMs: 200, networkRequestToFirstByteMs: 1000, firstByteToFirstDomMs: 200, firstDomToFinalResponseMs: 1000, finalResponseToCaptureMs: 100, totalCommandMs: 2700 });
    expect(deriveLatencyBuckets({ submitAttemptAt: "2026-09-16T10:00:00.000Z" }).networkRequestToFirstByteMs).toBeNull();
  });

  it("INCIDENT 1F CASE 1/3 confirms submission by attributed StreamGenerate and forbids resend", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: submissionPrompt });
    command.setSubmissionBaseline({ expectedConversationUrl: conversationUrl, expectedConversationId: "conversation-1", userTurnCount: 1, assistantTurnCount: 1, userTurns: baselineUserTurns });
    command.markSubmitAttempt("2026-09-16T10:00:00.000Z");
    const request = { commandId: command.snapshot().commandId, sessionId: command.snapshot().sessionId, method: "POST", url: "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate", startedAt: "2026-09-16T10:00:01.000Z" };
    expect(isGeminiGenerationRequest(request)).toBe(true);
    expect(findAttributedGeminiGenerationRequest([request], command.snapshot())).toBe(request);
    command.confirmSubmissionByNetwork(request);
    expect(command.snapshot()).toMatchObject({ submissionConfirmed: false, generationStarted: true, generationStartSource: "NETWORK_GENERATION_REQUEST", submissionConfirmationSources: ["NETWORK_GENERATION_REQUEST"] });
    command.observeSubmission(strictSubmissionSnapshot(), "2026-09-16T10:00:01.100Z");
    expect(command.snapshot()).toMatchObject({ submissionConfirmed: true, submissionConfirmationSource: "DOM_USER_TURN_EXACT", submissionConfirmationSources: ["NETWORK_GENERATION_REQUEST", "DOM_USER_TURN_EXACT"] });
    expect(shouldRetryGeminiSend({ composerStillContainsPrompt: true, submissionConfirmed: true, generationRequestStarted: true, pageReady: true })).toBe(false);
  });

  it("confirms a network-backed send when a new user turn and cleared composer are present but the normalized prompt hash changed", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: submissionPrompt });
    command.setSubmissionBaseline({ expectedConversationUrl: conversationUrl, expectedConversationId: "conversation-1", userTurnCount: 1, assistantTurnCount: 1, userTurns: baselineUserTurns });
    command.markSubmitAttempt("2026-09-16T10:00:00.000Z");
    command.observeSubmission({ conversationUrl, conversationMode: "EXISTING", userTurnCount: 2, assistantTurnCount: 1, userTurns: [{ turnId: "user-2", normalizedTextHash: "hash-from-rendered-query" }], userMessagePresent: true, composerReady: true, stopButtonPresent: false, streamingIndicatorPresent: false, newResponseCount: 0 }, "2026-09-16T10:00:00.500Z");
    expect(command.snapshot()).toMatchObject({ conversationOwnershipConfirmed: true, userTurnDelta: 1, exactPromptDelta: 0, submissionConfirmed: false });
    command.confirmSubmissionByNetwork({ commandId: command.snapshot().commandId, sessionId: command.snapshot().sessionId, method: "POST", url: "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate", startedAt: "2026-09-16T10:00:00.700Z" });
    expect(command.snapshot()).toMatchObject({ submissionConfirmed: true, submissionConfirmationSource: "NETWORK_GENERATION_REQUEST_WITH_NEW_USER_TURN", submissionConfirmationSources: ["NETWORK_GENERATION_REQUEST", "NETWORK_GENERATION_REQUEST_WITH_NEW_USER_TURN"] });
  });

  it("INCIDENT 1F CASE 4/5 rejects composer-only confirmation and keeps retry predicate pure", () => {
    expect(shouldRetryGeminiSend({ composerStillContainsPrompt: true, submissionConfirmed: false, generationRequestStarted: false, pageReady: true, retryBudgetAvailable: true })).toBe(true);
    expect(shouldRetryGeminiSend({ composerStillContainsPrompt: true, submissionConfirmed: false, generationRequestStarted: false, pageReady: false, retryBudgetAvailable: true })).toBe(false);
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt" });
    command.observeSubmission({ composerReady: true, userMessagePresent: false, stopButtonPresent: false, streamingIndicatorPresent: false, newResponseCount: 0 }, "2026-09-16T10:00:00.000Z");
    expect(command.snapshot()).toMatchObject({ submissionConfirmed: false, submissionConfirmationSource: null, submissionState: "UNCONFIRMED" });
  });

  it("INCIDENT 1F CASE 6/7 does not attribute another command or competing session request", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt", commandId: "command-current" });
    command.markSubmitAttempt("2026-09-16T10:00:00.000Z");
    const request = { commandId: "command-other", sessionId: "session-other", method: "POST", url: "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate", startedAt: "2026-09-16T10:00:01.000Z" };
    expect(findAttributedGeminiGenerationRequest([request], command.snapshot())).toBeNull();
    expect(isGeminiGenerationRequest({ ...request, commandId: command.snapshot().commandId, sessionId: command.snapshot().sessionId, startedAt: "2026-09-16T09:59:59.000Z" })).toBe(true);
    expect(findAttributedGeminiGenerationRequest([{ ...request, commandId: command.snapshot().commandId, sessionId: command.snapshot().sessionId, startedAt: "2026-09-16T09:59:59.000Z" }], command.snapshot())).toBeNull();
  });

  it("INCIDENT 1H CASE 1: StreamGenerate cannot confirm submission before the exact user turn", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: submissionPrompt });
    command.setSubmissionBaseline({ expectedConversationUrl: conversationUrl, expectedConversationId: "conversation-1", userTurnCount: 1, assistantTurnCount: 1, userTurns: baselineUserTurns });
    command.markSubmitAttempt("2026-09-16T10:00:00.000Z");
    command.markRetryEligible("2026-09-16T10:00:01.000Z");
    expect(command.snapshot()).toMatchObject({ retryConfirmationState: "RETRY_CONFIRMATION_PENDING", retryEligibleAt: "2026-09-16T10:00:01.000Z", sendRetryCount: 0, sendRetryAt: null });
    command.confirmSubmissionByNetwork({ commandId: command.snapshot().commandId, sessionId: command.snapshot().sessionId, method: "POST", url: "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate", startedAt: "2026-09-16T10:00:01.032Z" });
    expect(command.snapshot()).toMatchObject({ submissionConfirmed: false, generationStarted: true, retryConfirmationState: "RETRY_CONFIRMATION_PENDING", resendForbidden: false, sendRetryCount: 0, sendRetryAt: null, actualResendAt: null });
    command.observeSubmission(strictSubmissionSnapshot(), "2026-09-16T10:00:01.100Z");
    expect(command.snapshot()).toMatchObject({ submissionConfirmed: true, submissionConfirmationSource: "DOM_USER_TURN_EXACT", retryConfirmationState: "RETRY_CANCELLED", retryCancelledSource: "DOM_USER_TURN_EXACT", resendForbidden: true });
  });

  it("INCIDENT 1H CASE 2/3/4: generation network evidence never replaces strict user-turn confirmation", () => {
    for (const offset of [1, 500, 1000]) {
      const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: submissionPrompt });
      command.setSubmissionBaseline({ expectedConversationUrl: conversationUrl, expectedConversationId: "conversation-1", userTurnCount: 1, assistantTurnCount: 1, userTurns: baselineUserTurns });
      command.markSubmitAttempt("2026-09-16T10:00:00.000Z");
      command.markRetryEligible("2026-09-16T10:00:01.000Z");
      command.confirmSubmissionByNetwork({ startedAt: new Date(Date.parse("2026-09-16T10:00:01.000Z") + offset).toISOString() });
      expect(command.snapshot().sendRetryCount).toBe(0);
      expect(command.snapshot()).toMatchObject({ submissionConfirmed: false, generationStarted: true, retryConfirmationState: "RETRY_CONFIRMATION_PENDING" });
    }
  });

  it("INCIDENT 1H CASE 5/12/13: eligibility alone does not increment count, actual resend does", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt" });
    command.markSubmitAttempt("2026-09-16T10:00:00.000Z");
    command.markRetryEligible("2026-09-16T10:00:01.000Z");
    expect(command.snapshot().sendRetryCount).toBe(0);
    expect(authorizeGeminiSendRetry({ retryEligible: true, confirmationGraceExpired: true, submissionConfirmed: false, generationRequestStarted: false, pageReady: true, retryBudgetAvailable: true, duplicateSendGuardPass: true, commandStillCurrent: true })).toBe(true);
    command.markSendRetry("COMPOSER_STILL_CONTAINS_PROMPT_AND_NO_RESPONSE", { composerHasPrompt: true }, "2026-09-16T10:00:03.000Z");
    expect(command.snapshot()).toMatchObject({ sendRetryCount: 1, sendRetryAt: "2026-09-16T10:00:03.000Z", actualResendAt: "2026-09-16T10:00:03.000Z", retryConfirmationState: "ACTUAL_RESEND" });
  });

  it("INCIDENT 1H CASE 6/7/8: only exact current user turn cancels pending retry", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: submissionPrompt });
    command.setSubmissionBaseline({ expectedConversationUrl: conversationUrl, expectedConversationId: "conversation-1", userTurnCount: 1, assistantTurnCount: 1, userTurns: baselineUserTurns });
    command.markRetryEligible("2026-09-16T10:00:01.000Z");
    command.observeSubmission({ composerReady: true, userMessagePresent: false, stopButtonPresent: true, streamingIndicatorPresent: true, newResponseCount: 0, conversationUrl, userTurnCount: 1, assistantTurnCount: 1, userTurns: baselineUserTurns }, "2026-09-16T10:00:01.100Z");
    expect(command.snapshot()).toMatchObject({ submissionConfirmed: false, retryConfirmationState: "RETRY_CONFIRMATION_PENDING", resendForbidden: false, sendRetryCount: 0 });
    command.observeSubmission(strictSubmissionSnapshot(), "2026-09-16T10:00:01.200Z");
    expect(command.snapshot()).toMatchObject({ submissionConfirmed: true, retryConfirmationState: "RETRY_CANCELLED", resendForbidden: true, sendRetryCount: 0 });
  });

  it("INCIDENT 1H CASE 9/10/11: uncertain context never authorizes resend and preserves command identity", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: submissionPrompt, commandId: "command-1" });
    command.setSubmissionBaseline({ expectedConversationUrl: conversationUrl, expectedConversationId: "conversation-1", userTurnCount: 1, assistantTurnCount: 1, userTurns: baselineUserTurns });
    command.markRetryEligible("2026-09-16T10:00:01.000Z");
    command.markSubmissionUncertain("REMOTE_CONTEXT_NOT_READY", "2026-09-16T10:00:01.100Z");
    expect(authorizeGeminiSendRetry({ retryEligible: true, confirmationGraceExpired: true, submissionConfirmed: false, generationRequestStarted: false, pageReady: false, commandStillCurrent: true })).toBe(false);
    command.confirmSubmissionByNetwork({ commandId: "command-1", sessionId: "session-1", startedAt: "2026-09-16T10:00:01.200Z" });
    expect(command.snapshot()).toMatchObject({ commandId: "command-1", submissionConfirmed: false, generationStarted: true, sendRetryCount: 0, resendForbidden: false });
  });

  it("INCIDENT 1H CASE 14/15/16: final arbitration requires current command and duplicate guard", () => {
    const base = { retryEligible: true, confirmationGraceExpired: true, submissionConfirmed: false, generationRequestStarted: false, pageReady: true, retryBudgetAvailable: true };
    expect(authorizeGeminiSendRetry({ ...base, commandStillCurrent: false, duplicateSendGuardPass: true })).toBe(false);
    expect(authorizeGeminiSendRetry({ ...base, commandStillCurrent: true, duplicateSendGuardPass: false })).toBe(false);
    expect(authorizeGeminiSendRetry({ ...base, commandStillCurrent: true, duplicateSendGuardPass: true })).toBe(true);
  });

  it("INCIDENT 1H invariant: confirmed submission cannot re-enter retry-pending", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: submissionPrompt });
    command.setSubmissionBaseline({ expectedConversationUrl: conversationUrl, expectedConversationId: "conversation-1", userTurnCount: 1, assistantTurnCount: 1, userTurns: baselineUserTurns });
    command.confirmSubmissionByNetwork({ startedAt: "2026-09-16T10:00:01.000Z" });
    command.observeSubmission(strictSubmissionSnapshot(), "2026-09-16T10:00:01.500Z");
    command.markRetryEligible("2026-09-16T10:00:02.000Z");
    expect(command.snapshot()).toMatchObject({ submissionConfirmed: true, retryConfirmationState: "IDLE", retryEligibleAt: null, resendForbidden: false, sendRetryCount: 0 });
  });

  it("INCIDENT 1L describes every completion predicate without changing the completion result", () => {
    const snapshot = { newResponseCount: 1, responseText: "{\"ok\":true}", composerReady: true, boundTurn: { text: "{\"ok\":true}", finalResponseBodyFound: true, stopButtonPresent: false, streamingIndicatorPresent: false, attached: true, detached: false, finalResponseTextLength: 12, finalResponseTextHash: hashText("{\"ok\":true}"), finalResponseCandidateCount: 1, qualifiedFinalResponseCandidateCount: 1, selectedFinalResponseCandidateIdentity: "body-1" } };
    expect(describeResponseCompletion(snapshot, 3, 3)).toMatchObject({ complete: true, failedPredicates: [], predicates: { uniqueResponseTurn: true, responseTextPresent: true, finalResponseBodyFound: true, stablePollsReached: true, stopButtonAbsent: true, streamingIndicatorAbsent: true, composerReady: true, responseAttached: true }, finalResponseTextLength: 12, selectedCandidateIdentity: "body-1" });
    expect(isResponseComplete(snapshot, 3, 3)).toBe(true);
    expect(describeResponseCompletion({ ...snapshot, boundTurn: { ...snapshot.boundTurn, streamingIndicatorPresent: true } }, 3, 3)).toMatchObject({ complete: false, failedPredicates: ["streamingIndicatorAbsent"] });
  });

  it("INCIDENT 1L records response progress and bounded completion evaluations without raw text", () => {
    const command = new GeminiCommandLifecycle({ sessionId: "session-1", purpose: "CONTENT_PROJECT_DEVELOP", prompt: "prompt" });
    const snapshot = { newResponseCount: 1, responseText: "{\"a\":", composerReady: true, boundTurn: { text: "Gemini đã nói\\n{\"a\":", turnTextLength: 18, turnTextHash: "turn-hash", finalResponseTextLength: 5, finalResponseTextHash: "body-hash", finalResponseBodyFound: true, finalResponseCandidateCount: 2, qualifiedFinalResponseCandidateCount: 1, selectedFinalResponseCandidateIdentity: "body-1", stopButtonPresent: false, streamingIndicatorPresent: true, attached: true, detached: false } };
    command.recordResponseProgress(snapshot, 1, "2026-09-17T10:00:00.000Z");
    command.recordCompletionEvaluation(snapshot, 1, 3, "2026-09-17T10:00:00.000Z");
    const evidence = command.latencySnapshot();
    expect(evidence.responseProgress).toMatchObject([{ at: "2026-09-17T10:00:00.000Z", responseTextLength: 5, responseTextHash: hashText("{\"a\":"), finalResponseTextLength: 5, candidateCount: 2, qualifiedCandidateCount: 1, selectedCandidateIdentity: "body-1", streamingIndicatorPresent: true, stablePolls: 1 }]);
    expect(evidence.completionEvaluations).toMatchObject([{ complete: false, failedPredicates: expect.arrayContaining(["stablePollsReached", "streamingIndicatorAbsent"]), responseTextLength: expect.any(Number) }]);
    expect(JSON.stringify(evidence.responseProgress)).not.toContain("{\"a\":");
  });

  it("INCIDENT 1F CASE 2/8/10 validates transient readiness and terminal target guards", () => {
    expect(isGeminiTargetReady({ url: "https://gemini.google.com/app", loading: false, readyState: "complete" })).toBe(true);
    expect(isGeminiTargetReady({ url: "https://example.test/", loading: false, readyState: "complete" })).toBe(false);
    expect(isGeminiTargetReady({ url: "https://gemini.google.com/app", loading: true, readyState: "complete" })).toBe(false);
    expect(isGeminiTargetReady({ url: "https://gemini.google.com/app", loading: false, readyState: "loading" })).toBe(false);
  });
});
