import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { sourceModelingSpecSchema } from "../src/modules/modeling/strict-source-modeling";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isJsonSerializable, wrapGeminiRemoteExpression, normalizeRemoteFailure } = require("./gemini-remote-script.cjs") as {
  isJsonSerializable: (value: unknown) => boolean;
  wrapGeminiRemoteExpression: (expression: string, phase: string) => string;
  normalizeRemoteFailure: (error: unknown, context?: Record<string, unknown>) => Record<string, unknown>;
};

describe("Gemini remote script diagnostics", () => {
  it("CASE 1 preserves a renderer exception message and stack", () => {
    const failure = normalizeRemoteFailure({ remoteError: { code: "GEMINI_REMOTE_SCRIPT_EXCEPTION", phase: "PRE_SUBMIT_DOM_SNAPSHOT", name: "TypeError", message: "selector exploded", stack: "TypeError: selector exploded" } }, { targetId: 12, commandPurpose: "CONTENT_PROJECT_DEVELOP" });
    expect(failure).toMatchObject({ code: "GEMINI_REMOTE_SCRIPT_EXCEPTION", phase: "PRE_SUBMIT_DOM_SNAPSHOT", name: "TypeError", message: "selector exploded", stack: "TypeError: selector exploded", targetId: 12, commandPurpose: "CONTENT_PROJECT_DEVELOP" });
  });

  it("CASE 2/3 reports stale context and wrong target without a generic message", () => {
    const stale = normalizeRemoteFailure(new Error("Execution context was destroyed"), { phase: "PRE_SUBMIT_DOM_SNAPSHOT", targetId: 4, executionContextId: null, pageReady: false, correctGeminiTab: false });
    expect(stale).toMatchObject({ phase: "PRE_SUBMIT_DOM_SNAPSHOT", targetId: 4, pageReady: false, correctGeminiTab: false });
  });

  it("CASE 4 retains selector diagnostics", () => {
    expect(normalizeRemoteFailure({ remoteError: { message: "missing" } }, { phase: "COMPOSER_DISCOVERY", selector: "[role=\"textbox\"]" })).toMatchObject({ selector: "[role=\"textbox\"]", phase: "COMPOSER_DISCOVERY" });
  });

  it("CASE 5 rejects non-serializable arguments before execution", () => {
    const circular: { self?: unknown } = {}; circular.self = circular;
    expect(isJsonSerializable({ value: 1 })).toBe(true);
    expect(isJsonSerializable({ value: BigInt(1) })).toBe(false);
    expect(isJsonSerializable(circular)).toBe(false);
  });

  it("CASE 6/7 wraps a ready valid remote expression with phase-aware capture", () => {
    const expression = wrapGeminiRemoteExpression("(() => ({ ready: true }))()", "PRE_SUBMIT_DOM_SNAPSHOT");
    expect(expression).toContain("GEMINI_REMOTE_SCRIPT_EXCEPTION");
    expect(expression).toContain("PRE_SUBMIT_DOM_SNAPSHOT");
  });

  it("regression: generated pre-submit snapshot is valid renderer JavaScript", () => {
    const source = readFileSync(new URL("./main.cjs", import.meta.url), "utf8");
    const start = source.indexOf("function geminiResponseSnapshotExpression()");
    const end = source.indexOf("\nfunction cdpEventIsoTime", start);
    const factory = vm.runInNewContext(`(${source.slice(start, end)})`) as () => string;
    expect(() => new Function(factory())).not.toThrow();
  });

  it("Content Project contract makes scenes canonical and rejects sourceScenes", () => {
    expect(sourceModelingSpecSchema.safeParse({ sourceScenes: [] }).success).toBe(false);
    const source = readFileSync(new URL("./main.cjs", import.meta.url), "utf8");
    expect(source).toContain('sourceModelingSpec MUST contain exactly the array key "scenes"');
    expect(source).toContain('Never use "sourceScenes"');
    expect(source).toContain("CONTENT_PROJECT_SCHEMA_INVALID: sourceModelingSpec.scenes must be an array");
  });

  it("schema repair is bounded, follows captured schema failure, and preserves content by contract", () => {
    const source = readFileSync(new URL("./main.cjs", import.meta.url), "utf8");
    expect(source).toContain('String(error || "").startsWith("CONTENT_PROJECT_SCHEMA_INVALID")');
    expect(source).toContain("ORIGINAL PARSED JSON:");
    expect(source).toContain("Preserve exactly the scene count, scene order, scene text, actionSequence content/order, camera constraints/intent, timing, character/source mapping");
    expect(source).toContain("if (!canRunFormatRetry(first))");
  });

  it("latency probes generate valid renderer expressions with real newline joins", () => {
    const source = readFileSync(new URL("./main.cjs", import.meta.url), "utf8");
    const pageStart = source.indexOf("function geminiLatencyPageStateExpression()");
    const pageEnd = source.indexOf("\nasync function captureGeminiLatencyPageState", pageStart);
    const pageFactory = vm.runInNewContext(`(${source.slice(pageStart, pageEnd)})`) as () => string;
    expect(() => new Function(pageFactory())).not.toThrow();
    const heartbeatStart = source.indexOf("function geminiLatencyHeartbeatSetupExpression()");
    const heartbeatEnd = source.indexOf("\nfunction geminiLatencyHeartbeatCollectExpression", heartbeatStart);
    const heartbeatFactory = vm.runInNewContext(`(() => { const GEMINI_LATENCY_HEARTBEAT_KEY = "__testHeartbeat"; return (${source.slice(heartbeatStart, heartbeatEnd)}); })()`) as () => string;
    expect(() => new Function(heartbeatFactory())).not.toThrow();
  });

  it("INCIDENT 1L completion diagnostics probe is valid and mutation-only", () => {
    const source = readFileSync(new URL("./main.cjs", import.meta.url), "utf8");
    const start = source.indexOf("function geminiCompletionDiagnosticsSetupExpression()");
    const end = source.indexOf("\nfunction geminiCompletionDiagnosticsCollectExpression", start);
    const setupFactory = vm.runInNewContext(`(() => { const GEMINI_COMPLETION_DIAGNOSTICS_KEY = "__testCompletionDiagnostics"; return (${source.slice(start, end)}); })()`) as () => string;
    expect(() => new Function(setupFactory())).not.toThrow();
    const collectStart = source.indexOf("function geminiCompletionDiagnosticsCollectExpression()");
    const collectEnd = source.indexOf("\nasync function finalizeGeminiLatency", collectStart);
    const collectFactory = vm.runInNewContext(`(() => { const GEMINI_COMPLETION_DIAGNOSTICS_KEY = "__testCompletionDiagnostics"; return (${source.slice(collectStart, collectEnd)}); })()`) as () => string;
    expect(() => new Function(collectFactory())).not.toThrow();
    expect(source).toContain("contentMutationCount");
    expect(source).toContain("nonContentMutationCount");
    expect(source).toContain("COMPLETION_DIAGNOSTICS_SETUP");
    expect(source).toContain("COMPLETION_DIAGNOSTICS_COLLECT");
  });

  it("INCIDENT 1H keeps retry pending through a bounded confirmation grace and final arbitration", () => {
    const source = readFileSync(new URL("./main.cjs", import.meta.url), "utf8");
    expect(source).toContain("const GEMINI_PRE_RETRY_CONFIRMATION_GRACE_MS = 2_000");
    expect(source).toContain("async function waitForPreRetryConfirmation");
    expect(source).toContain("command.markRetryEligible()");
    expect(source).toContain("authorizeGeminiSendRetry");
    expect(source).toContain("GEMINI_REMOTE_CONTEXT_RECOVERY_FAILED");
    expect(source).toContain("command.markSendRetry(retryReason, retrySnapshot)");
  });

  it("INCIDENT 1J adds read-only Page/Runtime/Target and navigation-initiator evidence", () => {
    const source = readFileSync(new URL("./main.cjs", import.meta.url), "utf8");
    expect(source).toContain("gemini-navigation-diagnostics.ndjson");
    expect(source).toContain("Page.frameNavigated");
    expect(source).toContain("Page.navigatedWithinDocument");
    expect(source).toContain("Runtime.executionContextCreated");
    expect(source).toContain("Runtime.executionContextDestroyed");
    expect(source).toContain("Runtime.executionContextsCleared");
    expect(source).toContain("Target.targetCreated");
    expect(source).toContain("Target.targetDestroyed");
    expect(source).toContain("Target.attachedToTarget");
    expect(source).toContain("Target.detachedFromTarget");
    expect(source).toContain("Runtime.addBinding");
    expect(source).toContain("normalizeDocumentNavigationRequest");
    expect(source).toContain("BEFORE_INITIAL_SEND");
    expect(source).toContain("sendDispatches");
    expect(source).toContain("performance.getEntriesByType('navigation')");
    expect(source).toContain("['keydown', 'beforeinput', 'input', 'keyup']");
    expect(source).toContain("isTrusted");
    expect(source).toContain("defaultPrevented");
    expect(source).toContain("activeElementIsComposer");
    expect(source).toContain("composerTextLength");
  });

  it("INCIDENT 1K local fixture records keyboard event sequence without mutating it", () => {
    const source = readFileSync(new URL("./main.cjs", import.meta.url), "utf8");
    const start = source.indexOf("function geminiNavigationDomHookExpression()");
    const end = source.indexOf("\nasync function installGeminiNavigationDomHooks", start);
    const factory = vm.runInNewContext(`(() => { const GEMINI_NAVIGATION_DOM_HOOK_KEY = "__testNavigationHooks"; const GEMINI_NAVIGATION_BINDING = "__testNavigationEvent"; return (${source.slice(start, end)}); })()`, { JSON }) as () => string;
    const events: Array<Record<string, unknown>> = [];
    const listeners: Record<string, Array<(event: Record<string, unknown>) => void>> = {};
    const editable = { tagName: "DIV", isConnected: true, getAttribute: (name: string) => name === "role" ? "textbox" : null, matches: () => true, closest: () => editable };
    const context = {
      JSON,
      globalThis: { __testNavigationEvent: (payload: string) => { events.push(JSON.parse(payload)); } },
      window: { addEventListener: (name: string, listener: (event: Record<string, unknown>) => void) => { (listeners[name] ||= []).push(listener); } },
      document: { activeElement: editable, visibilityState: "visible", hidden: false, hasFocus: () => true },
      location: { href: "https://gemini.google.com/app" },
    } as Record<string, unknown>;
    vm.runInNewContext(factory(), context);
    const baseEvent = { key: "Enter", code: "Enter", keyCode: 13, which: 13, isTrusted: true, defaultPrevented: false, repeat: false, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: editable };
    for (const eventName of ["keydown", "beforeinput", "input", "keyup"]) for (const listener of listeners[eventName] || []) listener({ ...baseEvent });
    expect(events.map((event) => event.event)).toEqual(["keydown", "keydown", "beforeinput", "beforeinput", "input", "input", "keyup", "keyup"]);
    expect(events.every((event) => event.isTrusted === true && event.defaultPrevented === false && event.activeElementIsComposer === true)).toBe(true);
  });
});
