/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { initializeUserData } = require("./user-data.cjs");
const { cleanupManagedTemporaryFiles } = require("./temp-cleanup.cjs");
initializeUserData(app);
try { cleanupManagedTemporaryFiles(app.getPath("userData")); } catch { /* Cleanup is bounded to the managed temporary directory. */ }
const { GeminiCommandLifecycle, hashText, createGeminiConversationResetError, redactNetworkUrl, normalizeNetworkInitiator, normalizeDocumentNavigationRequest, extractGeminiJsonCandidate, isGeminiGenerationRequest, findAttributedGeminiGenerationRequest, isGeminiTargetReady, isResponseComplete, canRunFormatRetry, isGenerationTerminal, assertParentTerminal, normalizeGeminiResponseSnapshot, buildGeminiBindingDiagnostic, buildGeminiResponseContentDiagnostic } = require("./gemini-browser-lifecycle.cjs");
const { isJsonSerializable, wrapGeminiRemoteExpression, normalizeRemoteFailure } = require("./gemini-remote-script.cjs");
const { EdgeGeminiRuntime, isFlowUrl } = require("./edge-gemini-cdp.cjs");
const { ensureSqliteReleaseSchema } = require("./sqlite-release-schema.cjs");
const { assertReadableAbsoluteFile, uploadWithEdgeFileChooser } = require("./gemini-edge-file-chooser.cjs");
const { serializeGeminiError } = require("./gemini-error-transport.cjs");
const { isAllowedExternalUrl } = require("./ipc-contract.cjs");
const { buildDevRuntimeIdentity, compareDevRuntimeIdentity } = require("./dev-runtime-identity.cjs");
const { conversationIdFromUrl, conversationNavigationDisposition, isBareGeminiAppUrl, normalizeConversationBinding, bindConversationFromUrl, markConversationStep, markConversationStale, assertConversationReady } = require("./gemini-conversation-lifecycle.cjs");

// Keep development Electron and the packaged desktop app on the same local data store.
if (app.isPackaged && !process.argv.some((value) => value.startsWith("--remote-debugging-port="))) {
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  app.commandLine.appendSwitch("remote-debugging-port", "0");
}

const PORT = 3210;
const APP_URL = process.env.DESKTOP_APP_URL || (app.isPackaged ? `http://127.0.0.1:${PORT}` : "http://localhost:3000");
const DEV_RUNTIME_IDENTITY = buildDevRuntimeIdentity({ root: path.resolve(__dirname, "..") });
const FACEBOOK_MEDIA_DISCOVERY_TIMEOUT_MS = 10_000;
const FACEBOOK_MEDIA_POLL_INTERVAL_MS = 100;
const GEMINI_PRE_RETRY_CONFIRMATION_GRACE_MS = 2_000;
const GEMINI_PRE_RETRY_CONFIRMATION_POLL_MS = 50;
const GEMINI_CONTEXT_RECOVERY_TIMEOUT_MS = 5_000;
const GEMINI_SEND_RECOVERY_SETTLE_MS = 750;
const GEMINI_GENERATION_START_TIMEOUT_MS = 15_000;
const GEMINI_GENERATION_START_POLL_MS = 100;
const GEMINI_CONVERSATION_REOPEN_STABILIZATION_MS = 3_000;
const GEMINI_CONVERSATION_REOPEN_POLL_MS = 100;
const DESKTOP_FLOW_BRIDGE_REVISION = "flow-recovery-v3";
let mainWindow;
let serverProcess;
let workerProcess;
let facebookWindow;
let geminiWindow;
let geminiLoadPromise;
let geminiSessionId;
let flowWindow;
let flowLoadPromise;
let flowRemoteClient;
let isQuitting = false;
let fatalRuntimeReported = false;
let desktopFlowBridgeTimer;
let desktopFlowBridgeBusy = false;
let lastDesktopFlowBridgeErrorAt = 0;
let activeDesktopFlowBridgeContext = {};
let flowOperationTail = Promise.resolve();
let geminiOperationTail = Promise.resolve();
let geminiThrottleUntil = 0;
let geminiThrottleLevel = 0;
let browserActionSequence = 0;
let geminiNetworkObserver;
let geminiNavigationObserver;
const GEMINI_LATENCY_HEARTBEAT_KEY = "__modelingAiGeminiLatencyHeartbeat";
const GEMINI_COMPLETION_DIAGNOSTICS_KEY = "__modelingAiGeminiCompletionDiagnostics";
const GEMINI_NAVIGATION_DOM_HOOK_KEY = "__modelingAiGeminiNavigationHooks";
const GEMINI_NAVIGATION_BINDING = "__modelingAiGeminiNavigationEvent";

function getMainWindow() { return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null; }
function getGeminiWindow() { return geminiWindow && !geminiWindow.isDestroyed() ? geminiWindow : null; }
function getFlowWindow() { return flowWindow && !flowWindow.isDestroyed() ? flowWindow : null; }

const FLOW_HOME_URL = "https://flow.google.com/?pli=1";
const FLOW_STATE_TIMEOUTS = Object.freeze({
  FLOW_WINDOW_STARTING: 15_000,
  FLOW_PAGE_LOADING: 60_000,
  FLOW_SESSION_CHECK: 15_000,
  FLOW_HOME_READY: 30_000,
  FLOW_PROJECT_CREATING: 30_000,
  FLOW_PROJECT_LOADING: 60_000,
  FLOW_PROJECT_READY: 30_000,
});
const MANUAL_FLOW_HANDOFF_MEDIA_TIMEOUT_MS = 45_000;

async function withTimeout(promise, timeoutMs, errorCode) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function safeSendToRenderer(target, channel, payload) {
  const sender = target?.sender ?? target?.webContents ?? target;
  if (!sender || typeof sender.send !== "function" || (typeof sender.isDestroyed === "function" && sender.isDestroyed())) {
    console.warn("[IPC_TARGET_UNAVAILABLE]", channel);
    return false;
  }
  try {
    sender.send(channel, payload);
    return true;
  } catch (error) {
    console.warn("[IPC_TARGET_UNAVAILABLE]", channel, error?.message || error);
    return false;
  }
}

function sendProgress(target, channel, payload) {
  return safeSendToRenderer(target, channel, payload);
}

function safeSendInputEvent(window, event) {
  if (!window || window.isDestroyed() || !window.webContents || window.webContents.isDestroyed()) {
    console.warn("[IPC_TARGET_UNAVAILABLE] input-event");
    return false;
  }
  try { window.webContents.sendInputEvent(event); return true; }
  catch (error) { console.warn("[IPC_TARGET_UNAVAILABLE] input-event", error?.message || error); return false; }
}

function browserFailureRoot() {
  const root = path.join(app.getPath("userData"), "browser-failures");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function browserSafeName(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "unknown";
}

function recordBrowserAction(action) {
  try {
    const entry = {
      sequence: ++browserActionSequence,
      at: new Date().toISOString(),
      jobId: activeDesktopFlowBridgeContext.codexJobId || activeDesktopFlowBridgeContext.bridgeJobId || null,
      stage: activeDesktopFlowBridgeContext.stage || null,
      ...redactDesktopRuntime(action),
    };
    fs.appendFileSync(path.join(app.getPath("userData"), "browser-actions.ndjson"), `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch { /* Diagnostics must never stop browser automation. */ }
}

function persistGeminiRawResponseEvidence(evidence) {
  try {
    const filePath = path.join(app.getPath("userData"), "gemini-response-evidence.ndjson");
    fs.appendFileSync(filePath, `${JSON.stringify(evidence)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch { /* Evidence persistence must never replace the original Gemini error. */ }
}

function createGeminiCommand({ purpose, prompt, parentCommandId = null }) {
  if (!geminiSessionId) geminiSessionId = crypto.randomUUID();
  return new GeminiCommandLifecycle({
    sessionId: geminiSessionId,
    purpose,
    prompt,
    parentCommandId,
    persist: (event) => recordBrowserAction({ action: "gemini-command-lifecycle", ...event }),
  });
}

function geminiResponseSnapshotExpression() {
  return `(() => {
    const roots = [document]; const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
    const all = () => [...new Set(roots.flatMap((root) => [...root.querySelectorAll('*')]))];
    const selector = 'model-response, message-content, [data-message-author-role="model"]';
    const userSelector = '[data-message-author-role="user"], [data-author-role="user"], user-query, user-message, [data-testid*="user-message"]';
    const finalSelector = 'message-content, [data-message-content], [data-response-content], [data-testid*="markdown"], [data-testid*="response"], [class*="markdown"], [class*="response-content"]';
    const statusSelector = '[role="status"], [aria-live], [aria-busy="true"], [role="progressbar"], mat-progress-spinner';
    const streamingSelector = '[aria-busy="true"], [role="progressbar"], mat-progress-spinner';
    const visible = (element) => { const bounds = element?.getBoundingClientRect?.(); const style = element ? getComputedStyle(element) : null; return Boolean(element && element.isConnected && bounds && bounds.width > 0 && bounds.height > 0 && style?.visibility !== 'hidden' && style?.display !== 'none' && !closestAcrossShadow(element, '[aria-hidden="true"]')); };
    const hashText = (value) => { let hash = 2166136261; for (const character of String(value || '')) { hash ^= character.codePointAt(0) || 0; hash = Math.imul(hash, 16777619); } return ` + "`fnv1a-${hash >>> 0}`" + `; };
    const parentAcrossShadow = (element) => element?.parentElement || element?.getRootNode?.()?.host || null;
    const closestAcrossShadow = (element, query) => { let current = element; while (current) { if (current.matches?.(query)) return current; current = parentAcrossShadow(current); } return null; };
    const identity = (element) => { if (!element) return null; for (const attribute of ['data-message-id', 'data-turn-id', 'data-testid', 'id']) { const value = element.getAttribute?.(attribute); if (value) return element.tagName.toLowerCase() + ':' + attribute + '=' + value; } const parts = []; let current = element; while (current && current.nodeType === 1 && parts.length < 12) { const parent = parentAcrossShadow(current); const index = parent?.children ? [...parent.children].indexOf(current) : 0; parts.unshift(current.tagName.toLowerCase() + ':' + index); current = parent; } return parts.join('/'); };
    const ancestors = (element) => { const values = []; let current = parentAcrossShadow(element); while (current && values.length < 6) { values.push({ tag: current.tagName.toLowerCase(), id: current.id || null, role: current.getAttribute?.('role') || null, authorRole: current.getAttribute?.('data-message-author-role') || null, ariaLabel: current.getAttribute?.('aria-label') || null, className: typeof current.className === 'string' ? current.className.slice(0, 200) : null }); current = parentAcrossShadow(current); } return values; };
    const turnRoot = (element) => { const modelRoot = closestAcrossShadow(element, 'model-response, [data-message-author-role="model"]'); if (modelRoot) return modelRoot; let current = element; while (parentAcrossShadow(current)?.matches?.('message-content')) current = parentAcrossShadow(current); return current; };
    const userTurnRoot = (element) => closestAcrossShadow(element, userSelector) || element;
    const roleOf = (turn) => turn.getAttribute?.('data-message-author-role') || closestAcrossShadow(turn, '[data-message-author-role]')?.getAttribute?.('data-message-author-role') || (turn.matches?.('model-response, message-content') ? 'model' : null);
    const textOf = (element) => String(element?.innerText || element?.textContent || '');
    const userPromptTextOf = (element) => { const lines = [...(element?.querySelectorAll?.('.query-text-line') || [])].map(textOf).filter((value) => value.trim()); return lines.length ? lines.join('\\n') : textOf(element); };
    const insideComposer = (element) => Boolean(closestAcrossShadow(element, '[contenteditable="true"], textarea, [role="textbox"]'));
    const statusLike = (element) => Boolean(element?.matches?.(statusSelector) || closestAcrossShadow(element, streamingSelector));
    const accessibilityChrome = (element) => Boolean((element?.hasAttribute?.('aria-label') || element?.hasAttribute?.('title')) && !element?.matches?.(finalSelector));
    const contentDepth = (element, turn) => { let depth = 0; let current = element; while (current && current !== turn) { depth += 1; current = parentAcrossShadow(current); } return depth; };
    const elements = [...new Set(roots.flatMap((root) => [...root.querySelectorAll(selector)]))];
    const nodeMetadata = (node, turn, orderIndex) => { const bounds = node.getBoundingClientRect?.(); const text = textOf(node); const className = typeof node.className === 'string' ? node.className : ''; const dataAttributeNames = [...(node.attributes || [])].map((attribute) => attribute.name).filter((name) => name.startsWith('data-')).slice(0, 24); return { candidateId: identity(node), parentTurnId: identity(turn), domPath: identity(node), selector: node.matches?.('message-content') ? 'message-content' : node.hasAttribute?.('data-message-content') ? '[data-message-content]' : node.hasAttribute?.('data-response-content') ? '[data-response-content]' : node.getAttribute?.('data-testid') ? '[data-testid]' : null, tag: node.tagName.toLowerCase(), role: node.getAttribute?.('role') || null, className: className.slice(0, 200), dataAttributeNames, visible: visible(node), attached: Boolean(node.isConnected), detached: !node.isConnected, ariaHidden: Boolean(closestAcrossShadow(node, '[aria-hidden="true"]')), zeroSize: Boolean(!bounds || bounds.width <= 0 || bounds.height <= 0), boundingBox: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null, text, textLength: text.length, textHash: hashText(text), orderIndex, ancestorMetadata: ancestors(node), insideComposer: insideComposer(node), statusLike: statusLike(node), accessibilityChrome: accessibilityChrome(node), isMessageContent: node.matches?.('message-content') === true || node.hasAttribute?.('data-message-content') === true, hasResponseData: node.hasAttribute?.('data-response-content') === true, hasMarkdownClass: /markdown/i.test(className), hasMarkdownTestId: /markdown/i.test(node.getAttribute?.('data-testid') || ''), isMarkdownContainer: /markdown/i.test(className) || /markdown/i.test(node.getAttribute?.('data-testid') || ''), isPre: node.tagName?.toLowerCase() === 'pre', isCode: node.tagName?.toLowerCase() === 'code', contentDepth: contentDepth(node, turn) }; };
    const candidates = elements.map((element, orderIndex) => { const turn = turnRoot(element); const bounds = element.getBoundingClientRect?.(); const turnBounds = turn.getBoundingClientRect?.(); const turnText = textOf(turn); const turnNodes = all().filter((node) => turnRoot(node) === turn); const contentCandidates = turnNodes.filter((node) => node.matches?.(finalSelector)).map((node, nodeIndex) => nodeMetadata(node, turn, nodeIndex)); const statusText = turnNodes.filter((node) => statusLike(node) || accessibilityChrome(node)).map(textOf).filter(Boolean).join('\\n'); const stopButtonPresent = turnNodes.filter((node) => node.tagName?.toLowerCase() === 'button').some((button) => /stop|dừng/i.test([button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent].filter(Boolean).join(' ')) && visible(button)); const streamingIndicatorPresent = turnNodes.some((node) => node.matches?.(streamingSelector) && visible(node)); return { candidateId: identity(element), parentTurnId: identity(turn), parentContainerId: identity(parentAcrossShadow(turn)), domPath: identity(element), tag: element.tagName.toLowerCase(), role: roleOf(turn), visible: visible(element), attached: Boolean(element.isConnected), detached: !element.isConnected, ariaHidden: Boolean(closestAcrossShadow(element, '[aria-hidden="true"]')), zeroSize: Boolean(!bounds || bounds.width <= 0 || bounds.height <= 0), boundingBox: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null, text: turnText, textLength: turnText.length, textHash: hashText(turnText), orderIndex, isTurnRoot: element === turn, ancestorMetadata: ancestors(element), turnBoundingBox: turnBounds ? { x: turnBounds.x, y: turnBounds.y, width: turnBounds.width, height: turnBounds.height } : null, turnTextLength: turnText.length, turnTextHash: hashText(turnText), turnVisible: visible(turn), turnAttached: Boolean(turn.isConnected), turnAriaHidden: Boolean(closestAcrossShadow(turn, '[aria-hidden="true"]')), turnZeroSize: Boolean(!turnBounds || turnBounds.width <= 0 || turnBounds.height <= 0), insideComposer: insideComposer(element), insidePreviousAssistantTurn: false, existedBeforeSubmit: false, appearedAfterSubmit: true, stopButtonPresent, streamingIndicatorPresent, statusText, statusTextHash: hashText(statusText), contentCandidates, contentExtractionAvailable: true }; });
    const composers = roots.flatMap((root) => [...root.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]')]).filter(visible);
    const composerReady = Boolean(composers.find((composer) => !String(composer.value || composer.innerText || '').trim()));
    const stopButtonPresent = roots.flatMap((root) => [...root.querySelectorAll('button')]).some((element) => /stop|dừng/i.test([element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).join(' ')) && visible(element));
    const streamingIndicatorPresent = roots.flatMap((root) => [...root.querySelectorAll('[aria-busy="true"], [role="progressbar"], mat-progress-spinner')]).some(visible);
    const assistantTurnCount = elements.length;
    const userElements = [...new Set(roots.flatMap((root) => [...root.querySelectorAll(userSelector)]))];
    const userTurns = [...new Set(userElements.map(userTurnRoot))].filter(visible).map((turn, orderIndex) => { const text = userPromptTextOf(turn); return { turnId: identity(turn), candidateId: identity(turn), textHash: hashText(text), normalizedTextHash: hashText(String(text || '').normalize('NFKC').replace(/\\s+/g, ' ').trim()), textLength: text.length, visible: visible(turn), attached: Boolean(turn.isConnected), orderIndex }; });
    const userTurnCount = userTurns.length;
    const conversationMeta = { conversationUrl: location.href, assistantTurnCount, userTurnCount, userTurns, approximateMessageNodeCount: assistantTurnCount + userTurnCount, userMessagePresent: userTurnCount > 0, conversationMode: assistantTurnCount + userTurnCount > 0 ? 'EXISTING' : 'NEW' };
    return { candidates, composerReady, stopButtonPresent, streamingIndicatorPresent, ...conversationMeta, domSnapshotSummary: { url: location.href, title: document.title, candidateCount: candidates.length, attachedCandidateCount: candidates.filter((candidate) => candidate.attached).length } };
  })()`;
}

function cdpEventIsoTime(params) {
  return Number.isFinite(params?.wallTime) ? new Date(params.wallTime * 1_000).toISOString() : new Date().toISOString();
}

async function startGeminiNetworkObserver(window, command) {
  if (geminiNetworkObserver?.window === window) return geminiNetworkObserver;
  try {
    const remoteDebugger = window?.webContents?.debugger;
    if (!remoteDebugger) return null;
    const attachedByInstrumentation = !remoteDebugger.isAttached();
    if (attachedByInstrumentation) remoteDebugger.attach("1.3");
    await remoteDebugger.sendCommand("Network.enable");
    const requests = new Map();
    const onMessage = (_event, method, params = {}) => {
      if (method === "Network.requestWillBeSent") {
        const commandId = command?.snapshot().commandId || null;
        const sessionId = command?.snapshot().sessionId || null;
        const request = { requestId: params.requestId, commandId, sessionId, url: redactNetworkUrl(params.request?.url), method: params.request?.method || null, resourceType: params.type || null, startedAt: cdpEventIsoTime(params), responseHeadersAt: null, firstDataAt: null, finishedAt: null, failedAt: null, loaderId: params.loaderId || null, frameId: params.frameId || null, documentURL: redactNetworkUrl(params.documentURL), initiator: normalizeNetworkInitiator(params.initiator), redirectResponsePresent: Boolean(params.redirectResponse), hasUserGesture: params.hasUserGesture === true ? true : params.hasUserGesture === false ? false : null, mixedContentType: typeof params.mixedContentType === "string" ? params.mixedContentType : null, referrerPolicy: typeof params.request?.referrerPolicy === "string" ? params.request.referrerPolicy : null, type: params.type || null };
        requests.set(params.requestId, request);
        if (params.type === "Document" && geminiNavigationObserver?.commandId === commandId && geminiNavigationObserver?.sessionId === sessionId) geminiNavigationObserver.documentRequests.push(normalizeDocumentNavigationRequest(params));
      } else if (method === "Network.responseReceived") {
        const request = requests.get(params.requestId);
        if (request && !request.responseHeadersAt) request.responseHeadersAt = cdpEventIsoTime(params);
      } else if (method === "Network.dataReceived") {
        const request = requests.get(params.requestId);
        if (request && !request.firstDataAt && (Number(params.dataLength || 0) > 0 || Number(params.encodedDataLength || 0) > 0)) request.firstDataAt = cdpEventIsoTime(params);
      } else if (method === "Network.loadingFinished") {
        const request = requests.get(params.requestId);
        if (request && !request.finishedAt) request.finishedAt = cdpEventIsoTime(params);
      } else if (method === "Network.loadingFailed") {
        const request = requests.get(params.requestId);
        if (request && !request.failedAt) request.failedAt = cdpEventIsoTime(params);
      }
    };
    remoteDebugger.on("message", onMessage);
    geminiNetworkObserver = { window, remoteDebugger, attachedByInstrumentation, requests, onMessage };
    return geminiNetworkObserver;
  } catch {
    geminiNetworkObserver = null;
    return null;
  }
}

function navigationEventTimestamp(params = {}) {
  return Number.isFinite(params.wallTime) ? new Date(params.wallTime * 1_000).toISOString() : new Date().toISOString();
}

function recordGeminiNavigationEvent(observer, event) {
  if (!observer) return;
  observer.events.push({ at: event.at || new Date().toISOString(), ...event });
}

function geminiNavigationDomHookExpression() {
  return `(() => {
    const hookKey = ${JSON.stringify(GEMINI_NAVIGATION_DOM_HOOK_KEY)};
    const bindingName = ${JSON.stringify(GEMINI_NAVIGATION_BINDING)};
    if (globalThis[hookKey]?.installed) return { installed: true, alreadyInstalled: true };
    const composerSelector = '[contenteditable="true"], textarea, [role="textbox"]';
    const textLength = (element) => element ? String(element.value || element.innerText || element.textContent || '').length : null;
    const elementMeta = (element) => ({ tag: element?.tagName?.toLowerCase() || null, role: element?.getAttribute?.('role') || null, connected: Boolean(element?.isConnected) });
    const emit = (event, details = {}) => {
      const payload = JSON.stringify({ event, url: location.href, visibilityState: document.visibilityState || null, hidden: document.hidden === true, ...details });
      try {
        const binding = globalThis[bindingName];
        const result = typeof binding === 'function' ? binding(payload) : null;
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch { /* Navigation diagnostics must never affect the page lifecycle. */ }
    };
    for (const event of ['beforeunload', 'pagehide', 'visibilitychange', 'unload']) window.addEventListener(event, () => emit(event), { capture: true, passive: true });
    for (const eventName of ['keydown', 'beforeinput', 'input', 'keyup']) {
      const observe = (event, phase) => { const active = document.activeElement; const target = event.target; const composer = target?.closest?.(composerSelector) || active?.closest?.(composerSelector) || (active?.matches?.(composerSelector) ? active : null); emit(eventName, { phase, key: event.key || null, code: event.code || null, keyCode: Number.isFinite(event.keyCode) ? event.keyCode : null, which: Number.isFinite(event.which) ? event.which : null, inputType: event.inputType || null, isTrusted: event.isTrusted === true, defaultPrevented: event.defaultPrevented === true, repeat: event.repeat === true, ctrlKey: event.ctrlKey === true, metaKey: event.metaKey === true, shiftKey: event.shiftKey === true, altKey: event.altKey === true, target: elementMeta(target), activeElement: elementMeta(active), activeElementIsComposer: Boolean(active && (active.matches?.(composerSelector) || active.closest?.(composerSelector))), documentHasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null, composerTextLength: textLength(composer) }); };
      window.addEventListener(eventName, (event) => observe(event, 'capture'), { capture: true, passive: true });
      window.addEventListener(eventName, (event) => observe(event, 'bubble'), { capture: false, passive: true });
    }
    globalThis[hookKey] = { installed: true };
    return { installed: true, alreadyInstalled: false };
  })()`;
}

async function installGeminiNavigationDomHooks(window, observer) {
  if (!observer || !window?.webContents || window.webContents.isDestroyed()) return false;
  try {
    if (!observer.bindingEnabled) {
      await observer.remoteDebugger.sendCommand("Runtime.addBinding", { name: GEMINI_NAVIGATION_BINDING });
      observer.bindingEnabled = true;
    }
  } catch (error) {
    if (/already exists/i.test(error?.message || "")) observer.bindingEnabled = true;
    else observer.errors.push({ at: new Date().toISOString(), phase: "RUNTIME_ADD_BINDING", message: error?.message || String(error) });
  }
  if (!observer.bindingEnabled) return false;
  try {
    await window.webContents.executeJavaScript(geminiNavigationDomHookExpression(), true);
    observer.domHookInstallCount += 1;
    return true;
  } catch (error) {
    observer.errors.push({ at: new Date().toISOString(), phase: "DOM_HOOK_INSTALL", message: error?.message || String(error) });
    return false;
  }
}

function navigationFrameSummary(frame) {
  return {
    frameId: frame?.id || null,
    parentId: frame?.parentId || null,
    loaderId: frame?.loaderId || null,
    url: redactNetworkUrl(frame?.url),
    name: typeof frame?.name === "string" ? frame.name.slice(0, 200) : null,
    type: typeof frame?.type === "string" ? frame.type : null,
  };
}

function navigationTargetSummary(targetInfo = {}) {
  return {
    targetId: targetInfo.targetId || null,
    type: targetInfo.type || null,
    url: redactNetworkUrl(targetInfo.url),
    attached: targetInfo.attached === true ? true : targetInfo.attached === false ? false : null,
  };
}

async function snapshotGeminiNavigationIdentity(window, observer, phase) {
  if (!observer) return null;
  const snapshot = {
    phase,
    at: new Date().toISOString(),
    webContentsId: window?.webContents?.id ?? null,
    url: window?.webContents && !window.webContents.isDestroyed() ? redactNetworkUrl(window.webContents.getURL()) : null,
    loading: window?.webContents && !window.webContents.isDestroyed() ? Boolean(window.webContents.isLoading()) : null,
    targetId: null,
    targetType: null,
    targetUrl: null,
    targetAttached: null,
    frameId: null,
    parentFrameId: null,
    loaderId: null,
    frameUrl: null,
    executionContextId: null,
    documentReadyState: null,
  };
  try {
    const target = await observer.remoteDebugger.sendCommand("Target.getTargetInfo");
    Object.assign(snapshot, { ...navigationTargetSummary(target?.targetInfo), targetType: target?.targetInfo?.type || null, targetUrl: redactNetworkUrl(target?.targetInfo?.url) });
  } catch (error) { observer.errors.push({ at: new Date().toISOString(), phase: "TARGET_GET_TARGET_INFO", message: error?.message || String(error) }); }
  try {
    const tree = await observer.remoteDebugger.sendCommand("Page.getFrameTree");
    const frame = navigationFrameSummary(tree?.frameTree?.frame);
    Object.assign(snapshot, { frameId: frame.frameId, parentFrameId: frame.parentId, loaderId: frame.loaderId, frameUrl: frame.url });
  } catch (error) { observer.errors.push({ at: new Date().toISOString(), phase: "PAGE_GET_FRAME_TREE", message: error?.message || String(error) }); }
  try {
    const result = await observer.remoteDebugger.sendCommand("Runtime.evaluate", { expression: "({ url: location.href, readyState: document.readyState })", returnByValue: true });
    snapshot.executionContextId = result?.result?.executionContextId ?? null;
    snapshot.documentReadyState = result?.result?.value?.readyState || null;
    snapshot.url = redactNetworkUrl(result?.result?.value?.url) || snapshot.url;
  } catch (error) { observer.errors.push({ at: new Date().toISOString(), phase: "RUNTIME_IDENTITY_SNAPSHOT", message: error?.message || String(error) }); }
  observer.contextSnapshots.push(snapshot);
  return snapshot;
}

async function startGeminiNavigationObserver(window, command) {
  if (geminiNavigationObserver?.window === window) return geminiNavigationObserver;
  const remoteDebugger = window?.webContents?.debugger;
  if (!remoteDebugger) return null;
  const observer = {
    window,
    remoteDebugger,
    attachedByInstrumentation: !remoteDebugger.isAttached(),
    targetDiscoveryEnabled: false,
    bindingEnabled: false,
    domHookInstallCount: 0,
    events: [],
    documentRequests: [],
    contextSnapshots: [],
    sendSnapshots: [],
    sendDispatches: [],
    errors: [],
    detachEvents: [],
    commandId: command?.snapshot().commandId || null,
    sessionId: command?.snapshot().sessionId || null,
  };
  try {
    if (observer.attachedByInstrumentation) remoteDebugger.attach("1.3");
    geminiNavigationObserver = observer;
    const onMessage = (_event, method, params = {}) => {
      const at = navigationEventTimestamp(params);
      if (method === "Page.frameNavigated") {
        const frame = navigationFrameSummary(params.frame);
        recordGeminiNavigationEvent(observer, { at, event: method, ...frame });
      } else if (method === "Page.frameStartedLoading" || method === "Page.frameStoppedLoading") {
        recordGeminiNavigationEvent(observer, { at, event: method, frameId: params.frameId || null });
      } else if (method === "Page.lifecycleEvent") {
        recordGeminiNavigationEvent(observer, { at, event: method, frameId: params.frameId || null, loaderId: params.loaderId || null, name: params.name || null, cdpTimestamp: Number.isFinite(params.timestamp) ? params.timestamp : null });
      } else if (method === "Page.domContentEventFired" || method === "Page.loadEventFired") {
        recordGeminiNavigationEvent(observer, { at, event: method, cdpTimestamp: Number.isFinite(params.timestamp) ? params.timestamp : null });
        void installGeminiNavigationDomHooks(window, observer);
      } else if (method === "Page.navigatedWithinDocument") {
        recordGeminiNavigationEvent(observer, { at, event: method, frameId: params.frameId || null, url: redactNetworkUrl(params.url), navigationType: params.navigationType || null });
      } else if (method === "Runtime.executionContextCreated") {
        recordGeminiNavigationEvent(observer, { at, event: method, executionContextId: params.context?.id ?? null, frameId: params.context?.auxData?.frameId || null, origin: redactNetworkUrl(params.context?.origin), isDefault: params.context?.auxData?.isDefault === true ? true : params.context?.auxData?.isDefault === false ? false : null });
        if (params.context?.auxData?.isDefault === true) void installGeminiNavigationDomHooks(window, observer);
      } else if (method === "Runtime.executionContextDestroyed") {
        recordGeminiNavigationEvent(observer, { at, event: method, executionContextId: params.executionContextId ?? null });
      } else if (method === "Runtime.executionContextsCleared") {
        recordGeminiNavigationEvent(observer, { at, event: method });
      } else if (method === "Target.targetCreated" || method === "Target.targetInfoChanged") {
        recordGeminiNavigationEvent(observer, { at, event: method, ...navigationTargetSummary(params.targetInfo || params.target || {}) });
      } else if (method === "Target.targetDestroyed") {
        recordGeminiNavigationEvent(observer, { at, event: method, targetId: params.targetId || null });
      } else if (method === "Target.attachedToTarget") {
        recordGeminiNavigationEvent(observer, { at, event: method, targetId: params.targetInfo?.targetId || null, type: params.targetInfo?.type || null, url: redactNetworkUrl(params.targetInfo?.url), attached: true, sessionId: params.sessionId || null });
      } else if (method === "Target.detachedFromTarget") {
        recordGeminiNavigationEvent(observer, { at, event: method, targetId: params.targetId || null, sessionId: params.sessionId || null });
      } else if (method === "Runtime.bindingCalled" && params.name === GEMINI_NAVIGATION_BINDING) {
        try {
          const payload = JSON.parse(String(params.payload || "{}"));
          recordGeminiNavigationEvent(observer, { at, event: `DOM.${payload.event || "unknown"}`, executionContextId: params.executionContextId ?? null, url: redactNetworkUrl(payload.url), visibilityState: payload.visibilityState || null, hidden: payload.hidden === true });
        } catch (error) { observer.errors.push({ at, phase: "RUNTIME_BINDING_PAYLOAD", message: error?.message || String(error) }); }
      }
    };
    const onDetach = (_event, reason) => {
      const at = new Date().toISOString();
      observer.detachEvents.push({ at, reason: reason || null });
      recordGeminiNavigationEvent(observer, { at, event: "Debugger.detached", reason: reason || null });
    };
    observer.onMessage = onMessage;
    observer.onDetach = onDetach;
    remoteDebugger.on("message", onMessage);
    remoteDebugger.on("detach", onDetach);
    for (const method of ["Page.enable", "Runtime.enable"]) {
      try { await remoteDebugger.sendCommand(method); }
      catch (error) { observer.errors.push({ at: new Date().toISOString(), phase: method, message: error?.message || String(error) }); }
    }
    try {
      await remoteDebugger.sendCommand("Target.setDiscoverTargets", { discover: true });
      observer.targetDiscoveryEnabled = true;
    } catch (error) { observer.errors.push({ at: new Date().toISOString(), phase: "Target.setDiscoverTargets", message: error?.message || String(error) }); }
    await snapshotGeminiNavigationIdentity(window, observer, "BEFORE_SUBMIT");
    await installGeminiNavigationDomHooks(window, observer);
    return observer;
  } catch (error) {
    observer.errors.push({ at: new Date().toISOString(), phase: "NAVIGATION_OBSERVER_START", message: error?.message || String(error) });
    try { remoteDebugger.removeListener("message", observer.onMessage); } catch { /* Best-effort cleanup. */ }
    try { remoteDebugger.removeListener("detach", observer.onDetach); } catch { /* Best-effort cleanup. */ }
    if (observer.attachedByInstrumentation) { try { remoteDebugger.detach(); } catch { /* Best-effort cleanup. */ } }
    geminiNavigationObserver = null;
    return null;
  }
}

function geminiSendElementSnapshotExpression() {
  return `(() => {
    const visible = (element) => { const rect = element?.getBoundingClientRect?.(); const style = element ? getComputedStyle(element) : null; return Boolean(element && element.isConnected && rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden'); };
    const composerSelector = '[contenteditable="true"], textarea, [role="textbox"]';
    const composer = [...document.querySelectorAll(composerSelector)].find(visible) || null;
    const active = document.activeElement;
    const sendButton = [...document.querySelectorAll('button, [role="button"]')].find((element) => visible(element) && /^(send|gửi|submit)$/i.test(String(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').trim())) || null;
    const sendElement = active && (active.matches?.(composerSelector) || active.closest?.(composerSelector)) ? active : sendButton || active || composer;
    const safeUrl = (value) => { try { const url = new URL(String(value || ''), location.href); return url.origin + url.pathname; } catch { return null; } };
    const meta = (element) => { const form = element?.closest?.('form') || null; return { tag: element?.tagName?.toLowerCase() || null, role: element?.getAttribute?.('role') || null, type: element?.getAttribute?.('type') || null, disabled: element?.disabled === true ? true : element?.disabled === false ? false : null, connected: Boolean(element?.isConnected), formId: form?.id || null, formAction: safeUrl(form?.action), formMethod: form?.method || null }; };
    const composerForm = composer?.closest?.('form') || null;
    const sendForm = sendElement?.closest?.('form') || null;
    return { sendMechanism: 'KEYBOARD', keySent: 'ENTER', sendElement: meta(sendElement), composer: { ...meta(composer), contentEditable: composer?.isContentEditable === true }, form: { id: sendForm?.id || null, action: safeUrl(sendForm?.action), method: sendForm?.method || null, target: sendForm?.target || null }, sendAndComposerSameForm: composerForm && sendForm ? composerForm === sendForm : null };
  })()`;
}

async function captureGeminiSendElementSnapshot(window, command, phase) {
  const observer = geminiNavigationObserver;
  if (!observer || !window?.webContents || window.webContents.isDestroyed()) return null;
  try {
    const snapshot = await window.webContents.executeJavaScript(geminiSendElementSnapshotExpression(), true);
    observer.sendSnapshots.push({ at: new Date().toISOString(), phase, ...snapshot });
    return snapshot;
  } catch (error) {
    observer.errors.push({ at: new Date().toISOString(), phase: `SEND_SNAPSHOT_${phase}`, message: error?.message || String(error) });
    observer.sendSnapshots.push({ at: new Date().toISOString(), phase, snapshot: null });
    return null;
  }
}

function dispatchGeminiEnter(window, command, phase) {
  const attemptedAt = new Date().toISOString();
  const keyDownResult = safeSendInputEvent(window, { type: "keyDown", keyCode: "ENTER" });
  const keyUpResult = safeSendInputEvent(window, { type: "keyUp", keyCode: "ENTER" });
  const returnedAt = new Date().toISOString();
  const dispatch = { at: returnedAt, phase, attemptedAt, returnedAt, result: keyDownResult && keyUpResult ? "PASS" : "FAIL", keyDownResult, keyUpResult, targetConnectedAfterDispatch: null };
  if (geminiNavigationObserver) {
    geminiNavigationObserver.sendDispatches.push(dispatch);
    if (window?.webContents && !window.webContents.isDestroyed()) {
      void window.webContents.executeJavaScript("Boolean(document.activeElement && document.activeElement.isConnected)", true).then((connected) => { dispatch.targetConnectedAfterDispatch = connected === true; }).catch(() => {});
    }
  }
  recordBrowserAction({ action: "gemini-send-dispatch", commandId: command?.snapshot().commandId || null, sessionId: command?.snapshot().sessionId || null, phase, attemptedAt, returnedAt, result: dispatch.result, keyDownResult, keyUpResult });
  return keyDownResult && keyUpResult;
}

function persistGeminiNavigationDiagnostic(window, command, observer) {
  if (!observer) return null;
  const filePath = path.join(app.getPath("userData"), "gemini-navigation-diagnostics.ndjson");
  const metadata = command.snapshot();
  const evidence = {
    evidenceVersion: "gemini-navigation-v1",
    capturedAt: new Date().toISOString(),
    commandId: metadata.commandId,
    sessionId: metadata.sessionId,
    purpose: metadata.purpose,
    promptHash: metadata.promptHash,
    contextSnapshots: observer.contextSnapshots,
    events: observer.events,
    documentRequests: observer.documentRequests,
    sendSnapshots: observer.sendSnapshots,
    sendDispatches: observer.sendDispatches,
    cdp: { attachedByInstrumentation: observer.attachedByInstrumentation, targetDiscoveryEnabled: observer.targetDiscoveryEnabled, detachEvents: observer.detachEvents, errors: observer.errors, domHookInstallCount: observer.domHookInstallCount },
    finalWindow: { webContentsId: window?.webContents?.id ?? null, url: window?.webContents && !window.webContents.isDestroyed() ? redactNetworkUrl(window.webContents.getURL()) : null, loading: window?.webContents && !window.webContents.isDestroyed() ? Boolean(window.webContents.isLoading()) : null },
  };
  try { fs.appendFileSync(filePath, `${JSON.stringify(redactDesktopRuntime(evidence))}\n`, { encoding: "utf8", mode: 0o600 }); }
  catch (error) { observer.errors.push({ at: new Date().toISOString(), phase: "NAVIGATION_EVIDENCE_PERSISTENCE", message: error?.message || String(error) }); }
  recordBrowserAction({ action: "gemini-navigation-diagnostic", commandId: metadata.commandId, sessionId: metadata.sessionId, purpose: metadata.purpose, promptHash: metadata.promptHash, evidencePath: filePath });
  return filePath;
}

async function finishGeminiNavigationObserver(window, command) {
  const observer = geminiNavigationObserver;
  if (!observer) return null;
  await snapshotGeminiNavigationIdentity(window, observer, "AFTER_COMMAND");
  if (observer.targetDiscoveryEnabled) {
    try { await observer.remoteDebugger.sendCommand("Target.setDiscoverTargets", { discover: false }); }
    catch (error) { observer.errors.push({ at: new Date().toISOString(), phase: "Target.setDiscoverTargets.disable", message: error?.message || String(error) }); }
  }
  try { observer.remoteDebugger.removeListener("message", observer.onMessage); } catch { /* Best-effort cleanup. */ }
  try { observer.remoteDebugger.removeListener("detach", observer.onDetach); } catch { /* Best-effort cleanup. */ }
  const filePath = persistGeminiNavigationDiagnostic(window, command, observer);
  if (observer.attachedByInstrumentation) { try { observer.remoteDebugger.detach(); } catch { /* Best-effort cleanup. */ } }
  geminiNavigationObserver = null;
  return filePath;
}

function finishGeminiNetworkObserver(command) {
  const observer = geminiNetworkObserver;
  if (!observer) {
    command.recordNetworkTimeline({ requests: [], generationRequestIdentified: false });
    return;
  }
  const commandSnapshot = command.snapshot();
  const start = Date.parse(commandSnapshot.submitAttemptAt || commandSnapshot.commandSentAt || "");
  const end = Date.parse(commandSnapshot.responseCapturedAt || commandSnapshot.timeoutAt || new Date().toISOString());
  const requests = [...observer.requests.values()]
    .filter((request) => Number.isFinite(start) && Number.isFinite(end) && Date.parse(request.startedAt) >= start && Date.parse(request.startedAt) <= end)
    .map((request) => ({ ...request, generationRequestCandidate: ["XHR", "Fetch", "EventSource", "WebSocket"].includes(request.resourceType) && Boolean(request.url), isGenerationRequest: isGeminiGenerationRequest(request) }));
  const generationRequest = findAttributedGeminiGenerationRequest(requests, commandSnapshot);
  command.recordNetworkTimeline({ requests, generationRequestIdentified: Boolean(generationRequest) });
  try { observer.remoteDebugger.removeListener("message", observer.onMessage); } catch { /* Instrumentation cleanup must not affect the command. */ }
  if (observer.attachedByInstrumentation) {
    try { observer.remoteDebugger.detach(); } catch { /* The BrowserWindow may already be closing. */ }
  }
  geminiNetworkObserver = null;
}

async function waitForAttributedGeminiGenerationRequest(command, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const observer = geminiNetworkObserver;
    const request = observer ? findAttributedGeminiGenerationRequest([...observer.requests.values()], command.snapshot()) : null;
    if (request) return request;
    await delay(50);
  }
  return null;
}

function geminiCookieRotationObserved() {
  return Boolean(geminiNavigationObserver?.events?.some((event) => /RotateCookies/i.test([event.url, event.frameUrl, event.targetUrl].filter(Boolean).join(" "))));
}

function geminiSendResetEvidence(window, command) {
  const expectedUrl = command.snapshot().expectedConversationUrl;
  const actualUrl = window?.webContents && !window.webContents.isDestroyed() ? window.webContents.getURL() : null;
  const disposition = conversationNavigationDisposition(expectedUrl, actualUrl);
  if (disposition === "AUTH_REQUIRED") return { authRequired: true, expectedUrl, actualUrl, disposition };
  if (disposition !== "RETRY") return null;
  const metadata = command.snapshot();
  return {
    reset: true,
    code: "GEMINI_CONVERSATION_RESET_DURING_SEND",
    reason: geminiCookieRotationObserved() ? "COOKIE_ROTATION" : "CONVERSATION_RESET",
    expectedUrl,
    actualUrl,
    disposition,
    attempt: metadata.sendRetryCount,
    userTurnDelta: metadata.userTurnDelta ?? null,
    assistantTurnDelta: metadata.assistantTurnDelta ?? null,
    generationRequestObserved: metadata.generationStarted === true,
  };
}

function geminiAuthStateExpression() {
  return `(() => {
    const roots = [document]; const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
    const visible = (element) => { const bounds = element?.getBoundingClientRect?.(); const style = element ? getComputedStyle(element) : null; return Boolean(element && bounds && bounds.width > 100 && bounds.height >= 20 && style?.visibility !== 'hidden' && style?.display !== 'none'); };
    const text = String(document.body?.innerText || '');
    const controls = roots.flatMap((root) => [...root.querySelectorAll('button, a, [role="button"]')]);
    const signInControl = controls.some((element) => visible(element) && /^(sign in|đăng nhập|log in)$/i.test(String(element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '').replace(/\\s+/g, ' ').trim()));
    const composerPresent = roots.flatMap((root) => [...root.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]')]).some(visible);
    const authText = !composerPresent && /sign in|đăng nhập|log in|choose an account|chọn tài khoản|captcha|verify you are human|xác minh bạn là người/i.test(text);
    return { url: location.href, loginRequired: /accounts\\.google\\.com/i.test(location.href) || signInControl || authText };
  })()`;
}

async function inspectGeminiAuthState(window) {
  return executeGeminiRemoteScript(window, { expression: geminiAuthStateExpression(), phase: "SEND_AUTH_STATE_CHECK", commandPurpose: "GEMINI_SEND_RECOVERY" });
}

async function waitForGeminiSubmissionConfirmation(window, command, preSubmitSnapshot, firstSnapshot) {
  const deadline = Date.now() + GEMINI_PRE_RETRY_CONFIRMATION_GRACE_MS;
  let snapshot = firstSnapshot;
  while (Date.now() <= deadline) {
    const reset = geminiSendResetEvidence(window, command);
    if (reset?.authRequired) return { confirmed: false, authRequired: true, snapshot, reset };
    if (reset?.reset && command.snapshot().newUserTurnConfirmed !== true) return { confirmed: false, reset, snapshot };
    const generationRequest = geminiNetworkObserver ? findAttributedGeminiGenerationRequest([...geminiNetworkObserver.requests.values()], command.snapshot()) : null;
    if (generationRequest) {
      command.confirmSubmissionByNetwork(generationRequest);
      recordBrowserAction({ action: "gemini-generation-start-observed", commandId: command.snapshot().commandId, requestId: generationRequest.requestId, startedAt: generationRequest.startedAt, url: generationRequest.url, submissionConfirmed: command.snapshot().submissionConfirmed === true });
    }
    if (command.snapshot().submissionConfirmed === true) return { confirmed: true, generationRequest, pageReady: true, snapshot };
    const pageReady = !window.webContents.isLoading() && /^https:\/\/gemini\.google\.com\//i.test(window.webContents.getURL());
    if (!pageReady) {
      command.markSubmissionUncertain("REMOTE_CONTEXT_NOT_READY");
      const remaining = Math.max(0, deadline - Date.now());
      if (!await waitForGeminiPageReady(window, Math.min(GEMINI_CONTEXT_RECOVERY_TIMEOUT_MS, remaining))) return { confirmed: false, recoveryFailed: true, generationRequest: null, pageReady: false, snapshot };
      continue;
    }
    try {
      snapshot = await captureGeminiResponseSnapshot(window, preSubmitSnapshot, command.snapshot().purpose);
      command.observeSubmission(snapshot);
      if (command.snapshot().submissionConfirmed === true) return { confirmed: true, generationRequest, pageReady: true, snapshot };
    } catch (error) {
      if (!isGeminiPageNotReadyError(error)) throw error;
      command.markSubmissionUncertain("REMOTE_CONTEXT_NOT_READY");
      const remaining = Math.max(0, deadline - Date.now());
      if (!await waitForGeminiPageReady(window, Math.min(GEMINI_CONTEXT_RECOVERY_TIMEOUT_MS, remaining))) return { confirmed: false, recoveryFailed: true, generationRequest: null, pageReady: false, snapshot };
    }
    await delay(GEMINI_PRE_RETRY_CONFIRMATION_POLL_MS);
  }
  return { confirmed: command.snapshot().submissionConfirmed === true, generationRequest: null, pageReady: true, snapshot, confirmationTimeout: command.snapshot().submissionConfirmed !== true };
}

async function waitForGeminiGenerationStart(window, command, preSubmitSnapshot) {
  const deadline = Date.now() + GEMINI_GENERATION_START_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const generationRequest = geminiNetworkObserver ? findAttributedGeminiGenerationRequest([...geminiNetworkObserver.requests.values()], command.snapshot()) : null;
    if (generationRequest) command.confirmSubmissionByNetwork(generationRequest);
    if (command.snapshot().generationStarted === true) return generationRequest;
    try {
      const snapshot = await captureGeminiResponseSnapshot(window, preSubmitSnapshot, command.snapshot().purpose);
      command.observeSubmission(snapshot);
      if (command.snapshot().generationStarted === true) return generationRequest;
    } catch (error) {
      if (!isGeminiPageNotReadyError(error)) throw error;
      if (!await waitForGeminiPageReady(window)) {
        command.markFailed("GEMINI_REMOTE_CONTEXT_RECOVERY_FAILED");
        throw new Error(`GEMINI_REMOTE_CONTEXT_RECOVERY_FAILED: ${command.snapshot().commandId}`);
      }
    }
    await delay(GEMINI_GENERATION_START_POLL_MS);
  }
  command.markFailed("GEMINI_GENERATION_START_TIMEOUT");
  throw new Error(`GEMINI_GENERATION_START_TIMEOUT: commandId=${command.snapshot().commandId}`);
}

async function recoverGeminiConversationForSend(window, command, preSubmitSnapshot) {
  await delay(GEMINI_SEND_RECOVERY_SETTLE_MS);
  const expectedUrl = command.snapshot().expectedConversationUrl;
  try {
    const authState = await inspectGeminiAuthState(window);
    if (authState?.loginRequired) throw new Error("GEMINI_AUTH_REQUIRED");
  } catch (error) {
    if (String(error?.message || error).includes("GEMINI_AUTH_REQUIRED")) throw error;
    if (isGeminiPageNotReadyError(error)) await waitForGeminiPageReady(window, GEMINI_CONTEXT_RECOVERY_TIMEOUT_MS);
    else throw error;
  }
  await navigateToGeminiConversation(window, expectedUrl);
  const actualUrl = await window.webContents.executeJavaScript("location.href", true).catch(() => window.webContents.getURL());
  const disposition = conversationNavigationDisposition(expectedUrl, actualUrl);
  if (disposition === "AUTH_REQUIRED") throw new Error("GEMINI_AUTH_REQUIRED");
  if (disposition !== "MATCH" || (command.snapshot().expectedConversationId && conversationIdFromUrl(actualUrl) !== command.snapshot().expectedConversationId)) {
    throw new Error(`GEMINI_CONVERSATION_RESET_DURING_SEND: attempt=1 expectedUrl=${expectedUrl} actualUrl=${actualUrl} userTurnDelta=${command.snapshot().userTurnDelta ?? 0} assistantTurnDelta=${command.snapshot().assistantTurnDelta ?? 0} generationRequestObserved=${command.snapshot().generationStarted === true ? "YES" : "NO"}`);
  }
  const baselineSnapshot = await captureGeminiResponseSnapshot(window, null, "GEMINI_SEND_RECOVERY_BASELINE");
  const baseline = command.snapshot();
  if (baselineSnapshot.userTurnCount !== baseline.baselineUserTurnCount || baselineSnapshot.assistantTurnCount !== baseline.baselineAssistantTurnCount) {
    throw new Error(`GEMINI_CONVERSATION_RESET_DURING_SEND: attempt=1 expectedUrl=${expectedUrl} actualUrl=${actualUrl} userTurnDelta=${(baselineSnapshot.userTurnCount ?? 0) - (baseline.baselineUserTurnCount ?? 0)} assistantTurnDelta=${(baselineSnapshot.assistantTurnCount ?? 0) - (baseline.baselineAssistantTurnCount ?? 0)} generationRequestObserved=${baseline.generationStarted === true ? "YES" : "NO"}`);
  }
  recordBrowserAction({ action: "gemini-conversation-reset-recovery", commandId: baseline.commandId, attempt: 1, reason: baseline.conversationResetReason, expectedUrl, actualUrl, baselineUserTurnCount: baseline.baselineUserTurnCount, baselineAssistantTurnCount: baseline.baselineAssistantTurnCount, result: "REOPEN_PASS" });
  return baselineSnapshot;
}

async function waitForGeminiPageReady(window, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const url = window?.webContents?.getURL?.() || "";
    const loading = Boolean(window?.webContents?.isLoading?.());
    let readyState = null;
    try { readyState = await window.webContents.executeJavaScript("document.readyState", true); } catch { /* The context may be transiently destroyed. */ }
    if (isGeminiTargetReady({ url, loading, readyState })) return true;
    await delay(100);
  }
  return false;
}

function isGeminiPageNotReadyError(error) {
  return /GEMINI_REMOTE_PAGE_NOT_READY|execution context was destroyed|page is not ready/i.test(error instanceof Error ? error.message : String(error));
}

function geminiLatencyPageStateExpression() {
  return [
    "(() => {",
    "const roots = [document]; const seen = new Set(roots);",
    "for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }",
    "const queryCount = (selector) => roots.reduce((count, root) => count + root.querySelectorAll(selector).length, 0);",
    "const assistantTurnCount = queryCount('model-response, [data-message-author-role=\"model\"]');",
    "const userTurnCount = queryCount('[data-message-author-role=\"user\"], [data-author-role=\"user\"], user-query, user-message, [data-testid*=\"user-message\"]');",
    "const navigationEntry = performance.getEntriesByType('navigation')[0];",
    "return { url: location.href, visibilityState: document.visibilityState || null, hidden: document.hidden === true, hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null, assistantTurnCount, userTurnCount, approximateMessageNodeCount: assistantTurnCount + userTurnCount, conversationMode: assistantTurnCount + userTurnCount > 0 ? 'EXISTING' : 'NEW', performanceNavigation: navigationEntry ? { type: navigationEntry.type || null, startTime: Number.isFinite(navigationEntry.startTime) ? navigationEntry.startTime : null, domInteractive: Number.isFinite(navigationEntry.domInteractive) ? navigationEntry.domInteractive : null, domContentLoadedEventEnd: Number.isFinite(navigationEntry.domContentLoadedEventEnd) ? navigationEntry.domContentLoadedEventEnd : null, loadEventEnd: Number.isFinite(navigationEntry.loadEventEnd) ? navigationEntry.loadEventEnd : null } : null };",
    "})()",
  ].join("\n");
}

async function captureGeminiLatencyPageState(window, command, milestone) {
  try {
    const renderer = await executeGeminiRemoteScript(window, { expression: geminiLatencyPageStateExpression(), phase: "LATENCY_PAGE_STATE", commandPurpose: command.snapshot().purpose });
    const backgroundThrottling = typeof window?.webContents?.getBackgroundThrottling === "function" ? window.webContents.getBackgroundThrottling() : null;
    if (renderer && typeof renderer === "object") command.recordConversationState(renderer);
    command.recordPageState(milestone, {
      renderer,
      browserWindow: {
        visible: typeof window?.isVisible === "function" ? window.isVisible() : null,
        focused: typeof window?.isFocused === "function" ? window.isFocused() : null,
        minimized: typeof window?.isMinimized === "function" ? window.isMinimized() : null,
        backgroundThrottling,
      },
    });
    return renderer;
  } catch {
    command.recordPageState(milestone, { renderer: null, browserWindow: { visible: null, focused: null, minimized: null, backgroundThrottling: null } });
    return null;
  }
}

function geminiLatencyHeartbeatSetupExpression() {
  return [
    "(() => {",
    "const key = " + JSON.stringify(GEMINI_LATENCY_HEARTBEAT_KEY) + ";",
    "const previous = window[key];",
    "if (previous?.timerId) clearInterval(previous.timerId);",
    "const expectedIntervalMs = 1000;",
    "const state = { expectedIntervalMs, lastAt: performance.now(), samples: [], timerId: null };",
    "state.timerId = setInterval(() => { const now = performance.now(); const actualDeltaMs = now - state.lastAt; state.samples.push({ timestamp: new Date().toISOString(), expectedDeltaMs: expectedIntervalMs, actualDeltaMs, driftMs: Math.max(0, actualDeltaMs - expectedIntervalMs) }); if (state.samples.length > 1200) state.samples.shift(); state.lastAt = now; }, expectedIntervalMs);",
    "window[key] = state;",
    "return { supported: true, expectedIntervalMs };",
    "})()",
  ].join("\n");
}

function geminiLatencyHeartbeatCollectExpression() {
  return [
    "(() => {",
    "const key = " + JSON.stringify(GEMINI_LATENCY_HEARTBEAT_KEY) + ";",
    "const state = window[key];",
    "if (!state) return { supported: false, samples: [] };",
    "if (state.timerId) clearInterval(state.timerId);",
    "state.timerId = null;",
    "return { supported: true, samples: state.samples.slice() };",
    "})()",
  ].join("\n");
}

function geminiCompletionDiagnosticsSetupExpression() {
  return [
    "(() => {",
    "const key = " + JSON.stringify(GEMINI_COMPLETION_DIAGNOSTICS_KEY) + ";",
    "const previous = window[key];",
    "if (previous?.observer) previous.observer.disconnect();",
    "const finalSelector = 'message-content, [data-message-content], [data-response-content], [data-testid*=" + JSON.stringify("markdown") + "], [data-testid*=" + JSON.stringify("response") + "], [class*=" + JSON.stringify("markdown") + "], [class*=" + JSON.stringify("response-content") + "]';",
    "const state = { supported: true, mutationCount: 0, contentMutationCount: 0, nonContentMutationCount: 0, lastContentMutationAt: null, lastNonContentMutationAt: null, samples: [], observer: null };",
    "const belongsToContent = (node) => { const element = node?.nodeType === 3 ? node.parentElement : node; return Boolean(element?.matches?.(finalSelector) || element?.closest?.(finalSelector)); };",
    "const observer = new MutationObserver((mutations) => { for (const mutation of mutations) { const content = belongsToContent(mutation.target) || [...(mutation.addedNodes || [])].some(belongsToContent); const at = new Date().toISOString(); state.mutationCount += 1; if (content) { state.contentMutationCount += 1; state.lastContentMutationAt = at; } else { state.nonContentMutationCount += 1; state.lastNonContentMutationAt = at; } if (state.samples.length < 512) state.samples.push({ at, type: mutation.type, content, targetTag: mutation.target?.nodeType === 1 ? mutation.target.tagName.toLowerCase() : '#text' }); } });",
    "observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'aria-busy', 'hidden', 'aria-hidden'] });",
    "state.observer = observer; window[key] = state; return { supported: true };",
    "})()",
  ].join("\n");
}

function geminiCompletionDiagnosticsCollectExpression() {
  return [
    "(() => {",
    "const key = " + JSON.stringify(GEMINI_COMPLETION_DIAGNOSTICS_KEY) + ";",
    "const state = window[key];",
    "if (!state) return { supported: false, mutationCount: 0, contentMutationCount: 0, nonContentMutationCount: 0, lastContentMutationAt: null, lastNonContentMutationAt: null, samples: [] };",
    "if (state.observer) state.observer.disconnect();",
    "return { supported: state.supported === true, mutationCount: state.mutationCount, contentMutationCount: state.contentMutationCount, nonContentMutationCount: state.nonContentMutationCount, lastContentMutationAt: state.lastContentMutationAt, lastNonContentMutationAt: state.lastNonContentMutationAt, samples: state.samples };",
    "})()",
  ].join("\n");
}

async function finalizeGeminiLatency(window, command) {
  try {
    const heartbeat = await executeGeminiRemoteScript(window, { expression: geminiLatencyHeartbeatCollectExpression(), phase: "LATENCY_HEARTBEAT_COLLECT", commandPurpose: command.snapshot().purpose });
    command.recordRendererHeartbeat(heartbeat);
  } catch {
    command.recordRendererHeartbeat({ supported: null, samples: [] });
  }
  try {
    const mutations = await executeGeminiRemoteScript(window, { expression: geminiCompletionDiagnosticsCollectExpression(), phase: "COMPLETION_DIAGNOSTICS_COLLECT", commandPurpose: command.snapshot().purpose });
    command.recordDomMutationSummary(mutations);
  } catch {
    command.recordDomMutationSummary({ supported: null, mutationCount: 0, contentMutationCount: 0, nonContentMutationCount: 0, lastContentMutationAt: null, lastNonContentMutationAt: null, samples: [] });
  }
  finishGeminiNetworkObserver(command);
  await finishGeminiNavigationObserver(window, command);
  const evidence = { evidenceVersion: "gemini-latency-diagnostic-v1", capturedAt: new Date().toISOString(), command: command.latencySnapshot() };
  const filePath = path.join(app.getPath("userData"), "gemini-latency-diagnostics.ndjson");
  try { fs.appendFileSync(filePath, JSON.stringify(redactDesktopRuntime(evidence)) + "\n", { encoding: "utf8", mode: 0o600 }); } catch { /* Latency evidence must not affect command outcome. */ }
  recordBrowserAction({ action: "gemini-latency-diagnostic", commandId: evidence.command.commandId, sessionId: evidence.command.sessionId, purpose: evidence.command.purpose, promptHash: evidence.command.promptHash, evidencePath: filePath });
}

function persistGeminiRemoteScriptFailure(failure) {
  const filePath = path.join(app.getPath("userData"), "gemini-remote-script-errors.ndjson");
  try { fs.appendFileSync(filePath, `${JSON.stringify(redactDesktopRuntime(failure))}\n`, { encoding: "utf8", mode: 0o600 }); } catch { /* Keep the primary renderer exception. */ }
  recordBrowserAction({ action: "gemini-remote-script-failure", ...failure, evidencePath: filePath });
  return filePath;
}

function geminiRemoteContext(window, context = {}) {
  const webContents = window?.webContents;
  const sourceUrl = webContents && !webContents.isDestroyed() ? webContents.getURL() : null;
  return {
    ...context,
    targetId: webContents?.id ?? null,
    executionContextId: null,
    sourceUrl,
    pageReady: Boolean(webContents && !webContents.isDestroyed() && !webContents.isLoading()),
    correctGeminiTab: typeof sourceUrl === "string" && /^https:\/\/gemini\.google\.com\//i.test(sourceUrl),
  };
}

async function executeGeminiRemoteScript(window, { expression, phase, selector = null, commandPurpose = null }) {
  const context = geminiRemoteContext(window, { phase, selector, commandPurpose });
  if (!window || window.isDestroyed() || !window.webContents || window.webContents.isDestroyed()) {
    const failure = normalizeRemoteFailure(new Error("Gemini window is unavailable"), { ...context, code: "GEMINI_REMOTE_TARGET_INVALID" });
    persistGeminiRemoteScriptFailure(failure);
    throw Object.assign(new Error(`${failure.code}: ${failure.phase}: ${failure.message}`), { remoteFailure: failure });
  }
  if (!context.correctGeminiTab || !context.pageReady) {
    const failure = normalizeRemoteFailure(new Error("Gemini page is not ready in the current execution context"), { ...context, code: "GEMINI_REMOTE_PAGE_NOT_READY" });
    persistGeminiRemoteScriptFailure(failure);
    throw Object.assign(new Error(`${failure.code}: ${failure.phase}: ${failure.message}`), { remoteFailure: failure });
  }
  if (!isJsonSerializable({ expression, phase, selector, commandPurpose })) {
    const failure = normalizeRemoteFailure(new Error("Remote script arguments are not serializable"), { ...context, code: "GEMINI_REMOTE_ARGUMENT_SERIALIZATION" });
    persistGeminiRemoteScriptFailure(failure);
    throw Object.assign(new Error(`${failure.code}: ${failure.phase}: ${failure.message}`), { remoteFailure: failure });
  }
  let result;
  try {
    result = await window.webContents.executeJavaScript(wrapGeminiRemoteExpression(expression, phase), true);
  } catch (error) {
    const failure = normalizeRemoteFailure(error, context);
    persistGeminiRemoteScriptFailure(failure);
    throw Object.assign(new Error(`${failure.code}: ${failure.phase}: ${failure.message}`), { remoteFailure: failure });
  }
  if (!result?.ok) {
    const failure = normalizeRemoteFailure(result, context);
    persistGeminiRemoteScriptFailure(failure);
    throw Object.assign(new Error(`${failure.code}: ${failure.phase}: ${failure.message}`), { remoteFailure: failure });
  }
  return result.value;
}

async function captureGeminiResponseSnapshot(window, preSubmitSnapshot = null, commandPurpose = null) {
  const rawSnapshot = await executeGeminiRemoteScript(window, { expression: geminiResponseSnapshotExpression(), phase: "PRE_SUBMIT_DOM_SNAPSHOT", commandPurpose });
  return normalizeGeminiResponseSnapshot(rawSnapshot, preSubmitSnapshot);
}

async function countGeminiResponseNodes(window) {
  const snapshot = await captureGeminiResponseSnapshot(window, null, "GEMINI_RESPONSE_DISCOVERY");
  return snapshot.responseCount;
}

function persistGeminiBindingDiagnostic(command, beforeSnapshot, snapshot) {
  const evidence = buildGeminiBindingDiagnostic({ command, beforeSnapshot, snapshot });
  const filePath = path.join(app.getPath("userData"), "gemini-binding-diagnostics.ndjson");
  try { fs.appendFileSync(filePath, `${JSON.stringify(redactDesktopRuntime(evidence))}\n`, { encoding: "utf8", mode: 0o600 }); } catch { /* Diagnostic persistence must not hide the binding failure. */ }
  recordBrowserAction({ action: "gemini-binding-diagnostic", ...evidence, evidencePath: filePath });
  return { evidence, filePath };
}

function persistGeminiResponseContentDiagnostic(command, beforeSnapshot, snapshot, reason) {
  const evidence = buildGeminiResponseContentDiagnostic({ command, beforeSnapshot, snapshot, reason });
  const filePath = path.join(app.getPath("userData"), "gemini-response-diagnostics.ndjson");
  try { fs.appendFileSync(filePath, `${JSON.stringify(redactDesktopRuntime(evidence))}\n`, { encoding: "utf8", mode: 0o600 }); } catch { /* Diagnostic persistence must not hide the extraction failure. */ }
  recordBrowserAction({ action: "gemini-response-content-diagnostic", ...evidence, evidencePath: filePath });
  return { evidence, filePath };
}

function persistGeminiResponseEvidence(command, rawResponse, responseNode, parseError, schemaError) {
  const metadata = command.snapshot();
  persistGeminiRawResponseEvidence({
    evidenceVersion: "gemini-response-v1",
    capturedAt: new Date().toISOString(),
    commandId: metadata.commandId,
    parentCommandId: metadata.parentCommandId,
    sessionId: metadata.sessionId,
    purpose: metadata.purpose,
    promptHash: metadata.promptHash,
    rawResponse,
    rawResponseHash: hashText(rawResponse),
    rawResponseLength: String(rawResponse ?? "").length,
    responseCompletedAt: metadata.responseCompletedAt || null,
    responseCapturedAt: metadata.responseCapturedAt || null,
    responseTurnId: responseNode?.turnId || responseNode?.candidateId || null,
    responseNode,
    parseError: parseError ? String(parseError) : null,
    schemaError: schemaError ? String(schemaError) : null,
  });
}

async function submitGeminiCommand(window, command, prompt, missingCode, preSubmitSnapshot = null) {
  let attempt = 0;
  while (attempt <= 1) {
    if (attempt === 0) command.markSubmitAttempt();
    const prepared = await executeGeminiRemoteScript(window, { expression: geminiFillPromptExpression(prompt, missingCode), phase: attempt === 0 ? "PROMPT_INJECTION" : "PROMPT_INJECTION_RECOVERY", selector: "[contenteditable=true], textarea, [role=textbox]", commandPurpose: command.snapshot().purpose });
    if (!prepared?.textLength) {
      command.markFailed(missingCode);
      throw new Error(missingCode);
    }
    await captureGeminiSendElementSnapshot(window, command, attempt === 0 ? "BEFORE_INITIAL_SEND" : "BEFORE_RECOVERY_SEND");
    if (attempt === 0) command.markSubmitted();
    dispatchGeminiEnter(window, command, attempt === 0 ? "INITIAL_SEND" : "RECOVERY_SEND");
    await delay(1_200);
    const firstSnapshot = await captureGeminiResponseSnapshot(window, preSubmitSnapshot, command.snapshot().purpose);
    command.observeSubmission(firstSnapshot);
    await captureGeminiLatencyPageState(window, command, attempt === 0 ? "SUBMIT" : "RECOVERY_SUBMIT");
    const confirmation = await waitForGeminiSubmissionConfirmation(window, command, preSubmitSnapshot, firstSnapshot);
    if (confirmation.confirmed) {
      await waitForGeminiGenerationStart(window, command, preSubmitSnapshot);
      command.markGenerating();
      return;
    }
    if (confirmation.recoveryFailed) {
      command.markFailed("GEMINI_REMOTE_CONTEXT_RECOVERY_FAILED");
      throw new Error(`GEMINI_REMOTE_CONTEXT_RECOVERY_FAILED: ${command.snapshot().commandId}`);
    }
    if (confirmation.authRequired) {
      command.markFailed("GEMINI_AUTH_REQUIRED");
      throw new Error(`GEMINI_AUTH_REQUIRED: commandId=${command.snapshot().commandId}`);
    }
    if (confirmation.reset?.reset) {
      command.markConversationReset(confirmation.reset.reason);
      recordBrowserAction({ action: "gemini-conversation-reset-during-send", commandId: command.snapshot().commandId, attempt: attempt + 1, expectedUrl: confirmation.reset.expectedUrl, actualUrl: confirmation.reset.actualUrl, reason: confirmation.reset.reason, userTurnDelta: confirmation.reset.userTurnDelta, assistantTurnDelta: confirmation.reset.assistantTurnDelta, generationRequestObserved: confirmation.reset.generationRequestObserved ? "YES" : "NO" });
      if (attempt === 0) {
        try {
          preSubmitSnapshot = await recoverGeminiConversationForSend(window, command, preSubmitSnapshot);
        } catch (error) {
          const message = String(error?.message || error);
          const code = /GEMINI_AUTH_REQUIRED/.test(message) ? "GEMINI_AUTH_REQUIRED" : "GEMINI_CONVERSATION_RESET_DURING_SEND";
          command.markFailed(code);
          throw new Error(`${code}: attempt=1 expectedUrl=${command.snapshot().expectedConversationUrl} actualUrl=${window.webContents.getURL()} userTurnDelta=${command.snapshot().userTurnDelta ?? 0} assistantTurnDelta=${command.snapshot().assistantTurnDelta ?? 0} generationRequestObserved=${command.snapshot().generationStarted ? "YES" : "NO"}`);
        }
        command.markSendRetry("GEMINI_CONVERSATION_RESET_DURING_SEND", confirmation.reset);
        recordBrowserAction({ action: "gemini-conversation-reset-recovery-ready", commandId: command.snapshot().commandId, attempt: 1, expectedUrl: command.snapshot().expectedConversationUrl, actualUrl: window.webContents.getURL(), result: "RESEND_ALLOWED_ONCE" });
        attempt = 1;
        continue;
      }
      const resetError = createGeminiConversationResetError({
        commandId: command.snapshot().commandId,
        expectedConversationUrl: confirmation.reset.expectedUrl || command.snapshot().expectedConversationUrl,
        actualUrl: confirmation.reset.actualUrl || window.webContents.getURL(),
        recoveryAttempt: command.snapshot().sendRetryCount,
        recoveryBudget: 1,
        userTurnDelta: confirmation.reset.userTurnDelta ?? command.snapshot().userTurnDelta ?? 0,
        assistantTurnDelta: confirmation.reset.assistantTurnDelta ?? command.snapshot().assistantTurnDelta ?? 0,
        generationRequestObserved: confirmation.reset.generationRequestObserved === true || command.snapshot().generationStarted === true,
        composerCleared: Boolean(command.snapshot().composerClearedAt),
        authenticatedState: null,
        cookieRotationObserved: confirmation.reset.reason === "COOKIE_ROTATION",
      });
      command.markFailed(resetError);
      throw resetError;
    }
    const failureCode = confirmation.confirmationTimeout ? "GEMINI_SUBMISSION_NOT_CONFIRMED" : "GEMINI_SUBMISSION_FAILED";
    command.markFailed(failureCode);
    throw new Error(`${failureCode}: commandId=${command.snapshot().commandId} userTurnDelta=${command.snapshot().userTurnDelta ?? 0} assistantTurnDelta=${command.snapshot().assistantTurnDelta ?? 0} generationRequestObserved=${command.snapshot().generationStarted ? "YES" : "NO"}`);
  }
  command.markFailed("GEMINI_CONVERSATION_RESET_DURING_SEND");
  throw new Error(`GEMINI_CONVERSATION_RESET_DURING_SEND: commandId=${command.snapshot().commandId}`);
}

function extractJsonCandidate(rawResponse) {
  return extractGeminiJsonCandidate(rawResponse);
}

async function runGeminiJsonCommand({ window, prompt, purpose, missingCode, beforeCount, timeoutMs, validate, parentCommand = null, runId = null, stage = null }) {
  assertParentTerminal(parentCommand);
  const command = createGeminiCommand({ purpose, prompt, parentCommandId: parentCommand?.snapshot().commandId ?? null });
  let primaryCommandError = null;
  try {
    const conversationBinding = await prepareGeminiConversationForCommand(window, runId, stage);
    await startGeminiNavigationObserver(window, command);
    await startGeminiNetworkObserver(window, command);
    try {
      const completionDiagnostics = await executeGeminiRemoteScript(window, { expression: geminiCompletionDiagnosticsSetupExpression(), phase: "COMPLETION_DIAGNOSTICS_SETUP", commandPurpose: purpose });
      command.recordDomMutationSummary(completionDiagnostics);
    } catch {
      command.recordDomMutationSummary({ supported: null, mutationCount: 0, contentMutationCount: 0, nonContentMutationCount: 0, lastContentMutationAt: null, lastNonContentMutationAt: null, samples: [] });
    }
    try {
      const heartbeat = await executeGeminiRemoteScript(window, { expression: geminiLatencyHeartbeatSetupExpression(), phase: "LATENCY_HEARTBEAT_SETUP", commandPurpose: purpose });
      command.recordRendererHeartbeat(heartbeat);
    } catch {
      command.recordRendererHeartbeat({ supported: null, samples: [] });
    }
    let preSubmitSnapshot;
    try {
      preSubmitSnapshot = await captureGeminiResponseSnapshot(window, null, purpose);
    } catch (error) {
      if (!isGeminiPageNotReadyError(error) || !await waitForGeminiPageReady(window)) {
        command.markFailed("GEMINI_REMOTE_CONTEXT_RECOVERY_FAILED");
        throw new Error(`GEMINI_REMOTE_CONTEXT_RECOVERY_FAILED: ${command.snapshot().commandId}`);
      }
      preSubmitSnapshot = await captureGeminiResponseSnapshot(window, null, purpose);
    }
    command.recordConversationState({ url: preSubmitSnapshot?.conversationUrl, mode: preSubmitSnapshot?.conversationMode, assistantTurnCount: preSubmitSnapshot?.assistantTurnCount, userTurnCount: preSubmitSnapshot?.userTurnCount, approximateMessageNodeCount: preSubmitSnapshot?.approximateMessageNodeCount });
    command.setSubmissionBaseline({
      expectedConversationUrl: conversationBinding?.geminiConversationUrl || preSubmitSnapshot?.conversationUrl,
      expectedConversationId: conversationBinding?.geminiConversationId || conversationIdFromUrl(preSubmitSnapshot?.conversationUrl),
      allowNewConversation: !conversationBinding?.geminiConversationId && !conversationIdFromUrl(preSubmitSnapshot?.conversationUrl),
      userTurnCount: preSubmitSnapshot?.userTurnCount,
      assistantTurnCount: preSubmitSnapshot?.assistantTurnCount,
      userTurns: preSubmitSnapshot?.userTurns,
    });
    await submitGeminiCommand(window, command, prompt, missingCode, preSubmitSnapshot);
    if (parentCommand) parentCommand.markNextCommandSent(command.snapshot().commandSentAt);
    const latencyMilestones = new Set(["SUBMIT"]);
    const scheduledMilestones = [[5_000, "PLUS_5S"], [30_000, "PLUS_30S"], [60_000, "PLUS_60S"]];
    const captureScheduledMilestones = async () => {
      const submittedAt = Date.parse(command.snapshot().submitAttemptAt || command.snapshot().commandSentAt || "");
      if (!Number.isFinite(submittedAt)) return;
      const elapsed = Date.now() - submittedAt;
      for (const [offset, milestone] of scheduledMilestones) {
        if (elapsed >= offset && !latencyMilestones.has(milestone)) {
          await captureGeminiLatencyPageState(window, command, milestone);
          latencyMilestones.add(milestone);
        }
      }
    };
    let previous = "";
    let stable = 0;
    let lastSnapshot = null;
    for (let elapsed = 0; elapsed < timeoutMs; elapsed += 2_000) {
      let snapshot;
      try {
        snapshot = await captureGeminiResponseSnapshot(window, preSubmitSnapshot, purpose);
      } catch (error) {
        if (!isGeminiPageNotReadyError(error)) throw error;
        if (command.snapshot().submissionConfirmed !== true) {
          command.markFailed("GEMINI_REMOTE_PAGE_NOT_READY");
          throw error;
        }
        if (!await waitForGeminiPageReady(window)) {
          command.markFailed("GEMINI_REMOTE_CONTEXT_RECOVERY_FAILED");
          throw new Error(`GEMINI_REMOTE_CONTEXT_RECOVERY_FAILED: ${command.snapshot().commandId}`);
        }
        snapshot = await captureGeminiResponseSnapshot(window, preSubmitSnapshot, purpose);
      }
      lastSnapshot = snapshot;
      command.observeSubmission(snapshot);
      await captureScheduledMilestones();
      if (snapshot?.newResponseCount > 1) {
        persistGeminiBindingDiagnostic(command, preSubmitSnapshot, snapshot);
        command.markFailed("RESPONSE_BINDING_AMBIGUOUS");
        throw new Error(`RESPONSE_BINDING_AMBIGUOUS: commandId=${command.snapshot().commandId}`);
      }
      const text = typeof snapshot?.responseText === "string" ? snapshot.responseText : "";
      if (snapshot?.newResponseCount === 1 && text) {
        command.markResponseStarted(snapshot.responseNode);
        if (!latencyMilestones.has("FIRST_RESPONSE_DOM_TOKEN")) {
          await captureGeminiLatencyPageState(window, command, "FIRST_RESPONSE_DOM_TOKEN");
          latencyMilestones.add("FIRST_RESPONSE_DOM_TOKEN");
        }
        stable = text === previous ? stable + 1 : 1;
        previous = text;
      } else {
        stable = 0;
        previous = "";
      }
      command.recordResponseProgress(snapshot, stable);
      command.recordCompletionEvaluation(snapshot, stable, 3);
      const responseComplete = isResponseComplete(snapshot, stable, 3);
      if (responseComplete) {
        if (!latencyMilestones.has("FINAL_RESPONSE_VISIBLE")) {
          await captureGeminiLatencyPageState(window, command, "FINAL_RESPONSE_VISIBLE");
          latencyMilestones.add("FINAL_RESPONSE_VISIBLE");
        }
        command.markResponseComplete({ responseNode: snapshot.responseNode, responseCount: snapshot.responseCount, stablePolls: stable });
        command.captureRawResponse(text, snapshot.responseNode);
        persistGeminiResponseEvidence(command, text, snapshot.responseNode, null, null);
        command.markParseStarted();
        try {
          const parsed = extractJsonCandidate(text);
          const validationError = validate(parsed);
          if (validationError) throw new Error(validationError);
          command.markParsed();
          command.markValidated();
          return { ok: true, value: parsed, command, responseCount: snapshot.responseCount, rawResponse: text };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          command.markInvalidResponse(message);
          persistGeminiResponseEvidence(command, text, snapshot.responseNode, message, message);
          return { ok: false, command, responseCount: snapshot.responseCount, rawResponse: text, error: message };
        }
      }
      await delay(2_000);
    }
    if (lastSnapshot) {
      command.recordResponseProgress(lastSnapshot, stable);
      command.recordCompletionEvaluation(lastSnapshot, stable, 3);
    }
    await captureGeminiLatencyPageState(window, command, "TIMEOUT");
    if (lastSnapshot?.boundTurn && !lastSnapshot.boundTurn.finalResponseBodyFound && isGenerationTerminal(lastSnapshot)) {
      persistGeminiResponseContentDiagnostic(command, preSubmitSnapshot, lastSnapshot, "FINAL_RESPONSE_CONTENT_NOT_FOUND");
      command.markFailed("FINAL_RESPONSE_CONTENT_NOT_FOUND");
      throw new Error(`FINAL_RESPONSE_CONTENT_NOT_FOUND: commandId=${command.snapshot().commandId}`);
    }
    command.markTimeout(`GEMINI_COMMAND_TIMEOUT: ${purpose}`);
    throw new Error(`GEMINI_COMMAND_TIMEOUT: purpose=${purpose} commandId=${command.snapshot().commandId}`);
  } catch (error) {
    primaryCommandError = error;
    throw error;
  } finally {
    try {
      await finalizeGeminiLatency(window, command);
    } finally {
      try {
        if (runId) await persistGeminiConversationAfterStep(window, command, runId, stage);
      } catch (finalizerError) {
        if (!primaryCommandError) throw finalizerError;
        recordBrowserAction({ action: "gemini-conversation-finalizer-secondary-failure", commandId: command.snapshot().commandId, primaryError: primaryCommandError instanceof Error ? primaryCommandError.message : String(primaryCommandError), secondaryError: finalizerError instanceof Error ? finalizerError.message : String(finalizerError), primaryFailurePreserved: true });
      } finally {
        if (runId) await closeGeminiAfterStep(window);
      }
    }
  }
}

async function runGeminiJsonCommandWithFormatRetry({ window, prompt, purpose, formatPrompt, missingCode, beforeCount, timeoutMs, validate, runId = null, stage = null }) {
  const first = await runGeminiJsonCommand({ window, prompt, purpose, missingCode, beforeCount, timeoutMs, validate, runId, stage });
  if (first.ok) return first.value;
  if (!canRunFormatRetry(first)) throw new Error(`GEMINI_FORMAT_RETRY_BLOCKED: ${first.command.snapshot().state}`);
  const repairPrompt = typeof formatPrompt === "function" ? formatPrompt({ rawResponse: first.rawResponse, error: first.error }) : formatPrompt;
  const retryWindow = await createGeminiWindow();
  await preflightGeminiForRun(retryWindow, runId, stage);
  const retryResult = await runGeminiJsonCommand({ window: retryWindow, prompt: repairPrompt, purpose: `${purpose}_FORMAT_RETRY`, missingCode, beforeCount: first.responseCount, timeoutMs, validate, parentCommand: first.command, runId, stage });
  if (retryResult.ok) return retryResult.value;
  const retryMeta = retryResult.command.snapshot();
  throw new Error(`${purpose}_BROWSER_INVALID_JSON: Gemini browser không trả JSON hợp lệ. commandId=${retryMeta.commandId} parentCommandId=${first.command.snapshot().commandId} rawResponseHash=${retryMeta.rawResponseHash}`);
}

async function captureBrowserFailure(window, context = {}) {
  const stamp = `${Date.now()}-${browserSafeName(context.state || context.action || "failure")}`;
  const root = browserFailureRoot();
  const base = path.join(root, stamp);
  const diagnostics = {
    ...context,
    url: window && !window.isDestroyed() ? window.webContents.getURL() : null,
    title: window && !window.isDestroyed() ? window.webContents.getTitle() : null,
  };
  if (window && !window.isDestroyed()) {
    try {
      diagnostics.dom = await window.webContents.executeJavaScript("(() => ({ title: document.title, url: location.href, text: (document.body?.innerText || '').slice(0, 4000), loading: Boolean(document.querySelector('[aria-busy=\"true\"], mat-progress-spinner, [role=\"progressbar\"]')) }))()", true);
    } catch (error) { diagnostics.domError = error instanceof Error ? error.message : String(error); }
    try { fs.writeFileSync(`${base}.png`, (await window.capturePage()).toPNG()); diagnostics.screenshotPath = `${base}.png`; } catch (error) { diagnostics.screenshotError = error instanceof Error ? error.message : String(error); }
  }
  try { fs.writeFileSync(`${base}.json`, JSON.stringify(redactDesktopRuntime(diagnostics), null, 2), { encoding: "utf8", mode: 0o600 }); diagnostics.diagnosticsPath = `${base}.json`; } catch { /* Keep the original error when diagnostics cannot be written. */ }
  recordBrowserAction({ action: "failure-diagnostics", success: false, ...diagnostics });
  return diagnostics;
}

function isGeminiThrottleError(error) {
  return /(?:\b429\b|rate.?limit|quota|too many requests|try again later|tạm thời quá tải|đợi rồi thử lại)/i.test(error instanceof Error ? error.message : String(error));
}

async function withGeminiBrowserOperation(operation) {
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  const previous = geminiOperationTail;
  geminiOperationTail = geminiOperationTail.then(() => next);
  await previous;
  try {
    const waitMs = Math.max(0, geminiThrottleUntil - Date.now());
    if (waitMs) await delay(waitMs);
    const result = await operation();
    geminiThrottleLevel = Math.max(0, geminiThrottleLevel - 1);
    return result;
  } catch (error) {
    if (isGeminiThrottleError(error)) {
      const base = Math.min(120_000, 5_000 * (2 ** Math.min(geminiThrottleLevel, 4)));
      const jitter = Math.floor(Math.random() * 2_000);
      geminiThrottleLevel = Math.min(geminiThrottleLevel + 1, 5);
      geminiThrottleUntil = Math.max(geminiThrottleUntil, Date.now() + base + jitter);
      recordBrowserAction({ action: "gemini-throttle", success: false, cooldownMs: base + jitter, throttleLevel: geminiThrottleLevel, error: error instanceof Error ? error.message : String(error) });
      throw new Error(`GEMINI_TEMPORARY_PROVIDER_THROTTLE_429: tạm dừng Gemini ${base + jitter}ms trước request tiếp theo.`);
    }
    throw error;
  } finally {
    release();
  }
}

async function withFlowOperation(operation) {
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  const previous = flowOperationTail;
  flowOperationTail = flowOperationTail.then(() => next);
  await previous;
  try { return await operation(); }
  finally { release(); }
}

function notifyUpdate(event, payload = {}) {
  safeSendToRenderer(getMainWindow(), `desktop-update:${event}`, payload);
}

function ensureRuntime() {
  const userData = app.getPath("userData");
  const databasePath = path.join(userData, "modeling-ai.db");
  const configPath = path.join(userData, "desktop-config.json");
  const templatePath = path.join(runtimeRoot(), "modeling-ai-template.db");
  if (!fs.existsSync(databasePath)) fs.copyFileSync(templatePath, databasePath);
  let config;
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } else {
    config = {
      authSecret: crypto.randomBytes(32).toString("hex"),
      credentialEncryptionKey: crypto.randomBytes(32).toString("hex"),
    };
    fs.writeFileSync(configPath, JSON.stringify(config), { encoding: "utf8", mode: 0o600 });
  }
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1",
    DESKTOP_MODE: "1",
    DATABASE_URL: `file:${databasePath.replace(/\\/g, "/")}`,
    ...(process.env.MODELING_AI_USER_DATA_DIR !== undefined ? { DESKTOP_DATABASE_URL: `file:${databasePath.replace(/\\/g, "/")}`, DESKTOP_CONFIG_PATH: configPath } : {}),
    AUTH_SECRET: config.authSecret,
    CREDENTIAL_ENCRYPTION_KEY: config.credentialEncryptionKey,
    GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    AI_PROVIDER: process.env.AI_PROVIDER || "unconfigured",
    META_GRAPH_VERSION: process.env.META_GRAPH_VERSION || "v24.0",
  };
}

async function ensureLocalDatabaseSchema(databaseUrl) {
  if (typeof databaseUrl !== "string" || !databaseUrl.startsWith("file:")) return;
  const prismaClientPath = app.isPackaged
    ? path.join(runtimeRoot(), "app", "node_modules", "@prisma", "client")
    : "@prisma/client";
  const { PrismaClient } = require(prismaClientPath);
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    try { await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL"); } catch { /* SQLite có thể đang khôi phục journal cũ; không chặn khởi động app. */ }
    try { await prisma.$executeRawUnsafe("PRAGMA busy_timeout=15000"); } catch { /* Dùng timeout mặc định nếu connector không hỗ trợ pragma này. */ }
    await ensureSqliteReleaseSchema(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

function runtimeConfigPath() {
  return path.join(app.getPath("userData"), "desktop-config.json");
}

function markSyncAfterUpdate() {
  const configPath = runtimeConfigPath();
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
  fs.writeFileSync(configPath, JSON.stringify({ ...config, syncAfterUpdate: true }), { encoding: "utf8", mode: 0o600 });
}

function consumeSyncAfterUpdate() {
  const configPath = runtimeConfigPath();
  if (!fs.existsSync(configPath)) return false;
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!config.syncAfterUpdate) return false;
  fs.writeFileSync(configPath, JSON.stringify({ ...config, syncAfterUpdate: false }), { encoding: "utf8", mode: 0o600 });
  return true;
}

function updateDesktopSession(value) {
  const configPath = runtimeConfigPath();
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
  fs.writeFileSync(configPath, JSON.stringify({ ...config, desktopSession: value }), { encoding: "utf8", mode: 0o600 });
}

function getDesktopSession() {
  const configPath = runtimeConfigPath();
  if (!fs.existsSync(configPath)) return null;
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return config.desktopSession && typeof config.desktopSession.token === "string" ? config.desktopSession : null;
}

async function ensureDesktopSession() {
  const existing = getDesktopSession();
  if (existing && new Date(existing.expiresAt).getTime() > Date.now()) return existing;
  try {
    const response = await fetch(`${APP_URL}/api/auth/desktop-session`, { method: "POST" });
    if (!response.ok) return null;
    const body = await response.json();
    const token = body?.data?.token;
    const expiresAt = body?.data?.expiresAt;
    if (typeof token !== "string" || typeof expiresAt !== "string") return null;
    const session = { token, expiresAt };
    updateDesktopSession(session);
    return session;
  } catch {
    return null;
  }
}

async function reportDesktopRuntimeFailure(source, error, context = {}) {
  const details = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  const payload = redactDesktopRuntime({ source, code: "DESKTOP_RUNTIME_INTERRUPTED", message: String(details.message).slice(0, 4000), stack: details.stack?.slice(0, 12000), ...(typeof context.codexJobId === "string" ? { codexJobId: context.codexJobId } : {}), ...(typeof context.stage === "string" ? { stage: context.stage } : {}), context });
  try {
    const session = await ensureDesktopSession();
    if (!session) { queueDesktopRuntimeFailure(payload); return false; }
    const response = await fetch(`${APP_URL}/api/v1/runtime-failures`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `ai_content_modeling_session=${session.token}` },
      body: JSON.stringify(payload),
    });
    if (!response.ok) queueDesktopRuntimeFailure(payload);
    return response.ok;
  } catch (reportError) {
    queueDesktopRuntimeFailure(payload);
    try { fs.appendFileSync(path.join(app.getPath("userData"), "desktop-runtime.log"), `[telemetry-error] ${reportError instanceof Error ? reportError.message : String(reportError)}\n`, "utf8"); } catch { /* The desktop may be failing before its data directory is available. */ }
    return false;
  }
}

function redactDesktopRuntime(value) {
  if (typeof value === "string") return value.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b|\b(?:sk|sess|pat|ghp|AIza)[-_A-Za-z0-9]{12,}\b|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|client[_-]?secret|encryption[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi, "[REDACTED]");
  if (Array.isArray(value)) return value.map(redactDesktopRuntime);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|client[_-]?secret|encryption[_-]?key|credential|credentials)$/i.test(key) ? "[REDACTED]" : redactDesktopRuntime(item)]));
  return value;
}

function desktopRuntimeSpoolPath() { return path.join(app.getPath("userData"), "runtime-failures.ndjson"); }
function queueDesktopRuntimeFailure(payload) {
  try { fs.appendFileSync(desktopRuntimeSpoolPath(), `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 }); } catch { /* Keep the original runtime error visible in the main log. */ }
}
async function flushDesktopRuntimeFailures() {
  const spool = desktopRuntimeSpoolPath();
  if (!fs.existsSync(spool)) return;
  let lines;
  try { lines = fs.readFileSync(spool, "utf8").split(/\r?\n/).filter(Boolean); } catch { return; }
  const remaining = [];
  for (const line of lines) {
    try {
      const payload = JSON.parse(line);
      const session = await ensureDesktopSession();
      if (!session) { remaining.push(payload); continue; }
      const response = await fetch(`${APP_URL}/api/v1/runtime-failures`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `ai_content_modeling_session=${session.token}` }, body: JSON.stringify(payload) });
      if (!response.ok) remaining.push(payload);
    } catch { remaining.push(line); }
  }
  try {
    if (remaining.length) fs.writeFileSync(spool, `${remaining.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
    else fs.rmSync(spool);
  } catch { /* Retry the spool during the next startup. */ }
}

async function requestDesktopFlowBridge(pathname, options = {}) {
  const session = await ensureDesktopSession();
  if (!session) return null;
  const headers = {
    ...(options.headers || {}),
    Cookie: `ai_content_modeling_session=${session.token}`,
    "X-Modeling-App-Version": app.getVersion(),
    "X-Modeling-Flow-Bridge-Revision": DESKTOP_FLOW_BRIDGE_REVISION,
  };
  const response = await fetch(`${APP_URL}${pathname}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `Desktop Flow bridge trả về HTTP ${response.status}.`);
  return body?.data;
}

async function processDesktopFlowBridgeJob(job) {
  const claimed = await requestDesktopFlowBridge(`/api/v1/desktop-flow/jobs/${encodeURIComponent(job.id)}/claim`, { method: "POST" });
  if (!claimed) return;
  const heartbeat = setInterval(() => {
    void requestDesktopFlowBridge(`/api/v1/desktop-flow/jobs/${encodeURIComponent(claimed.id)}/claim`, { method: "POST" }).catch((error) => {
      void reportDesktopRuntimeFailure("electron:flow-bridge:heartbeat", error, { bridgeJobId: claimed.id });
    });
  }, 30_000);
  const payload = claimed.payload || {};
  activeDesktopFlowBridgeContext = { bridgeJobId: claimed.id, bridgeJobName: claimed.name, browserTarget: claimed.name === "desktop.flow.quality" || claimed.name === "desktop.gemini.videos" ? "gemini" : "google-flow", ...(typeof payload.codexJobId === "string" ? { codexJobId: payload.codexJobId } : {}), ...(typeof payload.stage === "string" ? { stage: payload.stage } : {}) };
  const sender = { send: (channel, update) => notifyUpdate("flow-bridge-progress", { jobId: claimed.id, channel, payload: update }) };
  const event = { sender };
  try {
    let result;
    if (claimed.name === "desktop.flow.images") {
      result = await runFlowImageJob(event, payload.projectId, payload.channelId, payload.slots);
    } else if (claimed.name === "desktop.flow.videos") {
      if (payload.provider === "gemini-cdp") throw new Error("VIDEO_PROVIDER_EXECUTOR_MISMATCH");
      result = await runFlowVideoJob(event, payload.projectId, payload.channelId, payload.slots);
    } else if (claimed.name === "desktop.gemini.videos") {
      if (payload.provider !== "gemini-cdp") throw new Error("VIDEO_PROVIDER_EXECUTOR_MISMATCH");
      result = await runGeminiVideoJob(event, payload.projectId, payload.channelId, payload.slots);
    } else if (claimed.name === "desktop.flow.quality") {
      result = await withFlowOperation(() => runBrowserQualityJob(payload));
    } else {
      throw new Error(`Không hỗ trợ loại job Flow ${claimed.name}.`);
    }
    await requestDesktopFlowBridge(`/api/v1/desktop-flow/jobs/${encodeURIComponent(claimed.id)}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "succeeded", result: redactDesktopRuntime(result) }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const structuredFailure = serializeGeminiError(error);
    await captureBrowserFailure(activeDesktopFlowBridgeContext.browserTarget === "gemini" ? getGeminiWindow() : getFlowWindow(), { action: "desktop-flow-job", state: "BRIDGE_FAILED", jobName: claimed.name, error: message, ...activeDesktopFlowBridgeContext });
    try {
      await requestDesktopFlowBridge(`/api/v1/desktop-flow/jobs/${encodeURIComponent(claimed.id)}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "failed", error: redactDesktopRuntime(message), failure: redactDesktopRuntime(structuredFailure) }) });
    } catch (reportError) {
      void reportDesktopRuntimeFailure("electron:flow-bridge:complete", reportError, activeDesktopFlowBridgeContext);
    }
  } finally {
    clearInterval(heartbeat);
    if (activeDesktopFlowBridgeContext.browserTarget === "google-flow") await closeFlowWindow();
    activeDesktopFlowBridgeContext = {};
  }
}

async function pollDesktopFlowBridge() {
  if (desktopFlowBridgeBusy || isQuitting) return;
  desktopFlowBridgeBusy = true;
  try {
    const jobs = await requestDesktopFlowBridge("/api/v1/desktop-flow/jobs");
    if (Array.isArray(jobs)) for (const job of jobs) await processDesktopFlowBridgeJob(job);
  } catch (error) {
    if (Date.now() - lastDesktopFlowBridgeErrorAt >= 60_000) {
      lastDesktopFlowBridgeErrorAt = Date.now();
      void reportDesktopRuntimeFailure("electron:flow-bridge:poll", error, { appUrl: APP_URL });
    }
  } finally {
    desktopFlowBridgeBusy = false;
  }
}

function startDesktopFlowBridge() {
  if (desktopFlowBridgeTimer) return;
  void pollDesktopFlowBridge();
  desktopFlowBridgeTimer = setInterval(() => { void pollDesktopFlowBridge(); }, 1_000);
}

function monitorChildProcess(child, name) {
  child.on("error", (error) => { void reportDesktopRuntimeFailure(`electron:${name}:error`, error, { process: name }); });
  child.on("exit", (code, signal) => {
    if (isQuitting || code === 0) return;
    void reportDesktopRuntimeFailure(`electron:${name}:exit`, new Error(`${name} stopped unexpectedly (code=${code ?? "null"}, signal=${signal ?? "none"}).`), { process: name, code, signal });
  });
}

process.on("uncaughtException", (error) => {
  if (fatalRuntimeReported) return;
  fatalRuntimeReported = true;
  void reportDesktopRuntimeFailure("electron:main:uncaught-exception", error, activeDesktopFlowBridgeContext).finally(() => app.quit());
});
process.on("unhandledRejection", (reason) => {
  if (fatalRuntimeReported) return;
  fatalRuntimeReported = true;
  void reportDesktopRuntimeFailure("electron:main:unhandled-rejection", reason, activeDesktopFlowBridgeContext).finally(() => app.quit());
});

function runtimeRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "electron", "dist")
    : path.join(__dirname, "dist");
}

async function startLocalServices() {
  if (!app.isPackaged || process.env.DESKTOP_APP_URL) return;
  const appDirectory = path.join(runtimeRoot(), "app");
  const environment = ensureRuntime();
  await ensureLocalDatabaseSchema(environment.DATABASE_URL);
  const log = fs.openSync(path.join(app.getPath("userData"), "desktop-runtime.log"), "a");
  serverProcess = spawn(process.execPath, [path.join(appDirectory, "server.js")], { cwd: appDirectory, env: environment, windowsHide: true, stdio: ["ignore", log, log] });
  workerProcess = spawn(process.execPath, [path.join(appDirectory, "worker.cjs")], { cwd: appDirectory, env: environment, windowsHide: true, stdio: ["ignore", log, log] });
  monitorChildProcess(serverProcess, "server");
  monitorChildProcess(workerProcess, "worker");
}

function waitForServer(attempts = 60) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      const request = http.get(`${APP_URL}/api/health`, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) resolve();
        else if (remaining > 0) setTimeout(() => check(remaining - 1), 500);
        else reject(new Error("Local server did not become ready"));
      });
      request.on("error", () => {
        if (remaining > 0) setTimeout(() => check(remaining - 1), 500);
        else reject(new Error("Local server did not become ready"));
      });
    };
    check(attempts);
  });
}

autoUpdater.autoDownload = false;
autoUpdater.on("update-available", (info) => notifyUpdate("available", { version: info.version }));
autoUpdater.on("update-not-available", () => notifyUpdate("not-available"));
autoUpdater.on("download-progress", (progress) => notifyUpdate("progress", { percent: Math.round(progress.percent) }));
autoUpdater.on("update-downloaded", () => notifyUpdate("downloaded"));
autoUpdater.on("error", (error) => { notifyUpdate("error", { message: error.message }); void reportDesktopRuntimeFailure("electron:auto-updater:error", error); });

ipcMain.handle("desktop-update:check", async () => {
  if (!app.isPackaged) return { status: "dev" };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: result?.updateInfo.version === app.getVersion() ? "not-available" : "checking" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Không thể kiểm tra cập nhật." };
  }
});
ipcMain.handle("desktop-app:version", () => ({ version: app.getVersion() }));
ipcMain.handle("desktop-update:download", async () => {
  await autoUpdater.downloadUpdate();
  return { status: "downloading" };
});
ipcMain.handle("desktop-update:install", () => {
  markSyncAfterUpdate();
  autoUpdater.quitAndInstall();
});
ipcMain.handle("desktop-auth:save", (_event, value) => {
  if (!value || typeof value.token !== "string" || typeof value.expiresAt !== "string") throw new Error("Phiên đăng nhập không hợp lệ.");
  updateDesktopSession({ token: value.token, expiresAt: value.expiresAt });
  return { status: "saved" };
});
ipcMain.handle("desktop-auth:clear", (event) => {
  updateDesktopSession(null);
  return event.sender.session.cookies.remove(APP_URL, "ai_content_modeling_session").then(() => ({ status: "cleared" }));
});

ipcMain.handle("runtime-error:report", async (_event, value) => {
  if (!value || typeof value.source !== "string" || typeof value.message !== "string") return { status: "ignored" };
  const reported = await reportDesktopRuntimeFailure(value.source.slice(0, 120), new Error(value.message.slice(0, 4000)), { ...(value.context && typeof value.context === "object" ? value.context : {}), clientStack: typeof value.stack === "string" ? value.stack.slice(0, 12000) : undefined });
  return { status: reported ? "reported" : "queued-locally" };
});

function createFacebookWindow() {
  if (facebookWindow && !facebookWindow.isDestroyed()) {
    facebookWindow.show();
    facebookWindow.focus();
    return facebookWindow;
  }
  facebookWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    title: "Facebook — Modeling AI",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:modeling-ai-facebook",
    },
  });
  facebookWindow.on("closed", () => { facebookWindow = undefined; });
  void facebookWindow.loadURL("https://www.facebook.com/");
  return facebookWindow;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function getRemoteDebuggingPort() {
  const argument = process.argv.find((value) => value.startsWith("--remote-debugging-port="));
  const port = Number(argument?.split("=")[1]);
  if (Number.isInteger(port) && port > 0) return port;
  try {
    const activePortPath = path.join(app.getPath("userData"), "DevToolsActivePort");
    const activePort = Number(fs.readFileSync(activePortPath, "utf8").split(/\r?\n/, 1)[0]);
    return Number.isInteger(activePort) && activePort > 0 ? activePort : null;
  } catch {
    return null;
  }
}

function readRemoteDebuggingTargets(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: "127.0.0.1", port, path: "/json/list" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.setTimeout(2_000, () => request.destroy(new Error("Remote CDP timeout.")));
  });
}

async function waitForRemoteFlowTarget(url, timeout = 10_000) {
  const port = getRemoteDebuggingPort();
  if (!port || typeof globalThis.WebSocket !== "function") return null;
  for (let elapsed = 0; elapsed < timeout; elapsed += 250) {
    try {
      const targets = await readRemoteDebuggingTargets(port);
      const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl && (item.url === url || /flow\.google\.com\/project\//i.test(item.url)));
      if (target) return target;
    } catch { /* Cổng debug có thể chưa sẵn sàng. */ }
    await delay(250);
  }
  return null;
}

async function getFlowRemoteClient(window) {
  if (window?.edgeRuntime) return null;
  if (process.env.DESKTOP_FLOW_LOCAL_CDP === "1") return null;
  if (!getRemoteDebuggingPort() || window !== flowWindow || typeof globalThis.WebSocket !== "function") return null;
  if (flowRemoteClient) {
    const expectedUrl = window.webContents.getURL();
    const remoteUrl = await flowRemoteClient.evaluate("location.href").catch(() => null);
    if (remoteUrl === expectedUrl) return flowRemoteClient;
    flowRemoteClient.close();
    flowRemoteClient = undefined;
  }
  const target = await waitForRemoteFlowTarget(window.webContents.getURL(), 15_000);
  if (!target) return null;
  const client = connectRemoteCdp(target.webSocketDebuggerUrl);
  await client.ready();
  flowRemoteClient = client;
  return client;
}

async function executeFlowJavaScript(window, expression) {
  const remoteClient = await getFlowRemoteClient(window);
  if (remoteClient) return remoteClient.evaluate(expression);
  return window.webContents.executeJavaScript(expression, true);
}

function connectRemoteCdp(webSocketDebuggerUrl) {
  const socket = new globalThis.WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const events = [];
  let opened = false;
  let openResolve;
  let openReject;
  const openPromise = new Promise((resolve, reject) => { openResolve = resolve; openReject = reject; });
  socket.onopen = () => { opened = true; openResolve(); };
  socket.onerror = (event) => { if (!opened) openReject(new Error("Không kết nối được remote CDP Google Flow.")); for (const request of pending.values()) request.reject(new Error("Remote CDP đã lỗi.")); pending.clear(); };
  socket.onclose = () => { for (const request of pending.values()) request.reject(new Error("Remote CDP đã đóng kết nối.")); pending.clear(); };
  socket.onmessage = async (message) => {
    let payload;
    try {
      let raw = message.data;
      if (typeof raw !== "string") {
        if (typeof raw?.text === "function") raw = await raw.text();
        else if (raw instanceof ArrayBuffer) raw = Buffer.from(raw).toString("utf8");
        else if (ArrayBuffer.isView(raw)) raw = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("utf8");
        else raw = String(raw);
      }
      payload = JSON.parse(raw);
    } catch { return; }
    if (payload.id && pending.has(payload.id)) {
      const request = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) request.reject(new Error(payload.error.message || "Remote CDP command failed."));
      else request.resolve(payload);
    } else if (payload.method) events.push(payload);
  };
  return {
    async ready() { await openPromise; },
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression) {
      const response = await this.send("Runtime.evaluate", { expression, returnByValue: true });
      return response?.result?.result?.value;
    },
    async waitForEvent(method, timeout = 12_000) {
      for (let elapsed = 0; elapsed < timeout; elapsed += 250) {
        const index = events.findIndex((event) => event.method === method);
        if (index >= 0) return events.splice(index, 1)[0].params || {};
        await delay(250);
      }
      return null;
    },
    close() { try { socket.close(); } catch { /* Kết nối có thể đã đóng. */ } },
  };
}

async function remoteFlowPoint(client, labels, exact = false) {
  return client.evaluate(`(() => {
    const wanted = ${JSON.stringify(labels)}.map((value) => value.toLowerCase().replace(/\\s+/g, ' ').trim());
    const exactMatch = ${JSON.stringify(exact)};
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      }
    }
    const labelsFor = (element) => [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).map((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase()).filter(Boolean);
    const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
    const candidates = roots.flatMap((root) => [...root.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"], [role="radio"], a')]).filter((element) => !element.disabled && visible(element));
    const matches = candidates.filter((element) => labelsFor(element).some((label) => exactMatch ? wanted.some((value) => label === value || label.startsWith(value + ' ') || label.endsWith(value)) : wanted.some((value) => label === value || label.includes(value))));
    const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"]')]).find(visible);
    const inputBounds = input?.getBoundingClientRect();
    const score = (element) => { const labels = labelsFor(element); const exactRank = labels.some((label) => wanted.includes(label)) ? 0 : 1; const bounds = element.getBoundingClientRect(); const distance = inputBounds ? Math.hypot(bounds.left - inputBounds.left, bounds.top - inputBounds.top) : 0; return exactRank * 1000000 + distance; };
    const selected = matches.sort((left, right) => score(left) - score(right))[0];
    if (!selected) return null;
    const bounds = selected.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  })()`);
}

async function waitForRemoteFlowPoint(client, labels, exact = false, timeout = 15_000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 500) {
    const point = await remoteFlowPoint(client, labels, exact).catch(() => null);
    if (point) return point;
    await delay(500);
  }
  throw new Error("Không tìm thấy điều khiển Google Flow qua CDP: " + labels.join(" / ") + ".");
}

async function remoteFlowClick(client, point) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(point.x), y: Math.round(point.y) });
  await delay(120);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(point.x), y: Math.round(point.y), button: "left", clickCount: 1 });
  await delay(70);
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(point.x), y: Math.round(point.y), button: "left", clickCount: 1 });
}

async function waitForRemoteFlowUploadPoint(client, timeout = 15_000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 500) {
    const point = await client.evaluate(`(() => {
      const roots = [document]; const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
      const selected = roots.flatMap((root) => [...root.querySelectorAll('button[role="menuitem"], [role="menuitem"], flow-menu-item, [data-menu-item]')]).find((element) => {
        if (!visible(element) || element.disabled) return false;
        const values = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).map(normalize);
        const combined = values.join(' ');
        return values.includes('upload') || (combined.includes('upload') && !combined.includes('uploads'));
      });
      if (!selected) return null; const bounds = selected.getBoundingClientRect(); return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`);
    if (point) return point;
    await delay(500);
  }
  throw new Error("Không tìm thấy mục Upload trong menu Google Flow qua CDP.");
}

async function waitForRemoteFlowAsset(client, filename, beforeImageCount = 0) {
  for (let elapsed = 0; elapsed < 60_000; elapsed += 500) {
    const ready = await client.evaluate(`(() => {
      const target = ${JSON.stringify(filename)}.toLowerCase(); const text = document.body?.innerText || '';
      const uploading = /đang tải lên|uploading|đang tải bản xem trước|loading preview|\\b(?:[1-9]?\\d)%\\b/i.test(text);
      const roots = [document]; const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      const hasFilename = roots.flatMap((root) => [...root.querySelectorAll('*')]).some((element) => [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('alt')].filter(Boolean).some((value) => value.toLowerCase().includes(target)));
      const visibleImages = roots.flatMap((root) => [...root.querySelectorAll('img')]).filter((image) => { const bounds = image.getBoundingClientRect(); const style = getComputedStyle(image); return bounds.width >= 32 && bounds.height >= 32 && image.complete && (image.naturalWidth || image.width) >= 64 && style.visibility !== 'hidden' && style.display !== 'none'; }).length;
      // Giữ đúng cơ chế ổn định của các bản trước: trong lúc Flow chưa kịp
      // hiện tên file, một ảnh mới đã tải xong vẫn là bằng chứng upload hợp lệ.
      return !uploading && (hasFilename || visibleImages > ${beforeImageCount});
    })()`);
    if (ready) return;
    await delay(500);
  }
  throw new Error("Google Flow chưa tải xong ảnh " + filename + ".");
}

async function uploadFlowAssetViaRemoteCdp(window, filePath, attachToPrompt, onStatus) {
  const client = await getFlowRemoteClient(window);
  if (!client) return false;
  try {
    onStatus("Đã kết nối target Google Flow bằng CDP.");
    const filename = path.basename(filePath);
    const previousAttachmentCount = attachToPrompt ? await countFlowPromptAttachments(window) : 0;
    const beforeImageCount = await client.evaluate(`(() => [...document.querySelectorAll('img')].filter((image) => image.complete && (image.naturalWidth || image.width) >= 64).length)()`);
    const mediaPoint = await waitForRemoteFlowPoint(client, ["Add media menu", "Thêm nội dung nghe nhìn", "Thêm phương tiện"], true);
    await client.send("Page.enable", { enableFileChooserOpenedEvent: true }).catch(() => client.send("Page.enable"));
    await client.send("Page.setInterceptFileChooserDialog", { enabled: true });
    await client.evaluate(`document.querySelector('button[aria-label="Add media menu"]').click()`);
    await delay(600);
    onStatus("Đã mở menu thêm nội dung bằng CDP, đang tìm Upload...");
    const uploadPoint = await waitForRemoteFlowUploadPoint(client);
    onStatus("Đã tìm thấy Upload bằng CDP.");
    await remoteFlowClick(client, uploadPoint);
    onStatus("Đã nhấn Upload bằng CDP, đang chờ hộp chọn tệp Google Flow...");
    const chooser = await client.waitForEvent("Page.fileChooserOpened", 12_000);
    if (!chooser?.backendNodeId) throw new Error("Google Flow không trả về backendNodeId cho file chooser qua CDP: " + JSON.stringify(chooser));
    await client.send("DOM.enable").catch(() => {});
    await client.send("DOM.setFileInputFiles", { files: [filePath], backendNodeId: chooser.backendNodeId });
    onStatus("Đã gắn tệp vào Google Flow bằng CDP, đang chờ Flow lưu ảnh...");
    await waitForRemoteFlowAsset(client, filename, beforeImageCount);
    if (!attachToPrompt) return true;
    await attachFlowAssetToPrompt(window, filename, previousAttachmentCount);
    return true;
  } finally { /* Giữ phiên CDP dùng chung cho các bước tiếp theo của Flow. */ }
}

async function scanFacebookPages(entries, onProgress) {
  const browser = createFacebookWindow();
  const results = [];
  onProgress?.({ processed: 0, total: entries.length });
  try {
    for (const [index, entry] of entries.entries()) {
      try {
      const videosUrl = `${entry.url.replace(/\/$/, "")}/videos`;
      await browser.loadURL(videosUrl);
      await delay(2500);
      await browser.webContents.executeJavaScript("window.scrollTo(0, Math.max(document.body.scrollHeight * 0.6, 1400));", true);
      await delay(2500);
      const page = await browser.webContents.executeJavaScript(`
        (async () => {
          const currentUrl = window.location.href;
          if (currentUrl.includes("/login") || document.body.innerText.includes("Log in to Facebook")) {
            return { needsLogin: true, items: [] };
          }
          const compactNumber = (value) => {
            if (value === null || value === undefined) return null;
            const normalized = String(value).replace(/\\u00a0/g, " ").trim().toLowerCase();
            const match = normalized.match(/([0-9][0-9.,\\s]*)(k|m|b|triệu|tr|million|billion)?/i);
            if (!match) return null;
            const raw = match[1].replace(/\\s/g, "");
            const unit = match[2] || "";
            let number;
            if (unit) {
              const comma = raw.lastIndexOf(",");
              const dot = raw.lastIndexOf(".");
              const decimal = comma > dot ? raw.replace(/\\./g, "").replace(",", ".") : raw.replace(/,/g, "");
              number = Number.parseFloat(decimal);
            } else {
              number = Number(raw.replace(/[.,]/g, ""));
            }
            if (!Number.isFinite(number)) return null;
            const multiplier = /^(k|tr)$/i.test(unit) ? 1_000 : /^(m|triệu|million)$/i.test(unit) ? 1_000_000 : /^(b|billion)$/i.test(unit) ? 1_000_000_000 : 1;
            return Math.round(number * multiplier);
          };
          const metricFromText = (text, labels, container, allowUnitFallback = false) => {
            const source = String(text || "");
            const labelled = source.match(new RegExp("([0-9][0-9.,\\\\s]*\\\\s*(?:K|M|B|triệu|tr|million|billion)?)\\\\s*(?:" + labels + ")", "i"));
            if (labelled) return compactNumber(labelled[1]);
            const labelledAttribute = [...(container?.querySelectorAll?.("[aria-label],[title]") || [])]
              .map((node) => node.getAttribute("aria-label") || node.getAttribute("title") || "")
              .find((value) => new RegExp(labels, "i").test(value));
            if (labelledAttribute) return compactNumber(labelledAttribute);
            if (!allowUnitFallback) return null;
            const unitOnly = source.match(/(?:^|[\\n\\r\\s])([0-9][0-9.,\\s]*\\s*(?:K|M|B|triệu|tr|million|billion))(?=$|[\\n\\r\\s])/i);
            return compactNumber(unitOnly?.[1] || null);
          };
          const durationSeconds = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
          const mediaRect = (media) => { const rect = media?.getBoundingClientRect?.(); return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null; };
          const visibleMedia = (media) => { const bounds = mediaRect(media); const style = media ? getComputedStyle(media) : null; return Boolean(media && media.isConnected && bounds && bounds.width > 0 && bounds.height > 0 && style?.visibility !== 'hidden' && style?.display !== 'none' && style?.opacity !== '0' && !media.closest('[aria-hidden="true"]')); };
          const mediaSourceValues = (video) => [video.currentSrc, video.src, ...[...(video.querySelectorAll?.('source[src]') || [])].map((source) => source.src || source.getAttribute('src'))].filter(Boolean);
          const nearestCommonAncestor = (left, right) => { const ancestors = new Set(); for (let node = left; node; node = node.parentElement) ancestors.add(node); for (let node = right; node; node = node.parentElement) if (ancestors.has(node)) return node; return null; };
          const rectanglesRelated = (left, right) => { if (!left || !right) return false; const horizontalGap = Math.max(left.left - right.right, right.left - left.right, 0); const verticalGap = Math.max(left.top - right.bottom, right.top - left.bottom, 0); const scale = Math.max(left.width, left.height, right.width, right.height); return horizontalGap === 0 && verticalGap === 0 || horizontalGap <= scale && verticalGap <= scale; };
          const reelRelation = (anchor, container, video) => {
            const videoBounds = mediaRect(video);
            const viewportIntersecting = Boolean(videoBounds && videoBounds.x < window.innerWidth && videoBounds.x + videoBounds.width > 0 && videoBounds.y < window.innerHeight && videoBounds.y + videoBounds.height > 0);
            if (container?.contains?.(video)) return { verified: true, structuralRelation: true, reason: 'DIRECT_CARD_DESCENDANT', commonAncestorTag: container.tagName || null, commonAncestorIdentity: container.id || container.getAttribute?.('data-testid') || container.getAttribute?.('role') || container.tagName || null, ancestorSpecificity: { targetAnchorCount: 1, mediaCount: 1, semanticSignal: true, rootLike: false }, spatiallyRelated: true, viewportIntersecting };
            const common = nearestCommonAncestor(anchor, video);
            if (!common || common === document.body || common === document.documentElement) return { verified: false, structuralRelation: false, reason: 'NO_SCOPED_COMMON_ANCESTOR', commonAncestorTag: common?.tagName || null, commonAncestorIdentity: null, ancestorSpecificity: { targetAnchorCount: 0, mediaCount: 0, semanticSignal: false, rootLike: true }, spatiallyRelated: false, viewportIntersecting };
            const targetPath = (() => { try { return new URL(anchor?.href || '').pathname; } catch { return ''; } })();
            const targetAnchorCount = [...common.querySelectorAll('a[href]')].filter((candidate) => { try { return new URL(candidate.href).pathname === targetPath; } catch { return false; } }).length;
            const mediaCount = common.querySelectorAll('video').length;
            const role = common.getAttribute?.('role') || '';
            const semanticSignal = Boolean(['article', 'feed', 'listitem', 'region'].includes(role) || common.hasAttribute?.('data-pagelet') || common.hasAttribute?.('data-testid') || common.hasAttribute?.('aria-label'));
            const rootLike = role === 'main' || ['root', '__next'].includes(common.id);
            const boundedSpecificity = targetAnchorCount > 0 && targetAnchorCount <= 4 && mediaCount > 0 && mediaCount <= 4;
            const structuralRelation = !rootLike && (semanticSignal || boundedSpecificity);
            const anchorRect = anchor?.getBoundingClientRect?.();
            const videoRect = video?.getBoundingClientRect?.();
            const left = anchorRect ? { left: anchorRect.left, top: anchorRect.top, right: anchorRect.right, bottom: anchorRect.bottom, width: anchorRect.width, height: anchorRect.height } : null;
            const right = videoRect ? { left: videoRect.left, top: videoRect.top, right: videoRect.right, bottom: videoRect.bottom, width: videoRect.width, height: videoRect.height } : null;
            const spatiallyRelated = rectanglesRelated(left, right);
            return { verified: structuralRelation, structuralRelation, reason: structuralRelation ? (spatiallyRelated ? 'COMMON_ANCESTOR_STRUCTURAL_AND_SPATIAL' : 'COMMON_ANCESTOR_STRUCTURAL_OFFSCREEN') : (rootLike ? 'ROOT_ANCESTOR_INSUFFICIENT' : 'COMMON_ANCESTOR_SCOPE_INSUFFICIENT'), commonAncestorTag: common.tagName || null, commonAncestorRole: role || null, commonAncestorIdentity: common.id || common.getAttribute?.('data-testid') || common.getAttribute?.('data-pagelet') || role || common.tagName || null, ancestorSpecificity: { targetAnchorCount, mediaCount, semanticSignal, rootLike }, spatiallyRelated, viewportIntersecting };
          };
          const resolveReelScope = (href) => {
            const reelPath = (() => { try { return new URL(href).pathname; } catch { return href; } })();
            const anchors = [...document.querySelectorAll('a[href]')].filter((candidate) => candidate.href === href || (() => { try { return new URL(candidate.href).pathname === reelPath; } catch { return false; } })());
            const anchor = anchors[0] || null;
            let container = anchor?.closest('[role="article"]') || anchor || null;
            if (container && !String(container.innerText || '').trim() && container.parentElement) container = container.parentElement;
            if (anchor && !anchor.closest('[role="article"]')) for (let level = 0; level < 6 && container?.parentElement; level += 1) { if (container.innerText && container.innerText.length > 30) break; container = container.parentElement; }
            return { reelPath, anchor, container, targetAnchorFound: Boolean(anchor), targetAnchorCount: anchors.length };
          };
          const readBoundMedia = (href) => {
            const scope = resolveReelScope(href);
            const { reelPath, anchor, container } = scope;
            const rawVideos = [...document.querySelectorAll('video')];
            const attachedVideos = rawVideos.filter((video) => video.isConnected);
            const visibleVideos = attachedVideos.filter((video) => visibleMedia(video));
            const nonAdVideos = visibleVideos.filter((video) => {
              const mediaText = [video.currentSrc, video.src, video.getAttribute('aria-label'), video.getAttribute('title'), video.className, ...mediaSourceValues(video)].filter(Boolean).join(' ');
              const containerText = String(container?.innerText || '').slice(0, 500);
              return !/sponsored|advertisement|quảng cáo/i.test(mediaText + ' ' + containerText);
            });
            const relationCandidates = nonAdVideos.map((video) => {
              const mediaText = [video.currentSrc, video.src, video.getAttribute('aria-label'), video.getAttribute('title'), video.className, ...mediaSourceValues(video)].filter(Boolean).join(' ');
              const relation = reelRelation(anchor, container, video);
              return { video, relation, sourceMatch: mediaText.includes(reelPath) || mediaText.includes(href) };
            }).filter((candidate) => candidate.relation.verified);
            const diagnostics = rawVideos.map((video, index) => {
              const mediaText = [video.currentSrc, video.src, video.getAttribute('aria-label'), video.getAttribute('title'), video.className, ...mediaSourceValues(video)].filter(Boolean).join(' ');
              const relation = reelRelation(anchor, container, video);
              return { index, attached: Boolean(video.isConnected), visible: visibleMedia(video), isAd: /sponsored|advertisement|quảng cáo/i.test(mediaText + ' ' + String(container?.innerText || '').slice(0, 500)), relationVerified: relation.verified, structuralRelation: relation.structuralRelation, relationReason: relation.reason, commonAncestorTag: relation.commonAncestorTag, commonAncestorRole: relation.commonAncestorRole, commonAncestorIdentity: relation.commonAncestorIdentity, ancestorSpecificity: relation.ancestorSpecificity, viewportIntersecting: relation.viewportIntersecting, spatialTieBreakerUsed: false, finalRelationAccepted: relation.verified, sourceMatch: mediaText.includes(reelPath) || mediaText.includes(href), boundingBox: mediaRect(video) };
            });
            const finalCandidates = relationCandidates.map(({ video, relation, sourceMatch }) => ({ durationSec: durationSeconds(video.duration), readyState: video.readyState, visible: visibleMedia(video), attached: Boolean(video.isConnected), hidden: Boolean(video.closest('[hidden], [aria-hidden="true"]')), zeroSize: !visibleMedia(video), relationVerified: relation.verified, structuralRelation: relation.structuralRelation, relationReason: relation.reason, commonAncestorIdentity: relation.commonAncestorIdentity, ancestorSpecificity: relation.ancestorSpecificity, viewportIntersecting: relation.viewportIntersecting, spatialTieBreakerUsed: false, finalRelationAccepted: relation.verified, sourceMatch, isAd: false, boundingBox: mediaRect(video) }));
            const exact = finalCandidates.filter((candidate) => candidate.sourceMatch === true);
            const selected = exact.length === 1 ? exact[0] : exact.length === 0 && finalCandidates.length === 1 ? finalCandidates[0] : null;
            const ambiguous = exact.length > 1 || (exact.length === 0 && finalCandidates.length > 1);
            const bindingResolved = selected !== null;
            return { ...scope, durationSec: selected?.durationSec ?? null, bindingResolved, failureCode: !bindingResolved && ambiguous ? 'FACEBOOK_REEL_MEDIA_BINDING_AMBIGUOUS' : !bindingResolved && finalCandidates.length === 0 ? 'FACEBOOK_REEL_MEDIA_NOT_FOUND' : null, waitingForDuration: bindingResolved && selected?.durationSec === null, videoCountRaw: rawVideos.length, afterAttachedFilter: attachedVideos.length, afterVisibleFilter: visibleVideos.length, afterNonAdFilter: nonAdVideos.length, afterReelRelationFilter: relationCandidates.length, finalMediaCandidateCount: finalCandidates.length, candidateDiagnostics: diagnostics, finalCandidates };
          };
          const waitForBoundMediaDiscovery = async (href) => { const startedAt = Date.now(); const deadline = startedAt + ${FACEBOOK_MEDIA_DISCOVERY_TIMEOUT_MS}; let pollCount = 0; let diagnostic = readBoundMedia(href); while (Date.now() <= deadline) { diagnostic = { ...readBoundMedia(href), discoveryPollCount: ++pollCount, discoveryElapsedMs: Date.now() - startedAt }; if (diagnostic.bindingResolved) return { ...diagnostic, discoveryTimedOut: false }; await new Promise((resolve) => setTimeout(resolve, ${FACEBOOK_MEDIA_POLL_INTERVAL_MS})); } return { ...diagnostic, discoveryTimedOut: true, failureCode: diagnostic.finalMediaCandidateCount > 1 ? 'FACEBOOK_REEL_MEDIA_BINDING_AMBIGUOUS' : 'FACEBOOK_REEL_MEDIA_NOT_FOUND' }; };
          const waitForBoundDuration = async (href, discovery) => { const startedAt = Date.now(); const deadline = startedAt + 2000; let pollCount = 0; let diagnostic = discovery; while (Date.now() <= deadline) { diagnostic = { ...readBoundMedia(href), discoveryPollCount: discovery.discoveryPollCount, discoveryElapsedMs: discovery.discoveryElapsedMs, durationPollCount: ++pollCount, durationElapsedMs: Date.now() - startedAt }; if (!diagnostic.bindingResolved && (diagnostic.failureCode === 'FACEBOOK_REEL_MEDIA_BINDING_AMBIGUOUS' || diagnostic.failureCode === 'FACEBOOK_REEL_MEDIA_NOT_FOUND')) return { ...diagnostic, durationTimedOut: false }; if (diagnostic.bindingResolved && diagnostic.durationSec !== null) return { ...diagnostic, durationTimedOut: false }; await new Promise((resolve) => setTimeout(resolve, 100)); } return { ...diagnostic, durationTimedOut: true }; };
          const relativeDate = (text) => {
            const match = text.match(/\\b(\\d+)\\s*(h|giờ|m|phút|d|ngày)\\b/i);
            if (!match) return null;
            const amount = Number(match[1]);
            const unit = match[2].toLowerCase();
            const minutes = unit === "m" || unit === "phút" ? amount : unit === "h" || unit === "giờ" ? amount * 60 : amount * 1440;
            return new Date(Date.now() - minutes * 60_000).toISOString();
          };
          const found = new Map();
          for (const anchor of document.querySelectorAll("a[href]")) {
            // Facebook renders many duplicate links per card. The /videos
            // page is ordered newest-first, so stop after the first ten
            // unique candidates instead of waiting on every historical reel.
            if (found.size >= 10) break;
            const href = anchor.href;
            if (!/\\/(reel|videos|posts)\\//.test(href) && !/watch\\/?\\?v=/.test(href) && !/\\/share\\/r\\//.test(href)) continue;
            if (found.has(href)) continue;
            let container = anchor.closest('[role="article"]');
            if (!container) {
              container = anchor;
              for (let level = 0; level < 6 && container.parentElement; level += 1) {
                if (container.innerText && container.innerText.length > 30) break;
                container = container.parentElement;
              }
            }
            const text = (container?.innerText || anchor.innerText || "").trim();
            if (!text) continue;
            const views = metricFromText(text, "views|lượt xem|view|đã xem", container, true);
            const likes = metricFromText(text, "reactions|likes|lượt thích|thích", container);
            const comments = metricFromText(text, "comments|bình luận", container);
            const shares = metricFromText(text, "shares|lượt chia sẻ|chia sẻ", container);
            const discovery = await waitForBoundMediaDiscovery(href);
            const mediaBinding = discovery.bindingResolved && discovery.durationSec === null ? await waitForBoundDuration(href, discovery) : discovery;
            found.set(href, { url: href, caption: text.slice(0, 1000), publishedAt: relativeDate(text), views, likes, comments, shares, durationSec: mediaBinding.durationSec, mediaBinding });
          }
          return { needsLogin: false, items: [...found.values()].slice(0, 10) };
        })()
      `, true);
        for (const item of page.items || []) {
          if (!item?.mediaBinding) continue;
          recordBrowserAction({ action: "facebook-media-binding", success: !item.mediaBinding.failureCode && item.mediaBinding.durationSec !== null, targetReelUrl: item.url, ...item.mediaBinding });
        }
        results.push({ competitorId: entry.id, sourceUrl: entry.url, ...page });
      } catch (error) {
        results.push({ competitorId: entry.id, sourceUrl: entry.url, needsLogin: false, items: [], error: error instanceof Error ? error.message : "Không thể mở Trang Facebook." });
      }
      onProgress?.({ processed: index + 1, total: entries.length });
    }
  } finally {
    if (!browser.isDestroyed()) browser.close();
  }
  return results;
}

ipcMain.handle("facebook-browser:open", () => {
  createFacebookWindow();
  return { status: "opened" };
});
ipcMain.handle("facebook-browser:scan", async (_event, entries) => {
  if (!Array.isArray(entries)) throw new Error("Danh sách đối thủ không hợp lệ.");
  const validEntries = entries.filter((entry) => entry && typeof entry.id === "string" && typeof entry.url === "string");
  return scanFacebookPages(validEntries, (progress) => sendProgress(_event, "facebook-browser:scan-progress", progress));
});

ipcMain.handle("gemini-browser:open", async (_event, prompt) => {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("Prompt Gemini không hợp lệ.");
  clipboard.writeText(prompt.trim());
  const window = await createGeminiWindow();
  const state = await preflightGeminiBrowser(window);
  return { status: "opened", provider: "EDGE_CDP", runtime: window.edgeRuntime?.status?.() ?? null, authenticated: state?.authenticated ?? null, composerReady: state?.inputReady === true || state?.composerReady === true };
});

ipcMain.handle("gemini-browser:copy", (_event, prompt) => {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("Prompt Gemini không hợp lệ.");
  clipboard.writeText(prompt.trim());
  return { status: "copied" };
});

ipcMain.handle("gemini-browser:analyze-source", async (_event, value) => {
  if (!value?.video || typeof value.video.id !== "string" || typeof value.video.url !== "string") throw new Error("SOURCE_ANALYSIS_BROWSER_INVALID_REQUEST");
  return withGeminiBrowserOperation(() => runBrowserSourceAnalysisJobUnlocked({ stage: "ANALYSIS", purpose: "SOURCE_ANALYSIS", video: value.video, channelDNA: value.channelDNA ?? {}, runId: value.runId || null }));
});

ipcMain.handle("gemini-browser:generate-idea", async (_event, value) => {
  if (!value?.video || !value?.analysis) throw new Error("MODELING_IDEA_BROWSER_INVALID_REQUEST");
  return withGeminiBrowserOperation(() => runBrowserModelingIdeaJobUnlocked(value));
});

ipcMain.handle("gemini-browser:develop-project", async (_event, value) => {
  try {
    if (!value?.video || !value?.analysis || !value?.idea) throw new Error("CONTENT_PROJECT_BROWSER_INVALID_REQUEST");
    const data = await withGeminiBrowserOperation(() => runBrowserDevelopedIdeaJobUnlocked(value));
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: serializeGeminiError(error) };
  }
});

async function runBrowserSourceAnalysisJobUnlocked(payload) {
    const window = await createGeminiWindow();
  await preflightGeminiForRun(window, payload.runId, "SOURCE_ANALYSIS");
  await delay(3_000);
  const video = payload.video && typeof payload.video === "object" ? payload.video : {};
  const channelDNA = payload.channelDNA && typeof payload.channelDNA === "object" ? payload.channelDNA : {};
  const prompt = `Analyze the source short-form video using the browser/session context and the source URL below when it is accessible. Do not invent details that cannot be observed; state uncertainty briefly inside the relevant text field. Return ONE valid JSON object only, no Markdown and no commentary, with exactly these keys: schemaVersion (string "1.0"), summary, hook, setup, conflict, escalation, twist, payoff, theGag, cameraPattern, editingRhythm, soundPattern, retentionMechanism (all strings), characterInteractions and whyItWorks (arrays of strings). Write the values in Vietnamese. Source video context: ${JSON.stringify(video)}. Channel DNA: ${JSON.stringify(channelDNA)}. The source URL is ${JSON.stringify(video.url || "")}.`;
  {
    const beforeCount = await countGeminiResponseNodes(window);
    const formatPrompt = "Your previous source analysis response was not valid complete JSON. Return exactly one complete JSON object with the required keys, all strings closed, arrays closed, Vietnamese values, no Markdown and no commentary. Do not invent evidence.";
    return redactDesktopRuntime(await runGeminiJsonCommandWithFormatRetry({
      window,
      prompt,
      purpose: "SOURCE_ANALYSIS",
      formatPrompt,
      missingCode: "SOURCE_ANALYSIS_BROWSER_INPUT_MISSING",
      beforeCount,
      timeoutMs: 180_000,
      runId: payload.runId || null,
      stage: "SOURCE_ANALYSIS",
      validate: (result) => result && typeof result.summary === "string" && typeof result.hook === "string" && Array.isArray(result.characterInteractions) && Array.isArray(result.whyItWorks) ? null : "SOURCE_ANALYSIS_SCHEMA_INVALID",
    }));
  }
  let beforeCount = await window.webContents.executeJavaScript("(() => { const roots=[document]; const seen=new Set(roots); for(let i=0;i<roots.length;i+=1) for(const el of roots[i].querySelectorAll('*')) if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);roots.push(el.shadowRoot);} return roots.flatMap(root=>[...root.querySelectorAll('model-response, message-content, [data-message-author-role=\"model\"]')]).length; })()", true);
  const fill = async (text) => window.webContents.executeJavaScript(geminiFillPromptExpression(text, "SOURCE_ANALYSIS_BROWSER_INPUT_MISSING"), true);
  const prepared = await fill(prompt);
  if (!prepared?.textLength) throw new Error("SOURCE_ANALYSIS_BROWSER_INPUT_EMPTY: Gemini không giữ được prompt trong editor.");
  await delay(1_000);
  const delivered = await window.webContents.executeJavaScript(`(() => { const roots=[document]; const seen=new Set(roots); for(let i=0;i<roots.length;i+=1) for(const el of roots[i].querySelectorAll('*')) if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);roots.push(el.shadowRoot);} const input=roots.flatMap(root=>[...root.querySelectorAll('[contenteditable="true"],textarea,[role="textbox"]')]).find(e=>e.getAttribute('aria-label')==='Nhập câu lệnh cho Gemini' || e.getBoundingClientRect().width>100); const text=input?.innerText||input?.value||''; return text.includes(${JSON.stringify(prompt.slice(0, 48))}); })()`, true);
  if (!delivered) throw new Error("SOURCE_ANALYSIS_BROWSER_DELIVERY_FAILED: Gemini chưa nhận prompt trong editor.");
  safeSendInputEvent(window, { type: "keyDown", keyCode: "ENTER" });
  safeSendInputEvent(window, { type: "keyUp", keyCode: "ENTER" });
  await delay(1_200);
  const stillInComposer = await window.webContents.executeJavaScript(`(() => { const roots=[document]; const seen=new Set(roots); for(let i=0;i<roots.length;i+=1) for(const el of roots[i].querySelectorAll('*')) if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);roots.push(el.shadowRoot);} const input=roots.flatMap(root=>[...root.querySelectorAll('[contenteditable="true"],textarea,[role="textbox"]')]).find(e=>e.getAttribute('aria-label')==='Nhập câu lệnh cho Gemini' || e.getBoundingClientRect().width>100); return (input?.innerText||input?.value||'').includes(${JSON.stringify(prompt.slice(0, 48))}); })()`, true);
  if (stillInComposer) {
    safeSendInputEvent(window, { type: "keyDown", keyCode: "ENTER" });
    safeSendInputEvent(window, { type: "keyUp", keyCode: "ENTER" });
    await delay(1_000);
    const failedDelivery = await window.webContents.executeJavaScript(`(() => { const roots=[document]; const seen=new Set(roots); for(let i=0;i<roots.length;i+=1) for(const el of roots[i].querySelectorAll('*')) if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);roots.push(el.shadowRoot);} const input=roots.flatMap(root=>[...root.querySelectorAll('[contenteditable="true"],textarea,[role="textbox"]')]).find(e=>e.getAttribute('aria-label')==='Nhập câu lệnh cho Gemini' || e.getBoundingClientRect().width>100); return (input?.innerText||input?.value||'').includes(${JSON.stringify(prompt.slice(0, 48))}); })()`, true);
    if (failedDelivery) throw new Error("SOURCE_ANALYSIS_BROWSER_DELIVERY_FAILED: App đã thử Enter hai lần nhưng Gemini chưa nhận prompt.");
  }
  let previous = "";
  let stable = 0;
  let formatRetries = 0;
  for (let elapsed = 0; elapsed < 180_000; elapsed += 2_000) {
    const text = await window.webContents.executeJavaScript(`(() => { const roots=[document]; const seen=new Set(roots); for(let i=0;i<roots.length;i+=1) for(const el of roots[i].querySelectorAll('*')) if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);roots.push(el.shadowRoot);} const responses=roots.flatMap(root=>[...root.querySelectorAll('model-response, message-content, [data-message-author-role="model"]')]); return responses.length>${beforeCount}?responses[responses.length-1].innerText:''; })()`, true);
    if (isGeminiThrottleError(text)) throw new Error("GEMINI_TEMPORARY_PROVIDER_THROTTLE_429: Gemini browser trả về dấu hiệu rate limit/quota.");
    stable = text && text === previous ? stable + 1 : 0;
    previous = text;
    if (stable >= 3) {
      const start = text.indexOf('{'); const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          const result = JSON.parse(text.slice(start, end + 1));
          if (result && typeof result === "object" && typeof result.summary === "string" && typeof result.hook === "string" && Array.isArray(result.characterInteractions) && Array.isArray(result.whyItWorks)) return redactDesktopRuntime(result);
        } catch { /* Chờ thêm hoặc gửi một lần yêu cầu format lại. */ }
      }
      if (stable >= 6) {
        const generating = await window.webContents.executeJavaScript(`!!document.querySelector('button[aria-label*="Stop"],button[aria-label*="Dừng"]')`, true);
        if (!generating) {
          if (formatRetries >= 1) throw new Error("SOURCE_ANALYSIS_BROWSER_INVALID_JSON: Gemini browser đã kết thúc nhưng không trả JSON đúng format.");
          formatRetries += 1;
          beforeCount = await window.webContents.executeJavaScript("(() => { const roots=[document]; const seen=new Set(roots); for(let i=0;i<roots.length;i+=1) for(const el of roots[i].querySelectorAll('*')) if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);roots.push(el.shadowRoot);} return roots.flatMap(root=>[...root.querySelectorAll('model-response, message-content, [data-message-author-role=\"model\"]')]).length; })()", true);
          await fill("Your previous source analysis response was not valid complete JSON. Return exactly one complete JSON object with the required keys, all strings closed, arrays closed, Vietnamese values, no Markdown and no commentary. Do not invent evidence.");
          await delay(800);
          await clickFlowControl(window, ["Send message", "Send", "Gửi tin nhắn", "Gửi"], false, 15_000);
          previous = "";
          stable = 0;
        }
      }
    }
    await delay(2_000);
  }
  throw new Error("SOURCE_ANALYSIS_BROWSER_RESPONSE_TIMEOUT: Gemini browser không trả kết quả phân tích.");
}

async function runBrowserModelingIdeaJobUnlocked(payload) {
    const window = await createGeminiWindow();
  await preflightGeminiForRun(window, payload.runId, "MODELING_IDEA");
  await delay(3_000);
  const prompt = `Create exactly ONE faithful modeling idea from the source analysis below using the Gemini browser session. Preserve the source content, progression, mechanism, gag, sequence, character roles, key props, camera intent, timing/rhythm and ending. The only allowed differences are exactly: background/environment appearance, the approved main-character identity reference, and the selected art/rendering style. Do not add, remove, reorder or merge beats; do not add characters, props, actions, camera movement, timing changes, a new gag or a new ending. Return ONE complete JSON object only, no Markdown and no commentary, with schemaVersion "1.0" and modelingDirections containing exactly one object with these fields: title, coreConcept, script, characterDesign, setting, artStyle, sourceMechanism, whatIsPreserved (array), whatIsChanged (array), targetMarketAdaptation, similarityRisk (low|medium|high), whyWorthDeveloping, postText. Write descriptive fields in Vietnamese and postText in the channel language. Do not invent details that are absent from the analysis. Source video: ${JSON.stringify(payload.video)}. Channel DNA: ${JSON.stringify(payload.channelDNA)}. Source analysis: ${JSON.stringify(payload.analysis)}. Requested art style: ${JSON.stringify(payload.artStyle || "Giữ phong cách của kênh")}.`;
  {
    const beforeCount = await countGeminiResponseNodes(window);
    const formatPrompt = "Your previous response was incomplete or invalid JSON. Return one complete JSON object with schemaVersion and exactly one modelingDirections item containing every required field. No Markdown or commentary.";
    return redactDesktopRuntime(await runGeminiJsonCommandWithFormatRetry({
      window,
      prompt,
      purpose: "MODELING_IDEA",
      formatPrompt,
      missingCode: "MODELING_IDEA_BROWSER_INPUT_MISSING",
      beforeCount,
      timeoutMs: 180_000,
      runId: payload.runId || null,
      stage: "MODELING_IDEA",
      validate: (result) => result && Array.isArray(result.modelingDirections) && result.modelingDirections.length === 1 ? null : "MODELING_IDEA_SCHEMA_INVALID",
    }));
  }
  let beforeCount = await window.webContents.executeJavaScript("document.querySelectorAll('model-response').length", true);
  const prepared = await window.webContents.executeJavaScript(geminiFillPromptExpression(prompt, "MODELING_IDEA_BROWSER_INPUT_MISSING"), true);
  if (!prepared?.textLength) throw new Error("MODELING_IDEA_BROWSER_INPUT_EMPTY");
  await delay(1_000);
  safeSendInputEvent(window, { type: "keyDown", keyCode: "ENTER" });
  safeSendInputEvent(window, { type: "keyUp", keyCode: "ENTER" });
  await delay(1_200);
  let previous = "";
  let stable = 0;
  let formatRetries = 0;
  for (let elapsed = 0; elapsed < 180_000; elapsed += 2_000) {
    const text = await window.webContents.executeJavaScript(`(() => { const roots=[document]; const seen=new Set(roots); for(let i=0;i<roots.length;i+=1) for(const el of roots[i].querySelectorAll('*')) if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);roots.push(el.shadowRoot);} const responses=roots.flatMap(root=>[...root.querySelectorAll('model-response, message-content, [data-message-author-role="model"]')]); return responses.length>${beforeCount}?responses[responses.length-1].innerText:''; })()`, true);
    if (isGeminiThrottleError(text)) throw new Error("GEMINI_TEMPORARY_PROVIDER_THROTTLE_429: Gemini browser trả về dấu hiệu rate limit/quota.");
    stable = text && text === previous ? stable + 1 : 0;
    previous = text;
    if (stable >= 3) {
      const start = text.indexOf('{'); const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          const result = JSON.parse(text.slice(start, end + 1));
          if (result && Array.isArray(result.modelingDirections) && result.modelingDirections.length === 1) return redactDesktopRuntime(result);
        } catch { /* Chờ thêm hoặc yêu cầu Gemini đóng JSON đầy đủ một lần. */ }
      }
      if (stable >= 6) {
        const generating = await window.webContents.executeJavaScript(`!!document.querySelector('button[aria-label*="Stop"],button[aria-label*="Dừng"]')`, true);
        if (!generating) {
          if (formatRetries >= 1) throw new Error("MODELING_IDEA_BROWSER_INVALID_JSON: Gemini browser không trả JSON modeling idea hợp lệ.");
          formatRetries += 1;
          beforeCount = await window.webContents.executeJavaScript("document.querySelectorAll('model-response').length", true);
          await window.webContents.executeJavaScript(geminiFillPromptExpression("Your previous response was incomplete or invalid JSON. Return one complete JSON object with schemaVersion and exactly one modelingDirections item containing every required field. No Markdown or commentary.", "MODELING_IDEA_BROWSER_INPUT_MISSING"), true);
          await delay(800);
          safeSendInputEvent(window, { type: "keyDown", keyCode: "ENTER" });
          safeSendInputEvent(window, { type: "keyUp", keyCode: "ENTER" });
          previous = "";
          stable = 0;
        }
      }
    }
    await delay(2_000);
  }
  throw new Error("MODELING_IDEA_BROWSER_RESPONSE_TIMEOUT: Gemini browser không trả modeling idea.");
}

async function runBrowserDevelopedIdeaJobUnlocked(payload) {
  const window = await createGeminiWindow();
  await preflightGeminiForRun(window, payload.runId, "CONTENT_PROJECT");
  const prompt = `Develop the approved modeling idea into a production-ready Content Project and storyboard using the Gemini browser session under STRICT_MODELING. Preserve the source gag, sequence, meaning, character count, camera intent, action order, timing and continuity. Return ONE complete JSON object only, no Markdown or commentary, with schemaVersion "1.0", sourceModelingSpec (object), deconstruction (object), artDirection (object), characterDesign (object), backgroundDesign (object), storyboard (array with at least one item), and safetyReview (object). CANONICAL JSON CONTRACT: sourceModelingSpec MUST contain exactly the array key "scenes". Never use "sourceScenes". sourceModelingSpec.scenes contains one ordered source scene per actual major shot/beat with sourceSceneId, order, sourceStartTime, sourceEndTime, duration, storyBeat, cameraType, shotSize, cameraAngle, cameraMovement, framing, subjectPosition, relativeObjectPositions, characterAction, ordered actionSequence, startState, endState, transitionIn, transitionOut, timingNotes, rhythmNotes, mustPreserve and allowedTransformations. sourceStartTime MUST be a JSON number in seconds (examples 0, 1.5, 4.25); never return a quoted string, clock-formatted text such as 00:03, or a value with a unit suffix. sourceEndTime MUST be a JSON number in seconds (examples 3, 6.5, 13.5); never return a quoted string such as \"3\" or \"00:03\", clock-formatted text, or a value with a unit suffix. sourceEndTime must be greater than sourceStartTime. duration MUST be a JSON number in seconds (examples 3, 3.5, 0.75); never return \"3\", \"00:03\", \"3s\" or any other string/unit-suffixed representation. Keep duration consistent with sourceEndTime - sourceStartTime under the authoritative schema tolerance; do not change start/end times to hide a duration error. relativeObjectPositions MUST be a JSON array of strings; [] is allowed when no relative object evidence exists. Each element must be a non-empty string. Never return one string, a semicolon/comma-delimited string, an object, or null. actionSequence MUST be a JSON array of non-empty strings with at least one item. Each item is one action beat in exact chronological order inside that scene. Never return the whole sequence as one string, numbered prose, an object, null, or an empty array. CAMERA CONTRACT: cameraType, shotSize, cameraAngle and framing MUST each be non-empty JSON strings describing the source camera intent; cameraMovement MUST be a JSON string or null describing source camera motion, and may be omitted only when the schema default null applies. Do not return objects, arrays or numbers for these fields. Do not invent missing evidence. Every storyboard item must contain sceneNumber (positive integer), visualBlock, actionBlock, audioBlock, startFramePrompt and englishPrompt. Write descriptive fields in Vietnamese; write startFramePrompt and englishPrompt in English. Each scene must contain one primary action and connect to the previous scene. Do not add or remove scenes compared with sourceModelingSpec.scenes. Source video: ${JSON.stringify(payload.video)}. Channel DNA: ${JSON.stringify(payload.channelDNA)}. Source analysis: ${JSON.stringify(payload.analysis)}. Approved modeling idea: ${JSON.stringify(payload.idea)}. Aspect ratio: ${JSON.stringify(payload.aspectRatio || "9:16")}.`;
  {
    const beforeCount = await countGeminiResponseNodes(window);
    const formatPrompt = ({ rawResponse, error }) => String(error || "").startsWith("CONTENT_PROJECT_SCHEMA_INVALID")
      ? `Your previous response was valid JSON but failed the authoritative Content Project contract: ${error}. Repair ONLY the JSON structure. The canonical field is sourceModelingSpec.scenes (array); do not use sourceModelingSpec.sourceScenes. sourceStartTime and sourceEndTime must be JSON numbers in seconds, not quoted strings or clock text; duration must also be a JSON number in seconds, not a quoted string or unit-suffixed value; relativeObjectPositions must be an array of non-empty strings, with [] allowed. If relativeObjectPositions was one string, represent the same spatial meaning as a one-element array and do not add/remove objects. actionSequence must be an array of at least one non-empty string per scene; if it was one string or numbered prose, return a new array preserving the exact action content and chronological order. Do not add, remove, or reorder action beats. cameraType, shotSize, cameraAngle and framing must be non-empty JSON strings; cameraMovement must be a JSON string or null. Do not map synonyms in the application. Preserve each timing value exactly, keep sourceEndTime greater than sourceStartTime, and keep duration consistent with sourceEndTime - sourceStartTime under the authoritative schema tolerance. Do not change start/end times to hide a duration error. Preserve exactly the scene count, scene order, scene text, actionSequence content/order, camera constraints/intent, timing, character/source mapping, and all other content. Do not add creative content. Return one complete corrected JSON object only. ORIGINAL PARSED JSON: ${rawResponse}`
      : "Your previous response was incomplete or invalid JSON. Return one complete STRICT_MODELING JSON object with sourceModelingSpec.scenes (array), schemaVersion, deconstruction, artDirection, characterDesign, backgroundDesign, storyboard and safetyReview. No Markdown or commentary.";
    return redactDesktopRuntime(await runGeminiJsonCommandWithFormatRetry({
      window,
      prompt,
      purpose: "CONTENT_PROJECT_DEVELOP",
      formatPrompt,
      missingCode: "CONTENT_PROJECT_BROWSER_INPUT_MISSING",
      beforeCount,
      timeoutMs: 240_000,
      runId: payload.runId || null,
      stage: "CONTENT_PROJECT",
      validate: (result) => !result || !Array.isArray(result.storyboard) || result.storyboard.length === 0
        ? "CONTENT_PROJECT_SCHEMA_INVALID: storyboard must be a non-empty array"
        : !Array.isArray(result.sourceModelingSpec?.scenes)
          ? "CONTENT_PROJECT_SCHEMA_INVALID: sourceModelingSpec.scenes must be an array; sourceScenes is not canonical"
          : (() => {
            const invalidStartIndex = result.sourceModelingSpec.scenes.findIndex((scene) => typeof scene?.sourceStartTime !== "number" || !Number.isFinite(scene.sourceStartTime) || scene.sourceStartTime < 0);
            if (invalidStartIndex >= 0) return `CONTENT_PROJECT_SCHEMA_INVALID: sourceModelingSpec.scenes[${invalidStartIndex}].sourceStartTime must be a finite non-negative JSON number in seconds; received ${JSON.stringify(result.sourceModelingSpec.scenes[invalidStartIndex]?.sourceStartTime)}`;
            const invalidEndIndex = result.sourceModelingSpec.scenes.findIndex((scene) => typeof scene?.sourceEndTime !== "number" || !Number.isFinite(scene.sourceEndTime) || scene.sourceEndTime <= 0);
            if (invalidEndIndex >= 0) return `CONTENT_PROJECT_SCHEMA_INVALID: sourceModelingSpec.scenes[${invalidEndIndex}].sourceEndTime must be a finite positive JSON number in seconds; received ${JSON.stringify(result.sourceModelingSpec.scenes[invalidEndIndex]?.sourceEndTime)}`;
            const invalidDurationIndex = result.sourceModelingSpec.scenes.findIndex((scene) => typeof scene?.duration !== "number" || !Number.isFinite(scene.duration) || scene.duration <= 0);
            if (invalidDurationIndex >= 0) return `CONTENT_PROJECT_SCHEMA_INVALID: sourceModelingSpec.scenes[${invalidDurationIndex}].duration must be a finite positive JSON number in seconds; received ${JSON.stringify(result.sourceModelingSpec.scenes[invalidDurationIndex]?.duration)}`;
            const invalidRelativeIndex = result.sourceModelingSpec.scenes.findIndex((scene) => !Array.isArray(scene?.relativeObjectPositions) || scene.relativeObjectPositions.some((item) => typeof item !== "string" || !item.trim()));
            if (invalidRelativeIndex >= 0) return `CONTENT_PROJECT_SCHEMA_INVALID: sourceModelingSpec.scenes[${invalidRelativeIndex}].relativeObjectPositions must be an array of non-empty strings; received ${JSON.stringify(result.sourceModelingSpec.scenes[invalidRelativeIndex]?.relativeObjectPositions)}`;
            const invalidActionIndex = result.sourceModelingSpec.scenes.findIndex((scene) => !Array.isArray(scene?.actionSequence) || scene.actionSequence.length === 0 || scene.actionSequence.some((item) => typeof item !== "string" || !item.trim()));
            if (invalidActionIndex >= 0) return `CONTENT_PROJECT_SCHEMA_INVALID: sourceModelingSpec.scenes[${invalidActionIndex}].actionSequence must be a non-empty array of non-empty strings; received ${JSON.stringify(result.sourceModelingSpec.scenes[invalidActionIndex]?.actionSequence)}`;
            const invalidCameraIndex = result.sourceModelingSpec.scenes.findIndex((scene) => typeof scene?.cameraType !== "string" || !scene.cameraType.trim() || typeof scene?.shotSize !== "string" || !scene.shotSize.trim() || typeof scene?.cameraAngle !== "string" || !scene.cameraAngle.trim() || (scene?.cameraMovement !== undefined && scene.cameraMovement !== null && typeof scene.cameraMovement !== "string") || typeof scene?.framing !== "string" || !scene.framing.trim());
            return invalidCameraIndex >= 0 ? `CONTENT_PROJECT_SCHEMA_INVALID: sourceModelingSpec.scenes[${invalidCameraIndex}].cameraType/shotSize/cameraAngle/cameraMovement/framing have invalid camera contract types; received ${JSON.stringify({ cameraType: result.sourceModelingSpec.scenes[invalidCameraIndex]?.cameraType, shotSize: result.sourceModelingSpec.scenes[invalidCameraIndex]?.shotSize, cameraAngle: result.sourceModelingSpec.scenes[invalidCameraIndex]?.cameraAngle, cameraMovement: result.sourceModelingSpec.scenes[invalidCameraIndex]?.cameraMovement, framing: result.sourceModelingSpec.scenes[invalidCameraIndex]?.framing })}` : null;
          })(),
    }));
  }
  let beforeCount = await window.webContents.executeJavaScript("document.querySelectorAll('model-response').length", true);
  const prepared = await window.webContents.executeJavaScript(geminiFillPromptExpression(prompt, "CONTENT_PROJECT_BROWSER_INPUT_MISSING"), true);
  if (!prepared?.textLength) throw new Error("CONTENT_PROJECT_BROWSER_INPUT_EMPTY");
  await delay(1_000);
  safeSendInputEvent(window, { type: "keyDown", keyCode: "ENTER" });
  safeSendInputEvent(window, { type: "keyUp", keyCode: "ENTER" });
  await delay(1_200);
  let previous = "";
  let stable = 0;
  let formatRetries = 0;
  for (let elapsed = 0; elapsed < 240_000; elapsed += 2_000) {
    const text = await window.webContents.executeJavaScript(`(() => { const roots=[document]; const seen=new Set(roots); for(let i=0;i<roots.length;i+=1) for(const el of roots[i].querySelectorAll('*')) if(el.shadowRoot&&!seen.has(el.shadowRoot)){seen.add(el.shadowRoot);roots.push(el.shadowRoot);} const responses=roots.flatMap(root=>[...root.querySelectorAll('model-response, message-content, [data-message-author-role="model"]')]); return responses.length>${beforeCount}?responses[responses.length-1].innerText:''; })()`, true);
    if (isGeminiThrottleError(text)) throw new Error("GEMINI_TEMPORARY_PROVIDER_THROTTLE_429: Gemini browser trả về dấu hiệu rate limit/quota.");
    stable = text && text === previous ? stable + 1 : 0;
    previous = text;
    if (stable >= 3) {
      const start = text.indexOf('{'); const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          const result = JSON.parse(text.slice(start, end + 1));
          if (result && Array.isArray(result.storyboard) && result.storyboard.length > 0) return redactDesktopRuntime(result);
        } catch { /* Chờ thêm hoặc yêu cầu JSON đầy đủ một lần. */ }
      }
      if (stable >= 6) {
        const generating = await window.webContents.executeJavaScript(`!!document.querySelector('button[aria-label*="Stop"],button[aria-label*="Dừng"]')`, true);
        if (!generating) {
          if (formatRetries >= 1) throw new Error("CONTENT_PROJECT_BROWSER_INVALID_JSON: Gemini browser không trả Content Project hợp lệ.");
          formatRetries += 1;
          beforeCount = await window.webContents.executeJavaScript("document.querySelectorAll('model-response').length", true);
          await window.webContents.executeJavaScript(geminiFillPromptExpression("Your previous response was incomplete or invalid JSON. Return one complete STRICT_MODELING JSON object with sourceModelingSpec, schemaVersion, deconstruction, artDirection, characterDesign, backgroundDesign, storyboard and safetyReview. sourceModelingSpec must contain only observable source evidence, ordered source scenes, timestamps, camera, framing, actionSequence, mustPreserve and allowedTransformations. Each storyboard item must contain all six required fields. No Markdown or commentary.", "CONTENT_PROJECT_BROWSER_INPUT_MISSING"), true);
          await delay(800);
          safeSendInputEvent(window, { type: "keyDown", keyCode: "ENTER" });
          safeSendInputEvent(window, { type: "keyUp", keyCode: "ENTER" });
          previous = "";
          stable = 0;
        }
      }
    }
    await delay(2_000);
  }
  throw new Error("CONTENT_PROJECT_BROWSER_RESPONSE_TIMEOUT: Gemini browser không trả Content Project.");
}

function geminiFillPromptExpression(text, missingCode) {
  const encoded = JSON.stringify(text);
  return `(() => {
    const roots = [document]; const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
    const input = roots.flatMap((root) => [...root.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]')]).find((element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 100 && bounds.height >= 20 && style.visibility !== 'hidden' && style.display !== 'none'; });
    if (!input) throw new Error(${JSON.stringify(missingCode)});
    input.focus();
    if (input.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(input, ${encoded});
    } else {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, ${encoded});
    }
    input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: ${encoded} }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${encoded} }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { textLength: (${encoded}).length, preview: (${encoded}).slice(0, 80) };
  })()`;
}

async function runBrowserQualityJobUnlocked(payload) {
  if (payload.stage === "STAGE2") {
    if (!payload.video || !payload.analysis) throw new Error("STAGE2_BROWSER_INVALID_REQUEST");
    if (payload.purpose === "MODELING_IDEA") return runBrowserModelingIdeaJobUnlocked(payload);
    if (payload.purpose === "CONTENT_PROJECT_DEVELOP" && payload.idea) return runBrowserDevelopedIdeaJobUnlocked(payload);
    throw new Error("STAGE2_BROWSER_INVALID_PURPOSE");
  }
  if (payload.stage === "ANALYSIS" && payload.purpose === "SOURCE_ANALYSIS") return runBrowserSourceAnalysisJobUnlocked(payload);
  const { projectId, channelId, stage, expectedState } = payload;
  if (!/^[A-Za-z0-9_-]+$/.test(projectId || "") || !/^[A-Za-z0-9_-]+$/.test(channelId || "") || !["ASSETS", "SCENES", "FINAL_AUDIT"].includes(stage)) {
    throw new Error("QUALITY_BROWSER_INVALID_REQUEST");
  }
  const geminiRunId = payload.automationRunId || payload.runId || null;
  const qualityCommandId = crypto.randomUUID();
  const window = await createGeminiWindow();
  try {
    await preflightGeminiForRun(window, geminiRunId, `QUALITY_${stage}`);
  const files = [];
  if (stage === "ASSETS") {
    const character = findChannelMainCharacterImagePath(channelId);
    if (character) files.push(character);
    files.push(findGeneratedImagePath(projectId, "background", 0));
    for (const scene of expectedState.scenes || []) {
      let selected = findSceneImagePath(projectId, scene.sceneNumber);
      if (expectedState.candidateId) {
        try { selected = findGeneratedImagePath(projectId, "scene", scene.sceneNumber, expectedState.candidateId); }
        catch { /* Cảnh không sửa: đối chiếu bản đã duyệt. */ }
      }
      files.push(selected);
    }
  } else {
    const root = path.join(app.getPath("userData"), "generated-videos", projectId);
    if (stage === "FINAL_AUDIT") files.push(path.join(root, "final.mp4"));
    else for (const scene of expectedState.scenes || []) files.push(path.join(root, `scene-${scene.sceneNumber}.mp4`));
  }
  if (!files.length || files.length > 10 || files.some((file) => !fs.existsSync(file) || fs.statSync(file).size < 1024)) throw new Error("QUALITY_BROWSER_REQUIRED_MEDIA_MISSING_OR_LIMIT");
  await uploadEdgeGeminiFiles(window, files);
  let prompt = payload.purpose === "REPAIR_PROMPT"
    ? "Repair ONLY the start-frame prompts for the specified failed scenes, using the attached incorrect images, approved character/background references, neighboring scene images, original prompts and precise validation issues. Expected State is the source of truth. Preserve only elements explicitly required there. If an issue says a prop or visible text is unexpected, REMOVE it at its source scene and do not carry it forward merely for continuity. Never introduce readable words, letters, captions, logos, slogans, pets, laptops, packages, food, controllers, bags, clothing or other props unless Expected State explicitly requires them. Preserve the original scene intent, camera, action initial state, correct character costume, friend identities/count and valid continuity. Do not rewrite the story. Do not call technical/provider outages semantic mistakes. REQUESTED_SCENE_IDS: " + JSON.stringify(payload.repairContext?.targetSceneIds) + ". REQUESTED_SCENE_NUMBERS: " + JSON.stringify(payload.repairContext?.targets) + ". Return ONLY JSON {\"repairs\":[{\"sceneId\":\"scene-id\",\"repairedPrompt\":\"...\",\"fixedIssues\":[\"...\"]}]}. Return exactly one item for each requested scene ID, no extras. Failure context: " + JSON.stringify(payload.repairContext) + ". Expected State: " + JSON.stringify(expectedState)
    : "Audit the attached actual media against Expected State and the embedded SourceVideoModelingSpec, not filenames or claimed API success. Separate CHARACTER IDENTITY from SCENE APPEARANCE and SOURCE FIDELITY from TECHNICAL QUALITY. Identity means face, facial structure, base hairstyle, skin tone, body proportions, height/build, age appearance, distinctive physical traits, and core design language. Scene Appearance means wardrobe, accessories, temporary condition, and props required by that scene; do not treat the canonical character reference outfit as globally immutable. For start frames, validate identity and source shot intent separately. For videos, also check motion, ordered action sequence, source camera grammar, timing, continuity, action, duration, audio and ending. Compare each candidate with both neighboring scenes: positions, props, identities and state must transition coherently. Report sceneNumber for each concrete failed scene or affected neighbor. Use CHARACTER_IDENTITY_MISMATCH only when identity is wrong; use SCENE_APPEARANCE_MISMATCH when identity is right but wardrobe/accessories/props are wrong. For ASSETS and SCENES return sourceObservations as one structured observation per scene; for FINAL_AUDIT return sourceObservation. Use null when evidence is insufficient and never fabricate PASS. Return ONLY JSON {\"verdict\":\"PASS|FAIL|UNCERTAIN\",\"issues\":[{\"code\":\"...\",\"message\":\"...\",\"sceneNumber\":1}],\"sourceObservation\":{},\"sourceObservations\":[],\"summary\":\"...\"}. Expected State: " + JSON.stringify(expectedState);
  if (payload.stage === "ASSETS" && payload.purpose !== "REPAIR_PROMPT") prompt += "\nSTRICT OUTPUT CONTRACT: sourceObservations MUST be an array with exactly one OBJECT for each scene, in scene order. Every object MUST contain sceneNumber (number), characterIdentityMatch (PASS|FAIL|UNCERTAIN), cameraType (string or null), shotSize (string or null), cameraAngle (string or null), cameraMovement (string or null), subjectPosition (string or null), relativeObjectPositions (array of strings or null), startStateMatch (PASS|FAIL|UNCERTAIN), keyPropPresenceMatch (PASS|FAIL|UNCERTAIN), framingIntentMatch (PASS|FAIL|UNCERTAIN), technicalStatus (PASS|FAIL|UNCERTAIN), and evidence (array of strings). Do not replace an object with an observation string. Use UNCERTAIN when the image does not provide evidence; never omit required keys.";
  if (payload.stage === "SCENES" && payload.purpose !== "REPAIR_PROMPT") prompt += "\nSTRICT VIDEO OUTPUT CONTRACT: sourceObservations MUST be an array with exactly one OBJECT for each requested scene, in scene order, and MUST NOT be replaced by sourceObservation. Every object MUST contain sceneNumber (number), characterIdentityMatch (PASS|FAIL|UNCERTAIN), actionMatch (PASS|FAIL|UNCERTAIN), actionSequence (array of strings matching the observed ordered beats or null), actionOrderMatch (PASS|FAIL|UNCERTAIN), cameraMatch (PASS|FAIL|UNCERTAIN), cameraType (string or null), shotSize (string or null), cameraAngle (string or null), cameraMovement (string or null), propInteractionMatch (PASS|FAIL|UNCERTAIN), spatialMatch (PASS|FAIL|UNCERTAIN), timingMatch (PASS|FAIL|UNCERTAIN), generatedDuration (number or null), startStateMatch (PASS|FAIL|UNCERTAIN), endStateMatch (PASS|FAIL|UNCERTAIN), beatMatch (PASS|FAIL|UNCERTAIN), temporalContinuity (PASS|FAIL|UNCERTAIN), technicalStatus (PASS|FAIL|UNCERTAIN), and evidence (array of strings). Use UNCERTAIN when evidence is insufficient; never omit required keys and never fabricate PASS.";
  if (payload.purpose === "REPAIR_PROMPT") prompt += " Every repairedPrompt must be self-contained: explicitly describe the character, costume, background, required props and frozen initial action state from Expected State. Do NOT use image filenames/indexes or preserve wrong action/friend count from a failed image. Return ONE complete JSON object with all targets in ONE repairs array, closing every string/object/array. Keep each repairedPrompt concise.";
  let beforeCount = await window.webContents.executeJavaScript("document.querySelectorAll('model-response').length", true);
  await window.webContents.executeJavaScript(`(() => { const input = [...document.querySelectorAll('[contenteditable="true"],textarea')].find(e => e.getBoundingClientRect().width > 100); if (!input) throw new Error('QUALITY_BROWSER_INPUT_MISSING'); input.focus(); if (input.tagName === 'TEXTAREA') { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input, ${JSON.stringify(prompt)}); } else { document.execCommand('selectAll',false); document.execCommand('insertText',false,${JSON.stringify(prompt)}); } input.dispatchEvent(new InputEvent('input',{bubbles:true})); })()`, true);
  await delay(1_500);
  await clickFlowControl(window, ["Send message", "Send", "Gửi tin nhắn", "Gửi"], false, 15_000);
  let previous = "";
  let stable = 0;
  let formatRetries = 0;
  for (let elapsed = 0; elapsed < 300_000; elapsed += 2_000) {
    const text = await window.webContents.executeJavaScript(`(() => { const responses = [...document.querySelectorAll('model-response')]; return responses.length > ${beforeCount} ? responses[responses.length-1].innerText : ''; })()`, true);
    if (isGeminiThrottleError(text)) throw new Error("GEMINI_TEMPORARY_PROVIDER_THROTTLE_429: Gemini browser trả về dấu hiệu rate limit/quota.");
    stable = text && text === previous ? stable + 1 : 0;
    previous = text;
    if (stable >= 3) {
      const start = text.indexOf('{'); const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          const result = JSON.parse(text.slice(start, end + 1));
          if (payload.purpose === "REPAIR_PROMPT" && Array.isArray(result.repairs)) return redactDesktopRuntime(result);
          if (["PASS", "FAIL", "UNCERTAIN"].includes(result.verdict) && Array.isArray(result.issues)) return redactDesktopRuntime(result);
        } catch { /* Không biến JSON hỏng thành kết quả thành công. */ }
      }
      if (stable >= 6) {
        const generating = await window.webContents.executeJavaScript(`!!document.querySelector('button[aria-label*="Stop"],button[aria-label*="Dừng"]')`, true);
        if (!generating) {
          if (formatRetries >= 1) throw new Error("QUALITY_BROWSER_INVALID_JSON: Gemini đã kết thúc nhưng không trả JSON đúng định dạng sau lần yêu cầu sửa.");
          formatRetries += 1;
          beforeCount = await window.webContents.executeJavaScript("document.querySelectorAll('model-response').length", true);
          const correction = payload.purpose === "REPAIR_PROMPT"
            ? "Your previous response is invalid/truncated JSON. Return ONE complete JSON object, with a single repairs array, exactly one entry per requested scene ID " + JSON.stringify(payload.repairContext?.targetSceneIds) + ". Each entry requires sceneId (string), repairedPrompt (complete string), fixedIssues (array of strings). Close ALL strings, objects and arrays. Make each prompt self-contained, explicitly describe the character, costume, background, initial action state and props from Expected State; DO NOT refer to image_1.png or any image filenames/indexes. Do not preserve an incorrect friend count or incorrect action from a failed image. Keep prompts concise. No commentary."
            : 'Your previous response is invalid/truncated JSON. Return ONE complete JSON object with verdict (PASS, FAIL or UNCERTAIN), issues (array with code, message, sceneNumber where applicable), sourceObservation (structured source checks; use null when not evaluated) and summary (string). Close all strings, objects and arrays. No commentary. Do not invent a successful verdict.';
          await window.webContents.executeJavaScript(`(() => { const input = document.querySelector('rich-textarea [role="textbox"]'); if (!input) throw new Error('QUALITY_BROWSER_INPUT_MISSING'); input.focus(); document.execCommand('selectAll',false); document.execCommand('insertText',false,${JSON.stringify(correction)}); input.dispatchEvent(new InputEvent('input',{bubbles:true})); })()`, true);
          await delay(1_500);
          await clickFlowControl(window, ["Send message", "Send", "Gửi tin nhắn", "Gửi"], false, 15_000);
          previous = "";
          stable = 0;
        }
      }
    }
    await delay(2_000);
  }
  throw new Error("QUALITY_BROWSER_RESPONSE_TIMEOUT");
  } finally {
    try {
      if (geminiRunId) await persistGeminiConversationAfterStep(window, { snapshot: () => ({ commandId: qualityCommandId }) }, geminiRunId, `QUALITY_${stage}`);
    } finally {
      if (geminiRunId) await closeGeminiAfterStep(window);
    }
  }
}

async function preflightGeminiBrowser(window, targetUrl = "https://gemini.google.com/app") {
  if (!window || window.isDestroyed()) throw new Error("BROWSER_ENVIRONMENT_NOT_READY: Cửa sổ Gemini không tồn tại.");
  if (conversationIdFromUrl(targetUrl)) await navigateToGeminiConversation(window, targetUrl);
  else if (window.webContents.getURL() !== targetUrl) await window.webContents.loadURL(targetUrl);
  for (let elapsed = 0; elapsed < 90_000; elapsed += 500) {
    if (window.isDestroyed()) throw new Error("BROWSER_ENVIRONMENT_NOT_READY: Cửa sổ Gemini đã bị đóng.");
    const state = await window.webContents.executeJavaScript(`(() => {
      const roots = [document]; const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 100 && bounds.height >= 20 && style.visibility !== 'hidden' && style.display !== 'none'; };
      const input = roots.flatMap((root) => [...root.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]')]).find(visible);
      const composer = roots.flatMap((root) => [...root.querySelectorAll('rich-textarea, input-container, [data-placeholder="Hỏi Gemini"]')]).find(visible);
      const text = document.body?.innerText || '';
      const signInControl = roots.flatMap((root) => [...root.querySelectorAll('button, a, [role="button"]')]).some((element) => visible(element) && /^(sign in|đăng nhập|log in)$/i.test(String(element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '').replace(/\\s+/g, ' ').trim()));
      const authFailureText = /choose an account|chọn tài khoản|captcha|verify you are human|xác minh bạn là người/i.test(text);
      return { url: location.href, inputReady: Boolean(input), composerReady: Boolean(composer) || /tôi có thể giúp gì cho bạn|hỏi gemini/i.test(text), authenticated: !signInControl && !authFailureText, loginRequired: /accounts\\.google\\.com/i.test(location.href) || signInControl || authFailureText || (!input && !composer && /sign in|đăng nhập|log in/i.test(text)) };
    })()`, true).catch(() => null);
    if (state?.loginRequired) throw new Error("BROWSER_ENVIRONMENT_NOT_READY: Gemini yêu cầu đăng nhập.");
    if (state?.inputReady || state?.composerReady) return state;
    await delay(500);
  }
  throw new Error("BROWSER_ENVIRONMENT_NOT_READY: Gemini chưa sẵn sàng, chưa có composer để nhập prompt.");
}

async function verifyDevRendererIdentity() {
  if (app.isPackaged) return null;
  const port = (() => {
    try { return new URL(APP_URL).port || "80"; } catch { return "unknown"; }
  })();
  let response;
  try {
    response = await fetch(`${APP_URL}/api/runtime-identity`, { cache: "no-store" });
  } catch (error) {
    const failure = new Error(`DEV_RENDERER_PORT_OCCUPIED_BY_UNEXPECTED_RUNTIME: ${JSON.stringify({ port, expectedIdentity: DEV_RUNTIME_IDENTITY })}`);
    failure.code = "DEV_RENDERER_PORT_OCCUPIED_BY_UNEXPECTED_RUNTIME";
    failure.cause = error;
    throw failure;
  }
  let actual = null;
  try { actual = await response.json(); } catch { /* An unrelated server may return non-JSON content. */ }
  const comparison = compareDevRuntimeIdentity(DEV_RUNTIME_IDENTITY, actual);
  if (!response.ok || !comparison.match) {
    const code = response.ok && actual ? "RENDERER_SOURCE_MISMATCH" : "DEV_RENDERER_PORT_OCCUPIED_BY_UNEXPECTED_RUNTIME";
    const failure = new Error(`${code}: ${JSON.stringify({ port, expectedIdentity: DEV_RUNTIME_IDENTITY, actualIdentity: actual, status: response.status })}`);
    failure.code = code;
    failure.context = { port, expectedIdentity: DEV_RUNTIME_IDENTITY, actualIdentity: actual, mismatchedFields: comparison.mismatchedFields, status: response.status };
    throw failure;
  }
  return actual;
}

async function navigateToGeminiConversation(window, targetUrl) {
  let observedUrl = window.webContents.getURL();
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    const before = conversationNavigationDisposition(targetUrl, observedUrl);
    if (before === "MATCH") return observedUrl;
    if (before === "AUTH_REQUIRED") throw new Error("BROWSER_ENVIRONMENT_NOT_READY: Gemini yêu cầu đăng nhập.");
    const loadedUrl = await window.webContents.loadURL(targetUrl);
    observedUrl = typeof loadedUrl === "string" && loadedUrl ? loadedUrl : window.webContents.getURL();
    const after = conversationNavigationDisposition(targetUrl, observedUrl);
    recordBrowserAction({ action: "gemini-conversation-navigation", requestedReopenUrl: targetUrl, attempt: attempt + 1, finalObservedUrl: observedUrl, disposition: after, result: after === "MATCH" ? "PASS" : "RETRY_REQUIRED" });
    if (after === "MATCH") return observedUrl;
    if (after === "AUTH_REQUIRED") throw new Error("BROWSER_ENVIRONMENT_NOT_READY: Gemini yêu cầu đăng nhập.");
    if (after === "RETRY" && isBareGeminiAppUrl(observedUrl)) {
      const error = new Error("GEMINI_CONVERSATION_STALE");
      error.code = "GEMINI_CONVERSATION_STALE";
      error.firstDivergence = "GEMINI_CONVERSATION_STALE";
      error.details = { requestedUrl: targetUrl, actualUrl: observedUrl, reason: "SAVED_CONVERSATION_REDIRECTED_TO_BARE_APP" };
      throw error;
    }
    if (attempt === 0 && typeof window.edgeRuntime?.reacquireManagedPage === "function") {
      await window.edgeRuntime.reacquireManagedPage(window);
      observedUrl = window.webContents.getURL();
    }
  }
  return observedUrl;
}

async function runBrowserQualityJob(payload) {
  return withGeminiBrowserOperation(() => runBrowserQualityJobUnlocked(payload));
}

async function createGeminiWindow() {
  if (geminiWindow && !geminiWindow.isDestroyed()) {
    geminiWindow.show();
    geminiWindow.focus();
    return geminiWindow;
  }
  geminiSessionId = crypto.randomUUID();
  const runtime = new EdgeGeminiRuntime();
  geminiLoadPromise = runtime.connect();
  geminiWindow = await geminiLoadPromise;
  geminiWindow.edgeRuntime = runtime;
  geminiLoadPromise = Promise.resolve(geminiWindow);
  recordBrowserAction({ action: "gemini-edge-runtime-attached", provider: "EDGE_CDP", ...runtime.status(), sessionId: geminiSessionId });
  return geminiWindow;
}

async function preflightGeminiForRun(window, runId, stage) {
  if (!runId) return preflightGeminiBrowser(window);
  const binding = await getGeminiConversationForRun(runId);
  if (binding.geminiConversationState === "DELETED") {
    await openNewGeminiConversation(window, runId, stage);
    return preflightGeminiBrowser(window, "https://gemini.google.com/app");
  }
  if (!binding.geminiConversationId) return preflightGeminiBrowser(window, "https://gemini.google.com/app");
  const requestedUrl = binding.geminiConversationUrl;
  try {
    const preflight = await preflightGeminiBrowser(window, requestedUrl);
    await waitForGeminiConversationIdentity(window, binding, runId, requestedUrl);
    return preflight;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "GEMINI_CONVERSATION_STALE") throw error;
    await persistGeminiConversationCheckpoint(runId, markConversationStale(binding, runId, stage));
    await openNewGeminiConversation(window, runId, stage);
    return preflightGeminiBrowser(window, "https://gemini.google.com/app");
  }
}

async function openNewGeminiConversation(window, runId, stage) {
  if (!window || window.isDestroyed()) throw new Error("BROWSER_ENVIRONMENT_NOT_READY: Cửa sổ Gemini không tồn tại.");
  const existingNewChat = await window.webContents.executeJavaScript(`(() => {
    const roots = [document]; const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
    const visible = (element) => { const rect = element?.getBoundingClientRect?.(); const style = element ? getComputedStyle(element) : null; return Boolean(element && element.isConnected && rect && rect.width > 100 && rect.height >= 20 && style?.display !== 'none' && style?.visibility !== 'hidden'); };
    const input = roots.flatMap((root) => [...root.querySelectorAll('[contenteditable="true"],textarea,[role="textbox"]')]).find(visible);
    const url = location.href;
    const auth = /accounts\\.google\\.com|signin|challenge|captcha/i.test(url) || /sign in|đăng nhập|choose an account|chọn tài khoản|captcha|verify you are human/i.test(String(document.body?.innerText || '').slice(0, 4000));
    return { url, bare: /^https:\/\/gemini\.google\.com\/app\/?(?:[?#].*)?$/i.test(url), inputReady: Boolean(input), auth };
  })()`, true).catch(() => null);
  if (existingNewChat?.auth) throw new Error("GEMINI_AUTH_REQUIRED");
  if (existingNewChat?.bare && existingNewChat?.inputReady) {
    recordBrowserAction({ action: "gemini-new-chat-open", runId, stage, result: "PASS", source: "BARE_APP_ALREADY_READY", url: existingNewChat.url, conversationId: null });
    return { url: existingNewChat.url, conversationId: null, state: "UNBOUND" };
  }
  try {
    await window.webContents.loadURL("https://gemini.google.com/app");
    const ready = await waitForGeminiNewChatReady(window);
    recordBrowserAction({ action: "gemini-new-chat-open", runId, stage, result: "PASS", source: "DIRECT_BARE_APP_NAVIGATION", url: ready.url, conversationId: null });
    return ready;
  } catch (error) {
    if (error instanceof Error && error.message === "GEMINI_AUTH_REQUIRED") throw error;
  }
  const clicked = await window.webContents.executeJavaScript(`(() => {
    const roots = [document]; const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
    const visible = (element) => { const rect = element?.getBoundingClientRect?.(); const style = element ? getComputedStyle(element) : null; return Boolean(element && element.isConnected && rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden'); };
    const label = (element) => String(element?.getAttribute?.('aria-label') || element?.getAttribute?.('title') || element?.textContent || '').replace(/\\s+/g, ' ').trim();
    const isNewChat = (element) => /^(?:new chat|cuộc trò chuyện mới|cuộc trò chuyện mới trên gemini)$/i.test(label(element)) || /^(?:new chat|cuộc trò chuyện mới)$/i.test(label(element).toLowerCase());
    const candidates = roots.flatMap((root) => [...root.querySelectorAll('a[href],button,[role="button"]')]).filter(visible).filter((element) => {
      if (isNewChat(element) && !element.href) return true;
      try {
        const url = new URL(element.href || '', location.href);
        return url.origin === 'https://gemini.google.com' && /^\\/app\\/?$/i.test(url.pathname);
      } catch { return false; }
    });
    const candidate = candidates.find(isNewChat);
    if (!candidate) return false;
    candidate.click();
    return true;
  })()`, true).catch(() => false);
  if (!clicked) throw new Error("GEMINI_NEW_CHAT_CONTROL_NOT_FOUND");
  const ready = await waitForGeminiNewChatReady(window);
  recordBrowserAction({ action: "gemini-new-chat-open", runId, stage, result: "PASS", url: window.webContents.getURL(), conversationId: conversationIdFromUrl(window.webContents.getURL()) });
  return ready;
}

async function waitForGeminiNewChatReady(window) {
  for (let elapsed = 0; elapsed <= 30_000; elapsed += 250) {
    if (window.isDestroyed()) throw new Error("BROWSER_ENVIRONMENT_NOT_READY: Cửa sổ Gemini đã bị đóng.");
    const state = await window.webContents.executeJavaScript(`(() => {
      const roots = [document]; const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      const visible = (element) => { const rect = element?.getBoundingClientRect?.(); const style = element ? getComputedStyle(element) : null; return Boolean(element && element.isConnected && rect && rect.width > 100 && rect.height >= 20 && style?.display !== 'none' && style?.visibility !== 'hidden'); };
      const input = roots.flatMap((root) => [...root.querySelectorAll('[contenteditable="true"],textarea,[role="textbox"]')]).find(visible);
      const url = location.href;
      const auth = /accounts\\.google\\.com|signin|challenge|captcha/i.test(url) || /sign in|đăng nhập|choose an account|chọn tài khoản|captcha|verify you are human/i.test(String(document.body?.innerText || '').slice(0, 4000));
      return { url, bare: /^https:\\/\\/gemini\\.google\\.com\\/app\\/?(?:[?#].*)?$/i.test(url), inputReady: Boolean(input), auth };
    })()`, true).catch(() => null);
    if (state?.auth) throw new Error("GEMINI_AUTH_REQUIRED");
    if (state?.bare && state.inputReady) return { url: state.url, conversationId: null, state: "UNBOUND" };
    await delay(250);
  }
  throw new Error("GEMINI_NEW_CHAT_NOT_READY");
}

async function createFlowWindow() {
  if (flowWindow && !flowWindow.isDestroyed()) {
    flowWindow.show();
    flowWindow.focus();
    return flowWindow;
  }
  const runtime = new EdgeGeminiRuntime();
  flowLoadPromise = runtime.connect({ initialUrl: FLOW_HOME_URL, targetMatcher: isFlowUrl, targetError: "FLOW_TARGET_NOT_FOUND_IN_EDGE" });
  try {
    const window = await flowLoadPromise;
    window.edgeRuntime = runtime;
    flowWindow = window;
    recordBrowserAction({ action: "flow-edge-runtime-attached", provider: "EDGE_CDP", ...runtime.status(), targetId: window.webContents.id, targetUrl: window.webContents.getURL() });
    return window;
  } catch (error) {
    flowLoadPromise = undefined;
    await runtime.closeManagedProcess().catch(() => {});
    throw error;
  }
}

async function closeFlowWindow(focusMain = true) {
  flowRemoteClient?.close();
  flowRemoteClient = undefined;
  const window = flowWindow;
  const runtime = window?.edgeRuntime;
  flowWindow = undefined;
  flowLoadPromise = undefined;
  if (window && !window.isDestroyed()) window.close();
  if (runtime) await runtime.closeManagedProcess().catch(() => {});
  if (focusMain && mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
  }
}

function waitForGeminiLoad(window) {
  if (geminiLoadPromise) return geminiLoadPromise;
  return Promise.resolve();
}

async function waitForFlowLoad(window) {
  for (let elapsed = 0; elapsed < 60_000; elapsed += 500) {
    if (window.isDestroyed()) throw new Error("Cửa sổ Google Flow đã bị đóng.");
    try {
      const state = await executeFlowJavaScript(window, `(() => ({ readyState: document.readyState, url: window.location.href }))()`);
      if (state?.url?.includes("accounts.google.com")) {
        throw new Error("Google Flow yêu cầu đăng nhập. Hãy đăng nhập trong cửa sổ Flow rồi chạy lại.");
      }
      if (state?.url?.includes("flow.google.com") && state.readyState !== "loading") return;
    } catch (error) {
      if (error instanceof Error && error.message.includes("Google Flow yêu cầu đăng nhập")) throw error;
    }
    await delay(500);
  }
  throw new Error("Google Flow mở quá lâu hoặc chưa tải xong. Hãy kiểm tra kết nối và trạng thái đăng nhập rồi thử lại.");
}

async function reloadGeminiBeforeNextPrompt(window) {
  if (window.isDestroyed()) throw new Error("Cửa sổ Gemini đã bị đóng trước khi gửi prompt tiếp theo.");
  const conversationUrl = window.webContents.getURL();
  geminiLoadPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Gemini tải lại quá lâu trước khi gửi prompt tiếp theo.")), 45_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timeout); resolve(); });
  });
  window.webContents.reload();
  await geminiLoadPromise;
  if (conversationUrl.includes("gemini.google.com/app/") && !window.webContents.getURL().includes("gemini.google.com/app/")) {
    geminiLoadPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Không thể quay lại cuộc trò chuyện Gemini hiện tại sau khi tải lại.")), 45_000);
      window.webContents.once("did-finish-load", () => { clearTimeout(timeout); resolve(); });
    });
    await window.webContents.loadURL(conversationUrl);
    await geminiLoadPromise;
  }
  await delay(1_500);
  for (let elapsed = 0; elapsed < 20_000; elapsed += 500) {
    const ready = await executeFlowJavaScript(window, `(() => {
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll("*")) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"]')]).find((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 100 && bounds.height > 20;
      });
      if (!input || window.location.href.includes('accounts.google.com')) return false;
      return true;
    })()`, true);
    if (!ready) {
      await delay(500);
      continue;
    }
    await delay(800);
    return;
  }
  throw new Error("Gemini đã tải lại nhưng chưa sẵn sàng nhận prompt tiếp theo.");
}

function saveGeminiImage(projectId, slot, dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw new Error("Gemini không trả về dữ liệu ảnh hợp lệ.");
  const mimeToExtension = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/bmp": ".bmp", "image/avif": ".avif" };
  const extension = mimeToExtension[match[1].toLowerCase()];
  if (!extension) throw new Error(`Định dạng ảnh Gemini chưa được hỗ trợ: ${match[1]}`);
  const imageRoot = path.join(app.getPath("userData"), "generated-images", projectId);
  fs.mkdirSync(imageRoot, { recursive: true });
  const sceneNumber = Number.isInteger(slot.sceneNumber) ? slot.sceneNumber : 0;
  const allowedExtensions = Object.values(mimeToExtension);
  for (const oldExtension of allowedExtensions) {
    const oldTarget = path.join(imageRoot, `${slot.kind}-${sceneNumber}${oldExtension}`);
    if (fs.existsSync(oldTarget)) fs.rmSync(oldTarget);
  }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 20 * 1024 * 1024) throw new Error("Ảnh Gemini vượt quá giới hạn 20 MB.");
  fs.writeFileSync(path.join(imageRoot, `${slot.kind}-${sceneNumber}${extension}`), buffer);
  return `/api/v1/projects/${projectId}/images?kind=${slot.kind}&sceneNumber=${sceneNumber}`;
}

function saveFlowImage(projectId, slot, buffer, mimeType = "image/png") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1024) throw new Error("Google Flow không trả về ảnh hợp lệ.");
  if (buffer.length > 20 * 1024 * 1024) throw new Error("Ảnh Google Flow vượt quá giới hạn 20 MB.");
  const mimeToExtension = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/bmp": ".bmp", "image/avif": ".avif" };
  const extension = mimeToExtension[mimeType.toLowerCase()] || ".png";
  if (slot.candidateId && !/^[a-f0-9-]{36}$/.test(slot.candidateId)) throw new Error("IMAGE_CANDIDATE_ID_INVALID");
  const imageRoot = slot.candidateId
    ? path.join(app.getPath("userData"), "generated-images", projectId, "candidates", slot.candidateId)
    : path.join(app.getPath("userData"), "generated-images", projectId);
  fs.mkdirSync(imageRoot, { recursive: true });
  const sceneNumber = Number.isInteger(slot.sceneNumber) ? slot.sceneNumber : 0;
  for (const oldExtension of slot.candidateId ? [] : Object.values(mimeToExtension)) {
    const oldTarget = path.join(imageRoot, `${slot.kind}-${sceneNumber}${oldExtension}`);
    if (fs.existsSync(oldTarget)) fs.rmSync(oldTarget);
  }
  fs.writeFileSync(path.join(imageRoot, `${slot.kind}-${sceneNumber}${extension}`), buffer);
  return `/api/v1/projects/${projectId}/images?kind=${slot.kind}&sceneNumber=${sceneNumber}`;
}

function findGeneratedImagePath(projectId, kind, sceneNumber = 0, candidateId) {
  const projectRoot = path.join(app.getPath("userData"), "generated-images", projectId);
  if (candidateId && !/^[a-f0-9-]{36}$/.test(candidateId)) throw new Error("IMAGE_CANDIDATE_ID_INVALID");
  const imageRoot = candidateId ? path.join(projectRoot, "candidates", candidateId) : projectRoot;
  const manifest = path.join(projectRoot, "approved-images.json");
  if (!candidateId && fs.existsSync(manifest)) {
    const selected = JSON.parse(fs.readFileSync(manifest, "utf8"))[`${kind}-${sceneNumber}`];
    if (selected) {
      if (!/^candidates\/[a-f0-9-]{36}\/(?:scene|background)-\d+\.(?:png|jpg|jpeg|webp|gif|bmp|avif)$/.test(selected)) throw new Error("IMAGE_APPROVED_VERSION_INVALID");
      const target = path.join(projectRoot, selected);
      if (!fs.existsSync(target)) throw new Error("IMAGE_APPROVED_VERSION_MISSING");
      return target;
    }
  }
  for (const extension of [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]) {
    const target = path.join(imageRoot, `${kind}-${sceneNumber}${extension}`);
    if (fs.existsSync(target)) return target;
  }
  throw new Error(`Chưa có ảnh ${kind === "character" ? "nhân vật" : `cảnh ${sceneNumber}`}.`);
}

function findSceneImagePath(projectId, sceneNumber) {
  return findGeneratedImagePath(projectId, "scene", sceneNumber);
}

function findChannelMainCharacterImagePath(channelId) {
  const characterRoot = path.join(app.getPath("userData"), "channel-characters");
  for (const extension of [".png", ".jpg", ".webp", ".gif", ".bmp", ".avif"]) {
    const target = path.join(characterRoot, `${channelId}${extension}`);
    if (fs.existsSync(target)) return target;
  }
  return null;
}

function normalizeGeminiImageSource(value) {
  const source = String(value || "");
  const origin = "https://gemini.google.com";
  return source.toLowerCase().startsWith(`${origin}https://`) ? source.slice(origin.length) : source;
}

async function findProjectChannelId(projectId) {
  const databasePath = path.join(app.getPath("userData"), "modeling-ai.db");
  const prismaClientPath = app.isPackaged
    ? path.join(runtimeRoot(), "app", "node_modules", "@prisma", "client")
    : "@prisma/client";
  const { PrismaClient } = require(prismaClientPath);
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${databasePath.replace(/\\/g, "/")}` } } });
  try {
    const project = await prisma.contentProject.findUnique({ where: { id: projectId }, select: { channelId: true } });
    return typeof project?.channelId === "string" && project.channelId ? project.channelId : null;
  } finally {
    await prisma.$disconnect();
  }
}

async function readGeminiConversationRun(runId) {
  if (typeof runId !== "string" || !runId.trim()) throw new Error("GEMINI_CONVERSATION_RUN_ID_REQUIRED");
  const session = await ensureDesktopSession();
  if (!session) throw new Error("GEMINI_CONVERSATION_RUN_SESSION_UNAVAILABLE");
  const response = await fetch(`${APP_URL}/api/v1/automations?runId=${encodeURIComponent(runId)}`, { headers: { Cookie: `ai_content_modeling_session=${session.token}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(body?.data)) throw new Error(`GEMINI_CONVERSATION_RUN_READ_FAILED:${response.status}`);
  const run = body.data.find((item) => item?.id === runId);
  if (!run) throw new Error("GEMINI_CONVERSATION_RUN_NOT_FOUND");
  return run;
}

async function persistGeminiConversationCheckpoint(runId, binding) {
  const run = await readGeminiConversationRun(runId);
  const checkpoint = { ...(run.checkpoint && typeof run.checkpoint === "object" && !Array.isArray(run.checkpoint) ? run.checkpoint : {}), ...binding, version: 1, runId };
  const session = await ensureDesktopSession();
  if (!session) throw new Error("GEMINI_CONVERSATION_RUN_SESSION_UNAVAILABLE");
  const response = await fetch(`${APP_URL}/api/v1/automations`, { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: `ai_content_modeling_session=${session.token}` }, body: JSON.stringify({ id: runId, checkpoint }) });
  if (!response.ok) throw new Error(`GEMINI_CONVERSATION_CHECKPOINT_PERSIST_FAILED:${response.status}`);
  return checkpoint;
}

async function getGeminiConversationForRun(runId) {
  const run = await readGeminiConversationRun(runId);
  return normalizeConversationBinding(run.checkpoint, runId);
}

async function getGeminiRuntimeConversationForRun(runId) {
  const binding = await getGeminiConversationForRun(runId);
  if (binding.geminiConversationState !== "DELETED") return binding;
  return { ...binding, geminiConversationId: null, geminiConversationUrl: null, geminiConversationState: "UNBOUND" };
}

async function prepareGeminiConversationForCommand(window, runId, stage) {
  if (!runId) return null;
  // Always validate the persisted binding before composing a prompt. This is
  // the real send path, so bypassing preflight here would reuse a deleted
  // conversation and misclassify it as a send-time cookie reset.
  await preflightGeminiForRun(window, runId, stage);
  const binding = await getGeminiRuntimeConversationForRun(runId);
  if (!binding.geminiConversationId || !binding.geminiConversationUrl) return null;
  // preflightGeminiForRun already performed the bounded ownership and
  // stabilization check. Do not start a second full stabilization window
  // immediately before send; that can expire at the boundary and report a
  // false URL mismatch even though the validated URL is still current.
  return binding;
}

async function waitForGeminiConversationIdentity(window, binding, runId, requestedUrl) {
  const startedAt = Date.now();
  let firstObservedUrl = null;
  let lastObservedUrl = null;
  let attempts = 0;
  let verifiedBinding = null;
  while (Date.now() - startedAt <= GEMINI_CONVERSATION_REOPEN_STABILIZATION_MS) {
    attempts += 1;
    const observedUrl = await window.webContents.executeJavaScript("location.href", true).catch(() => window.webContents.getURL());
    if (!firstObservedUrl) firstObservedUrl = observedUrl;
    lastObservedUrl = observedUrl;
    if (isBareGeminiAppUrl(observedUrl)) {
      const error = new Error("GEMINI_CONVERSATION_STALE");
      error.code = "GEMINI_CONVERSATION_STALE";
      error.firstDivergence = "GEMINI_CONVERSATION_STALE";
      error.details = { requestedUrl, actualUrl: observedUrl, reason: "SAVED_CONVERSATION_REDIRECTED_TO_BARE_APP" };
      throw error;
    }
    try {
      const ready = assertConversationReady(binding, runId, observedUrl);
      verifiedBinding = ready;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "GEMINI_CONVERSATION_URL_MISMATCH") throw error;
    }
    if (verifiedBinding && Date.now() - startedAt >= GEMINI_CONVERSATION_REOPEN_STABILIZATION_MS) {
      recordBrowserAction({
        action: "gemini-conversation-reopen-identity",
        persistedConversationUrl: binding.geminiConversationUrl,
        requestedReopenUrl: requestedUrl,
        urlImmediatelyAfterNavigation: firstObservedUrl,
        finalObservedUrl: observedUrl,
        persistedConversationId: binding.geminiConversationId,
        observedConversationId: conversationIdFromUrl(observedUrl),
        navigationRedirectOccurred: firstObservedUrl !== observedUrl,
        urlStabilizationDurationMs: Date.now() - startedAt,
        attempts,
        result: "PASS",
      });
      return verifiedBinding;
    }
    await delay(GEMINI_CONVERSATION_REOPEN_POLL_MS);
  }
  // The final polling delay can carry the elapsed time just past the
  // stabilization boundary. If the last observed URL was still the exact
  // owned conversation and it was verified successfully, preserve that
  // successful observation instead of manufacturing a URL mismatch.
  if (verifiedBinding && conversationIdFromUrl(lastObservedUrl) === binding.geminiConversationId) {
    recordBrowserAction({
      action: "gemini-conversation-reopen-identity",
      persistedConversationUrl: binding.geminiConversationUrl,
      requestedReopenUrl: requestedUrl,
      urlImmediatelyAfterNavigation: firstObservedUrl,
      finalObservedUrl: lastObservedUrl,
      persistedConversationId: binding.geminiConversationId,
      observedConversationId: conversationIdFromUrl(lastObservedUrl),
      navigationRedirectOccurred: firstObservedUrl !== lastObservedUrl,
      urlStabilizationDurationMs: Date.now() - startedAt,
      attempts,
      result: "PASS",
      stabilizationBoundary: "FINAL_VERIFIED_OBSERVATION",
    });
    return verifiedBinding;
  }
  recordBrowserAction({
    action: "gemini-conversation-reopen-identity",
    persistedConversationUrl: binding.geminiConversationUrl,
    requestedReopenUrl: requestedUrl,
    urlImmediatelyAfterNavigation: firstObservedUrl,
    finalObservedUrl: lastObservedUrl,
    persistedConversationId: binding.geminiConversationId,
    observedConversationId: conversationIdFromUrl(lastObservedUrl),
    navigationRedirectOccurred: firstObservedUrl !== lastObservedUrl,
    urlStabilizationDurationMs: Date.now() - startedAt,
    attempts,
    result: "FAIL",
    failureReason: "GEMINI_CONVERSATION_URL_MISMATCH",
  });
  throw new Error("GEMINI_CONVERSATION_URL_MISMATCH");
}

async function persistGeminiConversationAfterStep(window, command, runId, stage) {
  if (!runId) return null;
  let observedUrlReadError = null;
  const actualUrl = await window.webContents.executeJavaScript("location.href", true).catch((error) => {
    observedUrlReadError = error instanceof Error ? error.message : String(error);
    return window.webContents.getURL();
  });
  let current;
  try {
    current = await getGeminiRuntimeConversationForRun(runId);
    const next = current.geminiConversationId
      ? assertConversationReady(current, runId, actualUrl)
      : conversationIdFromUrl(actualUrl)
        ? bindConversationFromUrl(current, runId, actualUrl, stage, command.snapshot().commandId)
        : (() => { throw new Error("GEMINI_CONVERSATION_BINDING_NOT_ESTABLISHED"); })();
    const persisted = await persistGeminiConversationCheckpoint(runId, next);
    recordBrowserAction({
      action: "gemini-conversation-step-identity",
      phase: "AFTER_STEP_FINALIZER",
      persistedConversationUrl: current.geminiConversationUrl,
      requestedReopenUrl: current.geminiConversationUrl,
      urlImmediatelyAfterNavigation: null,
      finalObservedUrl: actualUrl,
      persistedConversationId: current.geminiConversationId,
      observedConversationId: conversationIdFromUrl(actualUrl),
      navigationRedirectOccurred: null,
      urlStabilizationDurationMs: null,
      observedUrlReadError,
      result: "PASS",
    });
    return persisted;
  } catch (error) {
    recordBrowserAction({
      action: "gemini-conversation-step-identity",
      phase: "AFTER_STEP_FINALIZER",
      persistedConversationUrl: current?.geminiConversationUrl ?? null,
      requestedReopenUrl: current?.geminiConversationUrl ?? null,
      urlImmediatelyAfterNavigation: null,
      finalObservedUrl: actualUrl,
      persistedConversationId: current?.geminiConversationId ?? null,
      observedConversationId: conversationIdFromUrl(actualUrl),
      navigationRedirectOccurred: null,
      urlStabilizationDurationMs: null,
      observedUrlReadError,
      result: "FAIL",
      failureReason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function closeGeminiAfterStep(window) {
  if (!window?.edgeRuntime) return false;
  const runtime = window.edgeRuntime;
  window.close();
  return runtime.closeManagedProcess();
}

async function createGeminiIdentityReferenceCrop(referencePath, channelId) {
  if (!referencePath || !fs.existsSync(referencePath) || fs.statSync(referencePath).size < 1024) throw new Error("MAIN_CHARACTER_IDENTITY_MISSING: Không tìm thấy ảnh reference Character Identity Pack.");
  const cropRoot = path.join(app.getPath("userData"), "gemini-reference-crops");
  const target = path.join(cropRoot, `${channelId}-identity-face-v5.png`);
  if (fs.existsSync(target) && fs.statSync(target).size >= 1024) return target;
  fs.mkdirSync(cropRoot, { recursive: true });
  // The canonical sheet remains untouched. Gemini receives only the neutral
  // face/identity region, not its labels, logos, wardrobe chart or text.
  await runFfmpeg(["-y", "-i", referencePath, "-vf", "crop=180:180:280:130,scale=512:512:flags=lanczos", "-frames:v", "1", target]);
  if (!fs.existsSync(target) || fs.statSync(target).size < 1024) throw new Error("GEMINI_CHARACTER_REFERENCE_CROP_FAILED");
  return target;
}

async function attachGeminiCharacterReference(window, filePath) {
  if (window?.edgeRuntime) return attachEdgeGeminiReference(window, filePath);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).size < 1024) throw new Error("MAIN_CHARACTER_IDENTITY_MISSING: Không tìm thấy ảnh reference Character Identity Pack.");
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Page.enable");
  await window.webContents.debugger.sendCommand("DOM.enable");
  await window.webContents.debugger.sendCommand("Page.setInterceptFileChooserDialog", { enabled: true });
  let chooserBackendNodeId = null;
  const onChooser = (_event, method, params) => {
    if (method === "Page.fileChooserOpened" && params?.backendNodeId) chooserBackendNodeId = params.backendNodeId;
  };
  window.webContents.debugger.on("message", onChooser);
  const findImageInputBackendNodeId = async () => {
    const documentResult = await window.webContents.debugger.sendCommand("DOM.getDocument", { depth: -1, pierce: true }).catch(() => null);
    const rootNodeId = documentResult?.root?.nodeId;
    if (!rootNodeId) return null;
    const query = await window.webContents.debugger.sendCommand("DOM.querySelectorAll", { nodeId: rootNodeId, selector: 'input[type="file"]' }).catch(() => null);
    for (const nodeId of query?.nodeIds || []) {
      const described = await window.webContents.debugger.sendCommand("DOM.describeNode", { nodeId, depth: 0, pierce: true }).catch(() => null);
      const attributes = described?.node?.attributes || [];
      const acceptIndex = attributes.findIndex((value) => value === "accept");
      const accept = acceptIndex >= 0 ? String(attributes[acceptIndex + 1] || "").toLowerCase() : "";
      if (!accept || accept.includes("image")) return described?.node?.backendNodeId || null;
    }
    return null;
  };
  let backendNodeId = null;
  for (let openAttempt = 0; openAttempt < 3 && !backendNodeId; openAttempt += 1) {
    if (openAttempt === 0) await clickFlowControl(window, ["Nội dung tải lên và công cụ", "Uploads and tools", "Add files", "Add files and tools"], false, 30_000);
    else {
      const menuPoint = await waitForFlowControlPoint(window, ["Nội dung tải lên và công cụ", "Uploads and tools", "Add files", "Add files and tools"], false, 5_000).catch(() => null);
      if (menuPoint) { await dispatchBrowserClick(window, menuPoint); await delay(350); }
    }
    for (let elapsed = 0; elapsed < 5_000 && !backendNodeId; elapsed += 250) {
      backendNodeId = chooserBackendNodeId || await findImageInputBackendNodeId();
      if (!backendNodeId) await delay(250);
    }
    if (!backendNodeId) {
      const uploadPoint = await waitForFlowControlPoint(window, ["Tải tệp lên. Tài liệu, dữ liệu, tệp mã nguồn", "Upload files", "Tải tệp lên", "Upload from computer", "Tệp từ máy tính", "From this computer", "Tệp"], false, 5_000).catch(() => null);
      if (uploadPoint) { await dispatchBrowserClick(window, uploadPoint); await delay(350); }
      for (let elapsed = 0; elapsed < 5_000 && !backendNodeId; elapsed += 250) {
        backendNodeId = chooserBackendNodeId || await findImageInputBackendNodeId();
        if (!backendNodeId) await delay(250);
      }
    }
  }
  if (backendNodeId) {
    await window.webContents.debugger.sendCommand("DOM.setFileInputFiles", { files: [filePath], backendNodeId });
  } else {
    throw new Error("GEMINI_CHARACTER_REFERENCE_UPLOAD_CONTROL_NOT_FOUND");
  }
  window.webContents.debugger.removeListener("message", onChooser);
  await window.webContents.debugger.sendCommand("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {});
  const filename = path.basename(filePath);
  for (let elapsed = 0; elapsed < 120_000; elapsed += 1_000) {
    const attached = await window.webContents.executeJavaScript(`(() => {
      const composer = document.querySelector('input-container');
      if (!composer || composer.querySelector('[role="progressbar"],mat-progress-spinner,[aria-busy="true"]')) return false;
      const previews = [...composer.querySelectorAll('uploader-file-preview')];
      return previews.some((preview) => {
        const image = preview.querySelector('img');
        return image ? image.complete && image.naturalWidth > 0 : preview.innerText.includes(${JSON.stringify(filename)});
      });
    })()`, true);
    if (attached) return;
    await delay(1_000);
  }
  throw new Error("GEMINI_CHARACTER_REFERENCE_NOT_ATTACHED");
}

async function getEdgeGeminiMainFrameId(window) {
  const tree = await window.webContents.debugger.sendCommand("Page.getFrameTree");
  return tree?.frameTree?.frame?.id || null;
}

async function findEdgeGeminiAttachmentToolbar(window) {
  for (let elapsed = 0; elapsed < 10_000; elapsed += 250) {
    const point = await window.webContents.executeJavaScript(`(() => {
      const roots = [document]; const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      const button = roots.flatMap((root) => [...root.querySelectorAll('button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]')]).find((candidate) => /nội dung tải lên và công cụ|uploads? and tools|add files|attachment|tải lên/i.test(String(candidate.getAttribute('aria-label') || candidate.getAttribute('title') || candidate.textContent || '')));
      if (!button) return null;
      const bounds = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      if (button.disabled || !button.isConnected || bounds.width <= 0 || bounds.height <= 0 || style.display === "none" || style.visibility === "hidden") return null;
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`, true).catch(() => null);
    if (point) return point;
    await delay(250);
  }
  throw new Error("EDGE_ATTACHMENT_TOOLBAR_NOT_FOUND");
}

async function findEdgeGeminiUploadAction(window) {
  for (let elapsed = 0; elapsed < 10_000; elapsed += 250) {
    const action = await window.webContents.executeJavaScript(`(() => {
      const roots = [document]; const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return Boolean(element.isConnected && bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden"); };
      const menus = roots.flatMap((root) => [...root.querySelectorAll('[role="menu"], mat-action-list')]).filter(visible);
      const menu = menus.find((candidate) => [...candidate.querySelectorAll('button, [role="button"], mat-list-item, gem-list-item')].some((element) => /^Tệp$/i.test(String(element.textContent || element.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim())));
      if (!menu) return null;
      const candidates = [...menu.querySelectorAll('button, [role="button"], mat-list-item, gem-list-item')].filter(visible);
      const upload = candidates.find((element) => element.getAttribute("data-test-id") === "uploader-images-files-button-advanced")
        || candidates.find((element) => /^Tệp$/i.test(String(element.textContent || element.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim()));
      if (!upload) return null;
      const bounds = upload.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, tag: upload.tagName.toLowerCase(), role: upload.getAttribute("role"), name: String(upload.textContent || upload.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim() };
    })()`, true).catch(() => null);
    if (action) return action;
    await delay(250);
  }
  throw new Error("EDGE_UPLOAD_ACTION_NOT_FOUND");
}

async function readEdgeGeminiAttachmentEvidence(window, filePaths) {
  const filenames = (Array.isArray(filePaths) ? filePaths : [filePaths]).map((filePath) => path.basename(filePath).toLowerCase());
  return window.webContents.executeJavaScript(`(() => {
    const roots = [document]; const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll("*")) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
    const visible = (element) => { const bounds = element?.getBoundingClientRect?.(); const style = element ? getComputedStyle(element) : null; return Boolean(element && element.isConnected && bounds && bounds.width > 0 && bounds.height > 0 && style?.display !== "none" && style?.visibility !== "hidden"); };
    const text = (element) => String(element?.innerText || element?.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const previews = roots.flatMap((root) => [...root.querySelectorAll("uploader-file-preview, [data-test-id*=attachment], [data-testid*=attachment]")]).filter(visible);
    const previewImages = roots.flatMap((root) => [...root.querySelectorAll("uploader-file-preview img, input-container img")]).filter((image) => visible(image) && image.complete && (image.naturalWidth || image.width) > 0);
    const filenamePresent = ${JSON.stringify(filenames)}.every((filename) => roots.flatMap((root) => [...root.querySelectorAll("*")]).some((element) => visible(element) && text(element).includes(filename)));
    const selectedInputs = roots.flatMap((root) => [...root.querySelectorAll('input[type="file"]')]).filter((input) => (input.files?.length || 0) > 0);
    return { previewCount: previews.length, previewImageCount: previewImages.length, filenamePresent, selectedInputCount: selectedInputs.length, confirmed: previews.length > 0 || previewImages.length > 0 || filenamePresent };
  })()`, true).catch(() => null);
}

async function uploadEdgeGeminiFiles(window, filePaths) {
  const cdp = window.webContents.debugger;
  const selectedFiles = filePaths.map(assertReadableAbsoluteFile);
  const baselinePreview = await readEdgeGeminiAttachmentEvidence(window, selectedFiles);
  const result = await uploadWithEdgeFileChooser({
    window,
    cdp,
    filePaths: selectedFiles,
    getMainFrameId: () => getEdgeGeminiMainFrameId(window),
    targetIsCurrent: () => !window.isDestroyed() && /^https:\/\/gemini\.google\.com\//i.test(window.webContents.getURL()),
    openToolbar: async () => {
      await findEdgeGeminiAttachmentToolbar(window);
      await cdp.sendCommand("Page.bringToFront").catch(() => {});
      const toolbarState = await window.webContents.executeJavaScript(`(() => {
        const roots = [document]; const seen = new Set(roots);
        for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        const button = roots.flatMap((root) => [...root.querySelectorAll('button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]')]).find((candidate) => /nội dung tải lên và công cụ|uploads? and tools|add files|attachment|tải lên/i.test(String(candidate.getAttribute('aria-label') || candidate.getAttribute('title') || candidate.textContent || '')));
        return button ? { expanded: button.getAttribute("aria-expanded"), disabled: button.disabled, connected: button.isConnected } : null;
      })()`, true).catch(() => false);
      if (!toolbarState?.connected || toolbarState.disabled) throw new Error("EDGE_ATTACHMENT_TOOLBAR_CLICK_FAILED");
      if (toolbarState.expanded !== "true") {
        const clicked = await window.webContents.executeJavaScript(`(() => {
          const roots = [document]; const seen = new Set(roots);
          for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
          const button = roots.flatMap((root) => [...root.querySelectorAll('button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]')]).find((candidate) => /nội dung tải lên và công cụ|uploads? and tools|add files|attachment|tải lên/i.test(String(candidate.getAttribute('aria-label') || candidate.getAttribute('title') || candidate.textContent || '')));
          if (!button || button.disabled || !button.isConnected || button.getAttribute("aria-expanded") === "true") return false;
          button.click();
          return true;
        })()`, true).catch(() => false);
        if (!clicked) throw new Error("EDGE_ATTACHMENT_TOOLBAR_CLICK_FAILED");
      }
      for (let elapsed = 0; elapsed < 10_000; elapsed += 250) {
        const menuReady = await window.webContents.executeJavaScript(`(() => { const roots = [document]; const seen = new Set(roots); for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); } return roots.flatMap((root) => [...root.querySelectorAll('[role="menu"], mat-action-list')]).some((menu) => { const bounds = menu.getBoundingClientRect(); const style = getComputedStyle(menu); return bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden"; }); })()`, true).catch(() => false);
        if (menuReady) return;
        await delay(250);
      }
      throw new Error("EDGE_ATTACHMENT_MENU_NOT_READY");
    },
    findUploadAction: () => findEdgeGeminiUploadAction(window),
    clickUploadAction: async () => {
      await cdp.sendCommand("Page.bringToFront").catch(() => {});
      const clicked = await window.webContents.executeJavaScript(`(() => {
        const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return Boolean(element.isConnected && bounds.width > 0 && bounds.height > 0 && style.display !== "none" && style.visibility !== "hidden"); };
        const roots = [document]; const seen = new Set(roots);
        for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        const menu = roots.flatMap((root) => [...root.querySelectorAll('[role="menu"], mat-action-list')]).find((candidate) => visible(candidate));
        const button = [...(menu?.querySelectorAll('button, [role="button"], mat-list-item, gem-list-item') || [])].find((element) => visible(element) && /^Tệp$/i.test(String(element.textContent || element.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim()));
        if (!button || button.matches?.(":disabled")) return false;
        button.click();
        return true;
      })()`, true).catch(() => false);
      if (!clicked) throw new Error("EDGE_UPLOAD_ACTION_CLICK_FAILED");
    },
    confirmPreview: async (targetPaths, timeoutMs) => {
      for (let elapsed = 0; elapsed <= timeoutMs; elapsed += 250) {
        const evidence = await readEdgeGeminiAttachmentEvidence(window, targetPaths);
        if (evidence?.confirmed && (evidence.previewCount >= (baselinePreview?.previewCount || 0) + selectedFiles.length || evidence.previewImageCount >= (baselinePreview?.previewImageCount || 0) + selectedFiles.length || evidence.filenamePresent)) return evidence;
        await delay(250);
      }
      return { confirmed: false, baselinePreview, lastEvidence: await readEdgeGeminiAttachmentEvidence(window, targetPaths) };
    },
  });
  recordBrowserAction({ action: "gemini-edge-reference-upload", provider: "EDGE_CDP", frameId: result.frameId, backendNodeId: result.backendNodeId, mode: result.mode, preview: result.preview, filenames: selectedFiles.map((filePath) => path.basename(filePath)) });
  return result;
}

async function attachEdgeGeminiReference(window, filePath) {
  return uploadEdgeGeminiFiles(window, [filePath]);
}

async function selectGeminiImageGenerationTool(window) {
  await clickFlowControl(window, ["Nội dung tải lên và công cụ", "Uploads and tools", "Add files", "Add files and tools"], false, 30_000);
  const imageTool = await waitForFlowControlPoint(window, ["Tạo hình ảnh", "Create image", "Create images"], false, 15_000).catch(() => null);
  if (!imageTool) throw new Error("GEMINI_IMAGE_TOOL_NOT_FOUND");
  await dispatchBrowserClick(window, imageTool);
  await delay(500);
}

function saveGeminiVideo(projectId, sceneNumber, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1024) throw new Error("Google Flow không trả về video hợp lệ.");
  if (buffer.length > 200 * 1024 * 1024) throw new Error("Video Google Flow vượt quá giới hạn 200 MB.");
  const videoRoot = path.join(app.getPath("userData"), "generated-videos", projectId);
  fs.mkdirSync(videoRoot, { recursive: true });
  fs.writeFileSync(path.join(videoRoot, `scene-${sceneNumber}.mp4`), buffer);
  return `/api/v1/projects/${projectId}/videos?sceneNumber=${sceneNumber}`;
}

function findFfmpegPath() {
  const configured = process.env.MODELING_AI_FFMPEG_PATH;
  if (configured && fs.existsSync(configured)) return configured;

  const bundled = path.join(process.resourcesPath || "", "ffmpeg", "ffmpeg.exe");
  if (fs.existsSync(bundled)) return bundled;

  // electron-builder places files matched by asarUnpack under the sibling
  // app.asar.unpacked directory in an installed package. Keep this explicit
  // candidate before development and machine-wide fallbacks so the packaged
  // app uses the FFmpeg shipped with the same release.
  const packagedUnpacked = path.join(process.resourcesPath || "", "app.asar.unpacked", "electron", "dist", "ffmpeg", "ffmpeg.exe");
  if (fs.existsSync(packagedUnpacked)) return packagedUnpacked;

  // In development Electron does not set process.resourcesPath to the
  // packaged application root. Reuse the repository's shipped binary so
  // Gemini Stage 3 can create the identity reference crop without requiring
  // a machine-wide CapCut installation or an environment override.
  const developmentBundled = path.join(__dirname, "dist", "ffmpeg", "ffmpeg.exe");
  if (fs.existsSync(developmentBundled)) return developmentBundled;

  const capCutApps = path.join(process.env.LOCALAPPDATA || "", "CapCut", "Apps");
  if (fs.existsSync(capCutApps)) {
    const candidates = fs.readdirSync(capCutApps, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(capCutApps, entry.name, "ffmpeg.exe"))
      .filter((candidate) => fs.existsSync(candidate))
      .sort()
      .reverse();
    if (candidates[0]) return candidates[0];
  }
  throw new Error("Chưa tìm thấy bộ xử lý video. Hãy cài CapCut hoặc liên hệ hỗ trợ để cài runtime video.");
}

function runFfmpeg(args, allowFailure = false) {
  const executable = findFfmpegPath();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFailure) return resolve(output);
      const detail = output.trim().slice(-1200);
      reject(new Error(`Không thể xuất video. ${detail || `FFmpeg dừng với mã ${code}.`}`));
    });
  });
}

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function readMediaDuration(filePath) {
  return runFfmpeg(["-hide_banner", "-i", filePath, "-f", "null", "-"], true).then((output) => {
    const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (!match) throw new Error(`Không đọc được thời lượng video: ${path.basename(filePath)}.`);
    const duration = (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Video không có thời lượng hợp lệ: ${path.basename(filePath)}.`);
    return duration;
  });
}

function normalizeVideoEditOptions(value, sceneNumbers) {
  const requestedScenes = Array.isArray(value?.scenes) && value.scenes.length > 0
    ? value.scenes
    : sceneNumbers.map((sceneNumber) => ({ sceneNumber, trimStart: 0, trimEnd: 0 }));
  const requestedNumbers = requestedScenes.map((scene) => scene?.sceneNumber);
  if (requestedScenes.length !== sceneNumbers.length
    || requestedNumbers.some((sceneNumber) => !Number.isInteger(sceneNumber) || !sceneNumbers.includes(sceneNumber))
    || new Set(requestedNumbers).size !== requestedNumbers.length) {
    throw new Error("Danh sách phân cảnh chỉnh sửa không hợp lệ.");
  }
  const transition = value?.transition === "fade" ? "fade" : "none";
  return {
    scenes: requestedScenes.map((scene) => ({
      sceneNumber: scene.sceneNumber,
      trimStart: clampNumber(scene.trimStart, 0, 3600, 0),
      trimEnd: clampNumber(scene.trimEnd, 0, 3600, 0),
    })),
    transition,
    transitionDuration: clampNumber(value?.transitionDuration, 0.2, 0.4, 0.3),
    originalVolume: clampNumber(value?.originalVolume, 0, 2, 1),
    musicVolume: clampNumber(value?.musicVolume, 0, 2, 0.2),
    musicPath: typeof value?.musicPath === "string" && value.musicPath.trim() ? value.musicPath : "",
  };
}

function validateAudioFile(filePath) {
  if (!filePath) return;
  const allowedExtensions = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
  if (!allowedExtensions.has(path.extname(filePath).toLowerCase())) throw new Error("Định dạng nhạc hoặc hiệu ứng âm thanh chưa được hỗ trợ.");
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error("Không tìm thấy tệp nhạc hoặc hiệu ứng âm thanh đã chọn.");
  if (fs.statSync(filePath).size > 200 * 1024 * 1024) throw new Error("Tệp nhạc hoặc hiệu ứng âm thanh phải nhỏ hơn 200 MB.");
}

async function renderFinalVideo(event, projectId, sceneNumbers, rawOptions = {}) {
  const options = normalizeVideoEditOptions(rawOptions, sceneNumbers);
  validateAudioFile(options.musicPath);
  const orderedScenes = options.scenes;
  const videoRoot = path.join(app.getPath("userData"), "generated-videos", projectId);
  const sourceFiles = orderedScenes.map((scene) => path.join(videoRoot, `scene-${scene.sceneNumber}.mp4`));
  for (const source of sourceFiles) {
    if (!fs.existsSync(source) || fs.statSync(source).size < 1024) throw new Error("Thiếu video của một hoặc nhiều phân cảnh. Hãy tạo lại cảnh bị thiếu trước khi ghép.");
  }

  const finalPath = path.join(videoRoot, "final.mp4");
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "modeling-ai-edit-"));
  try {
    sendProgress(event, "video-editor:progress", { stage: "normalize", processed: 0, total: sourceFiles.length, label: "Đang chuẩn hóa video..." });
    const normalized = [];
    const durations = [];
    for (let index = 0; index < sourceFiles.length; index += 1) {
      const sceneOptions = orderedScenes[index];
      const sourceDuration = await readMediaDuration(sourceFiles[index]);
      const targetDuration = sourceDuration - sceneOptions.trimStart - sceneOptions.trimEnd;
      if (targetDuration < 0.2) throw new Error(`Cảnh ${sceneOptions.sceneNumber} còn quá ngắn sau khi cắt đầu/cuối.`);
      const target = path.join(temporaryRoot, `scene-${index + 1}.mp4`);
      await runFfmpeg(["-y", "-hide_banner", "-ss", sceneOptions.trimStart.toFixed(3), "-i", sourceFiles[index], "-t", targetDuration.toFixed(3), "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30", "-c:v", "h264_mf", "-b:v", "4500k", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", target]);
      normalized.push(target);
      durations.push(targetDuration);
      sendProgress(event, "video-editor:progress", { stage: "normalize", processed: index + 1, total: sourceFiles.length, label: `Đã chuẩn hóa cảnh ${sceneOptions.sceneNumber}.` });
    }

    sendProgress(event, "video-editor:progress", { stage: "render", processed: 0, total: 1, label: "Đang ghép các phân cảnh..." });
    const assembledPath = path.join(temporaryRoot, "assembled.mp4");
    if (normalized.length === 1) {
      fs.copyFileSync(normalized[0], assembledPath);
    } else if (options.transition === "fade") {
      const transitionDuration = options.transitionDuration;
      const filters = [];
      let videoLabel = "0:v";
      let audioLabel = "0:a";
      let accumulatedDuration = durations[0];
      for (let index = 1; index < normalized.length; index += 1) {
        const offset = Math.max(0.01, accumulatedDuration - transitionDuration);
        const nextVideoLabel = `video${index}`;
        const nextAudioLabel = `audio${index}`;
        filters.push(`[${videoLabel}][${index}:v]xfade=transition=fade:duration=${transitionDuration.toFixed(3)}:offset=${offset.toFixed(3)}[${nextVideoLabel}]`);
        filters.push(`[${audioLabel}][${index}:a]acrossfade=d=${transitionDuration.toFixed(3)}:c1=tri:c2=tri[${nextAudioLabel}]`);
        videoLabel = nextVideoLabel;
        audioLabel = nextAudioLabel;
        accumulatedDuration += durations[index] - transitionDuration;
      }
      await runFfmpeg(["-y", "-hide_banner", ...normalized.flatMap((file) => ["-i", file]), "-filter_complex", filters.join(";"), "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`, "-c:v", "h264_mf", "-b:v", "4500k", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", assembledPath]);
    } else {
      const playlistPath = path.join(temporaryRoot, "playlist.txt");
      fs.writeFileSync(playlistPath, normalized.map((file) => `file '${file.replace(/'/g, "'\\\\''")}'`).join("\n"), "utf8");
      await runFfmpeg(["-y", "-hide_banner", "-f", "concat", "-safe", "0", "-i", playlistPath, "-c", "copy", "-movflags", "+faststart", assembledPath]);
    }

    if (options.musicPath || options.originalVolume !== 1) {
      sendProgress(event, "video-editor:progress", { stage: "audio", processed: 0, total: 1, label: options.musicPath ? "Đang trộn âm thanh Flow với nhạc/hiệu ứng..." : "Đang điều chỉnh âm thanh Flow..." });
      const audioFilters = [`[0:a]volume=${options.originalVolume.toFixed(3)}[original]`];
      const audioInputs = ["-i", assembledPath];
      let audioMap = "[original]";
      if (options.musicPath) {
        audioInputs.push("-stream_loop", "-1", "-i", options.musicPath);
        audioFilters.push(`[1:a]volume=${options.musicVolume.toFixed(3)}[music]`);
        audioFilters.push("[original][music]amix=inputs=2:duration=first:dropout_transition=2[mixed]");
        audioMap = "[mixed]";
      }
      await runFfmpeg(["-y", "-hide_banner", ...audioInputs, "-filter_complex", audioFilters.join(";"), "-map", "0:v", "-map", audioMap, "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart", finalPath]);
      sendProgress(event, "video-editor:progress", { stage: "audio", processed: 1, total: 1, label: "Đã xử lý âm thanh." });
    } else {
      fs.copyFileSync(assembledPath, finalPath);
    }
    if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size < 1024) throw new Error("Video cuối không hợp lệ sau khi xuất.");
    sendProgress(event, "video-editor:progress", { stage: "completed", processed: 1, total: 1, label: "Đã xuất video hoàn chỉnh." });
    return { status: "completed", video: `/api/v1/projects/${projectId}/videos?final=1&v=${Date.now()}` };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function dispatchBrowserClick(window, point) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  const remoteClient = await getFlowRemoteClient(window);
  if (remoteClient) {
    await remoteFlowClick(remoteClient, { x, y });
    return;
  }
  if (window?.edgeRuntime) {
    try {
      await window.webContents.debugger.sendCommand("Page.bringToFront");
      await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await delay(70);
      await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      return;
    } catch { /* Fall back to the same target's DOM click if native dispatch is unavailable. */ }
    const clicked = await window.webContents.executeJavaScript(`(() => {
      const hit = document.elementFromPoint(${x}, ${y});
      const target = hit?.closest?.('button, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], mat-list-item, gem-list-item') || hit;
      if (!target || !target.isConnected || target.matches?.(':disabled')) return false;
      target.click();
      return true;
    })()`, true).catch(() => false);
    if (clicked) return;
  }
  window.show();
  window.focus();
  window.webContents.focus();
  if (window?.edgeRuntime) await window.webContents.debugger.sendCommand("Page.bringToFront").catch(() => {});
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await delay(120);
  await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await delay(70);
  await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function findFlowControlPoint(window, labels, exact = false) {
  const remoteClient = await getFlowRemoteClient(window);
  if (remoteClient) return remoteFlowPoint(remoteClient, labels, exact);
  const expression = [
    "(() => {",
    "  const wanted = " + JSON.stringify(labels) + ".map((value) => value.toLowerCase().replace(/\\s+/g, ' ').trim());",
    "  const exactMatch = " + JSON.stringify(exact) + ";",
    "  const roots = [document];",
    "  const seen = new Set(roots);",
    "  for (let index = 0; index < roots.length; index += 1) {",
    "    for (const element of roots[index].querySelectorAll('*')) {",
    "      if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }",
    "    }",
    "  }",
    "  const labelsFor = (element) => [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).map((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase()).filter(Boolean);",
    "  const isVisible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };",
    "  const candidates = roots.flatMap((root) => [...root.querySelectorAll('button, [role=\"button\"], [role=\"menuitem\"], [role=\"menuitemcheckbox\"], [role=\"option\"], [role=\"radio\"], mat-list-item, gem-list-item, a')]).filter((element) => !element.disabled && isVisible(element));",
    "  const matches = candidates.filter((element) => { const labels = labelsFor(element); return exactMatch ? labels.some((label) => wanted.some((value) => label === value || label.startsWith(value + ' ') || label.endsWith(value))) : labels.some((label) => wanted.some((value) => label === value || label.includes(value))); });",
    "  const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable=\"true\"]')]).find(isVisible);",
    "  const inputBounds = input?.getBoundingClientRect();",
    "  const score = (element) => { const labels = labelsFor(element); const exactRank = labels.some((label) => wanted.includes(label)) ? 0 : 1; const bounds = element.getBoundingClientRect(); const distance = inputBounds ? Math.hypot(bounds.left - inputBounds.left, bounds.top - inputBounds.top) : 0; return exactRank * 1000000 + distance; };",
    "  const selected = matches.sort((left, right) => score(left) - score(right))[0];",
    "  if (!selected) return null;",
    "  const bounds = selected.getBoundingClientRect();",
    "  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };",
    "})()",
  ].join("\n");
  return window.webContents.executeJavaScript(expression, true);
}

async function waitForFlowControlPoint(window, labels, exact = false, timeout = 30_000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 500) {
    const point = await findFlowControlPoint(window, labels, exact);
    if (point) return point;
    await delay(500);
  }
  throw new Error("Không tìm thấy điều khiển Google Flow: " + labels.join(" / ") + ".");
}

async function waitForFlowUploadMenuPoint(window, timeout = 15_000) {
  const remoteClient = await getFlowRemoteClient(window);
  if (remoteClient) return waitForRemoteFlowUploadPoint(remoteClient, timeout);
  for (let elapsed = 0; elapsed < timeout; elapsed += 500) {
    const point = await executeFlowJavaScript(window, `(() => {
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const visible = (element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const matches = roots.flatMap((root) => [...root.querySelectorAll('button[role="menuitem"], [role="menuitem"], flow-menu-item, [data-menu-item]')])
        .filter((element) => visible(element) && !element.disabled)
        .filter((element) => {
          const aria = normalize(element.getAttribute('aria-label'));
          const title = normalize(element.getAttribute('title'));
          const text = normalize(element.textContent);
          const combined = [aria, title, text].filter(Boolean).join(' ');
          return aria === 'upload' || title === 'upload' || (combined.includes('upload') && !combined.includes('uploads'));
        });
      const selected = matches[0];
      if (!selected) return null;
      const bounds = selected.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`, true);
    if (point) return point;
    await delay(500);
  }
  throw new Error("Không tìm thấy mục Upload trong menu Google Flow.");
}

async function clickFlowControl(window, labels, exact = false, timeout = 30_000) {
  const point = await waitForFlowControlPoint(window, labels, exact, timeout);
  await dispatchBrowserClick(window, point);
  await flowHumanPause("control");
}

async function dispatchBrowserEscape(window) {
  const remoteClient = await getFlowRemoteClient(window);
  if (remoteClient) {
    await remoteClient.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await remoteClient.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await flowHumanPause("escape");
    return;
  }
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await flowHumanPause("escape");
}

async function findFlowAssetPoint(window, filename) {
  const expression = [
    "(() => {",
    "  const target = " + JSON.stringify(filename) + ".toLowerCase();",
    "  const roots = [document];",
    "  const seen = new Set(roots);",
    "  for (let index = 0; index < roots.length; index += 1) {",
    "    for (const element of roots[index].querySelectorAll('*')) {",
    "      if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }",
    "    }",
    "  }",
    "  const candidates = roots.flatMap((root) => [...root.querySelectorAll('flow-grid-tile-container, flow-tile-container, button, [role=\"option\"], [role=\"listitem\"], [role=\"button\"], div')]).filter((element) => {",
    "    const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); const values = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).map((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase());",
    "    return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && values.some((value) => value === target || value.includes(target));",
    "  });",
    "  const selected = candidates.sort((left, right) => (left.textContent || '').length - (right.textContent || '').length)[0];",
    "  if (!selected) return null;",
    "  const bounds = selected.getBoundingClientRect();",
    "  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };",
    "})()",
  ].join("\n");
  return executeFlowJavaScript(window, expression);
}

async function findFlowFileInput(window) {
  return window.webContents.debugger.sendCommand("Runtime.evaluate", {
    expression: "(() => { const roots = [document]; const seen = new Set(roots); for (let index = 0; index < roots.length; index += 1) { for (const element of roots[index].querySelectorAll('*')) { if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); } } } return roots.flatMap((root) => [...root.querySelectorAll('input[type=file]')]).find((input) => !input.disabled) || null; })()",
    returnByValue: false,
  });
}

async function findFlowFileInputBackendNodeId(window) {
  const document = await window.webContents.debugger.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
  const pending = document?.root ? [document.root] : [];
  while (pending.length > 0) {
    const node = pending.shift();
    const attributes = node.attributes || [];
    const type = attributes[attributes.indexOf("type") + 1]?.toLowerCase();
    if (node.nodeName?.toLowerCase() === "input" && type === "file" && node.backendNodeId) return node.backendNodeId;
    if (Array.isArray(node.children)) pending.push(...node.children);
    if (Array.isArray(node.shadowRoots)) pending.push(...node.shadowRoots);
    if (node.contentDocument) pending.push(node.contentDocument);
  }
  return null;
}

async function countFlowVisualImages(window) {
  return executeFlowJavaScript(window, `(() => {
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      }
    }
    return roots.flatMap((root) => [...root.querySelectorAll('img')]).filter((image) => {
      const bounds = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      return bounds.width >= 32 && bounds.height >= 32 && image.complete && (image.naturalWidth || image.width) >= 64
        && style.visibility !== 'hidden' && style.display !== 'none';
    }).length;
  })()`, true);
}

async function waitForFlowAsset(window, filename, beforeImageCount = 0) {
  for (let elapsed = 0; elapsed < 60_000; elapsed += 500) {
    const ready = await executeFlowJavaScript(window, `(() => {
      const target = ${JSON.stringify(filename)}.toLowerCase();
      const text = document.body?.innerText || '';
      const uploading = /đang tải lên|uploading|đang tải bản xem trước|loading preview|\\b(?:[1-9]?\\d)%\\b/i.test(text);
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const hasFilename = roots.flatMap((root) => [...root.querySelectorAll('*')]).some((element) =>
        [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('alt')]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(target))
      );
      const visibleImages = roots.flatMap((root) => [...root.querySelectorAll('img')]).filter((image) => {
        const bounds = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        return bounds.width >= 32 && bounds.height >= 32 && image.complete && (image.naturalWidth || image.width) >= 64
          && style.visibility !== 'hidden' && style.display !== 'none';
      }).length;
      // Giữ đúng cơ chế ổn định của các bản trước: trong lúc Flow chưa kịp
      // hiện tên file, một ảnh mới đã tải xong vẫn là bằng chứng upload hợp lệ.
      return !uploading && (hasFilename || visibleImages > ${beforeImageCount});
    })()`, true);
    if (ready) return;
    await delay(500);
  }
  throw new Error("Google Flow chưa tải xong ảnh " + filename + ".");
}

async function countFlowPromptAttachments(window) {
  return executeFlowJavaScript(window, `(() => {
    const attachedImages = [...document.querySelectorAll('flow-base-prompt-box img[alt="Ingredient image"]')].filter((image) => image.getBoundingClientRect().width > 0);
    if (attachedImages.length) return attachedImages.length;
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      }
    }
    const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
    const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"]')]).find((element) => visible(element) && element.getBoundingClientRect().width > 100);
    if (!input) return 0;
    let container = input;
    for (let depth = 0; depth < 7 && container.parentElement; depth += 1) {
      const parent = container.parentElement;
      const bounds = parent.getBoundingClientRect();
      if (bounds.width > input.getBoundingClientRect().width + 260 || bounds.height > 650) break;
      container = parent;
    }
    return [...container.querySelectorAll('img')].filter((image) => {
      if (!visible(image)) return false;
      const bounds = image.getBoundingClientRect();
      return bounds.width >= 28 && bounds.height >= 28 && bounds.width <= 180 && bounds.height <= 180;
    }).length;
  })()`, true);
}

async function findFlowAssetTilePoint(window, filename) {
  return executeFlowJavaScript(window, `(() => {
    const target = ${JSON.stringify(filename)}.toLowerCase();
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      }
    }
    const visible = (element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width >= 32 && bounds.height >= 32 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const candidates = roots.flatMap((root) => [...root.querySelectorAll('flow-grid-tile-container')]).filter((element) => {
      if (!visible(element)) return false;
      const values = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent]
        .filter(Boolean).map((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase());
      return values.some((value) => value === target || value.includes(target));
    });
    const selected = candidates[0];
    if (!selected) return null;
    const bounds = selected.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  })()`, true);
}

async function attachFlowAssetToPrompt(window, filename, previousAttachmentCount) {
  if (await countFlowPromptAttachments(window) > previousAttachmentCount) return;
  await dispatchBrowserEscape(window);
  const ingredientsPoint = await waitForFlowControlPoint(window, ["Add ingredients to the prompt box", "Thêm thành phần vào hộp câu lệnh", "Thêm thành phần vào ô nhập câu lệnh"], false, 15_000);
  await dispatchBrowserClick(window, ingredientsPoint);
  await delay(1_500);
  // Flow mở bảng Recent mặc định; tệp vừa tải thường nằm trong Uploads.
  // Chuyển đúng tab và chỉ tìm tile trong popup, tránh bấm nhầm tile nền phía sau overlay.
  await selectFlowIngredientCategory(window, "uploads");
  const assetSelected = await clickFlowIngredientAsset(window, filename, 10_000);
  if (!assetSelected) throw new Error("Không tìm thấy đúng ảnh tham chiếu " + filename + " trong Google Flow.");
  for (let elapsed = 0; elapsed < 10_000; elapsed += 250) {
    if (await countFlowPromptAttachments(window) > previousAttachmentCount) return;
    await delay(250);
  }
  await clickFlowControl(window, ["Add to prompt", "Thêm vào câu lệnh", "Thêm vào prompt"], true, 30_000);
  for (let elapsed = 0; elapsed < 15_000; elapsed += 500) {
    if (await countFlowPromptAttachments(window) > previousAttachmentCount) return;
    await delay(500);
  }
  throw new Error("Ảnh nhân vật chính chưa được gắn vào cùng prompt Google Flow.");
}

async function selectFlowIngredientCategory(window, category) {
  for (let elapsed = 0; elapsed < 5_000; elapsed += 500) {
    const selected = await executeFlowJavaScript(window, `(() => {
      const target = ${JSON.stringify(category)}.toLowerCase();
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const candidates = roots.flatMap((root) => [...root.querySelectorAll('flow-add-menu-popover-content [role="tab"], flow-add-menu-popover-content mat-list-item, [role="dialog"] [role="tab"], [role="dialog"] mat-list-item, .cdk-overlay-pane [role="tab"], .cdk-overlay-pane mat-list-item')]).filter((element) => visible(element));
      const selected = candidates.find((element) => normalize(element.textContent).endsWith(target));
      if (!selected) return false;
      selected.click();
      return true;
    })()`);
    if (selected) {
      await delay(1_000);
      return true;
    }
    await delay(500);
  }
  return false;
}

async function clickFlowIngredientAsset(window, filename, timeout) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 500) {
    const selected = await executeFlowJavaScript(window, `(() => {
      const target = ${JSON.stringify(filename)}.toLowerCase();
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const overlay = roots.flatMap((root) => [...root.querySelectorAll('flow-add-menu-popover-content, [role="dialog"], .cdk-overlay-pane')]).find(visible);
      if (!overlay) return false;
      const candidates = [...overlay.querySelectorAll('flow-grid-tile-container, flow-tile-container, [role="option"], [role="button"], button, div')].filter((element) => visible(element));
      const matches = candidates.filter((element) => {
        const values = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).map(normalize);
        return values.some((value) => value === target || value.includes(target));
      }).sort((left, right) => (left.textContent || '').length - (right.textContent || '').length);
      const selected = matches[0];
      if (!selected) return false;
      selected.click();
      return true;
    })()`);
    if (selected) return true;
    await delay(500);
  }
  return false;
}

async function attachFlowAssetSourceToPrompt(window, source, previousAttachmentCount) {
  if (!source || await countFlowPromptAttachments(window) > previousAttachmentCount) return;
  await dispatchBrowserEscape(window);
  const ingredientsPoint = await waitForFlowControlPoint(window, ["Add ingredients to the prompt box", "Thêm thành phần vào hộp câu lệnh", "Thêm thành phần vào ô nhập câu lệnh"], false, 15_000);
  await dispatchBrowserClick(window, ingredientsPoint);
  await delay(1_000);
  const selected = await clickFlowIngredientAssetSource(window, source, 10_000);
  if (!selected) throw new Error("Không tìm thấy asset Flow đã tạo để gắn vào prompt.");
  for (let elapsed = 0; elapsed < 10_000; elapsed += 250) {
    if (await countFlowPromptAttachments(window) > previousAttachmentCount) return;
    await delay(250);
  }
  await clickFlowControl(window, ["Add to prompt", "Thêm vào câu lệnh", "Thêm vào prompt"], true, 30_000);
  for (let elapsed = 0; elapsed < 15_000; elapsed += 500) {
    if (await countFlowPromptAttachments(window) > previousAttachmentCount) return;
    await delay(500);
  }
  throw new Error("Asset Flow chưa được gắn vào prompt.");
}

function manualFlowCheckpointPath() {
  return path.join(app.getPath("userData"), "manual-flow-submissions.json");
}

function readManualFlowCheckpoints() {
  try {
    const stored = JSON.parse(fs.readFileSync(manualFlowCheckpointPath(), "utf8").replace(/^\uFEFF/, ""));
    return stored && typeof stored === "object" ? stored : {};
  } catch { return {}; }
}

function saveManualFlowCheckpoint(checkpoint) {
  const checkpoints = readManualFlowCheckpoints();
  checkpoints[checkpoint.id] = checkpoint;
  fs.writeFileSync(manualFlowCheckpointPath(), JSON.stringify(checkpoints, null, 2), { encoding: "utf8", mode: 0o600 });
  return checkpoint;
}

function removeManualFlowCheckpoint(id) {
  const checkpoints = readManualFlowCheckpoints();
  if (!checkpoints[id]) return;
  delete checkpoints[id];
  fs.writeFileSync(manualFlowCheckpointPath(), JSON.stringify(checkpoints, null, 2), { encoding: "utf8", mode: 0o600 });
}

function updateManualFlowCheckpoint(id, patch) {
  const checkpoints = readManualFlowCheckpoints();
  if (!checkpoints[id]) return null;
  checkpoints[id] = { ...checkpoints[id], ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(manualFlowCheckpointPath(), JSON.stringify(checkpoints, null, 2), { encoding: "utf8", mode: 0o600 });
  return checkpoints[id];
}

async function attachFlowAssetMediaIdToPrompt(window, mediaId, previousAttachmentCount) {
  if (!mediaId || await hasFlowPromptAttachmentMediaId(window, mediaId)) return;
  await dispatchBrowserEscape(window);
  const ingredientsPoint = await waitForFlowControlPoint(window, ["Add ingredients to the prompt box", "Thêm thành phần vào hộp câu lệnh", "Thêm thành phần vào ô nhập câu lệnh"], false, 15_000);
  await dispatchBrowserClick(window, ingredientsPoint);
  await delay(1_000);
  const selected = await clickFlowIngredientMediaId(window, mediaId, 30_000);
  if (!selected) throw new Error("Không tìm thấy mediaId Flow đã tạo để gắn vào prompt.");
  for (let elapsed = 0; elapsed < 10_000; elapsed += 250) {
    if (await hasFlowPromptAttachmentMediaId(window, mediaId)) return;
    await delay(250);
  }
  await clickFlowControl(window, ["Add to prompt", "Thêm vào câu lệnh", "Thêm vào prompt"], true, 30_000);
  for (let elapsed = 0; elapsed < 15_000; elapsed += 500) {
    if (await hasFlowPromptAttachmentMediaId(window, mediaId)) return;
    await delay(500);
  }
  throw new Error("MediaId Flow chưa được xác nhận trong chip tham chiếu.");
}

async function hasFlowPromptAttachmentMediaId(window, mediaId) {
  return Boolean(await executeFlowJavaScript(window, `(() => {
    const target = ${JSON.stringify(mediaId)};
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      }
    }
    const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
    return roots.flatMap((root) => [...root.querySelectorAll('flow-base-prompt-box img[alt="Ingredient image"], flow-image-ingredient-chip img')])
      .some((image) => visible(image) && (image.currentSrc || image.src || '').includes('/image/' + target));
  })()`, true));
}

async function clickFlowIngredientMediaId(window, mediaId, timeout) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 500) {
    const selected = await executeFlowJavaScript(window, `(() => {
      const target = ${JSON.stringify(mediaId)};
      const asbToken = (value) => {
        try {
          const match = new URL(value).pathname.match(/\\/asb\\/([^=/?]+)/);
          return match ? match[1] : null;
        } catch {
          const match = String(value || '').match(/\\/asb\\/([^=/?]+)/);
          return match ? match[1] : null;
        }
      };
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
      const overlay = roots.flatMap((root) => [...root.querySelectorAll('flow-add-menu-popover-content')]).find(visible);
      if (!overlay) return false;
      const libraryImage = roots.flatMap((root) => [...root.querySelectorAll('img[data-media-id]')])
        .find((candidate) => candidate.getAttribute('data-media-id') === target);
      const targetToken = asbToken(libraryImage?.currentSrc || libraryImage?.src || '');
      if (!targetToken) return false;
      const option = [...overlay.querySelectorAll('flow-add-menu-asset-list button[role="option"]')].find((candidate) => {
        if (!visible(candidate)) return false;
        return [...candidate.querySelectorAll('img.asset-thumbnail-image')]
          .some((image) => asbToken(image.currentSrc || image.src || '') === targetToken);
      });
      if (!option) return false;
      option.click();
      return true;
    })()`);
    if (selected) return true;
    await delay(500);
  }
  return false;
}

async function clickFlowIngredientAssetSource(window, source, timeout) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 500) {
    const selected = await executeFlowJavaScript(window, `(() => {
      const target = ${JSON.stringify(source)};
      const targetPath = (() => { try { return new URL(target).pathname; } catch { return target.split('?')[0]; } })();
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
      const overlay = roots.flatMap((root) => [...root.querySelectorAll('flow-add-menu-popover-content')]).find(visible);
      if (!overlay) return false;
      const candidates = [...overlay.querySelectorAll('flow-grid-tile-container, flow-tile-container, [role="button"], button, div')].filter(visible);
      const matches = candidates.filter((element) => [...element.querySelectorAll('img')].some((image) => {
        const value = image.currentSrc || image.src || '';
        let imagePath = value;
        try { imagePath = new URL(value).pathname; } catch { imagePath = value.split('?')[0]; }
        return imagePath === targetPath || imagePath.endsWith(targetPath) || targetPath.endsWith(imagePath);
      })).sort((left, right) => (left.textContent || '').length - (right.textContent || '').length);
      const selected = matches[0];
      if (!selected) return false;
      selected.click();
      return true;
    })()`);
    if (selected) return true;
    await delay(500);
  }
  return false;
}

async function uploadFlowAssetViaDrop(window, filePath, onStatus = () => {}) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
  const base64 = fs.readFileSync(filePath).toString("base64");
  const filename = path.basename(filePath);
  const dropped = await executeFlowJavaScript(window, `(async () => {
    const binary = atob(${JSON.stringify(base64)});
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const file = new File([bytes], ${JSON.stringify(filename)}, { type: ${JSON.stringify(mimeType)} });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      }
    }
    const visible = (element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const target = roots.flatMap((root) => [...root.querySelectorAll('.empty-project-message, [data-dropzone], [dropzone]')]).find(visible)
      || roots.flatMap((root) => [...root.querySelectorAll('*')]).find((element) => visible(element) && /start creating or drop media/i.test((element.textContent || '').trim()));
    if (!target) return false;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
    }
    return true;
  })()`, true);
  if (dropped) onStatus("Đã kéo-thả tệp bằng CDP vào vùng tải của Google Flow.");
  return Boolean(dropped);
}

async function uploadFlowAsset(window, filePath, attachToPrompt = false, onStatus = () => {}, options = {}) {
  const filename = path.basename(filePath);
  await flowHumanPause("upload");
  const beforeImageCount = await countFlowVisualImages(window);
  const previousAttachmentCount = attachToPrompt ? await countFlowPromptAttachments(window) : 0;
  if (await findFlowAssetPoint(window, filename)) {
    if (attachToPrompt) await attachFlowAssetToPrompt(window, filename, previousAttachmentCount);
    return;
  }
  if (getRemoteDebuggingPort() && process.env.DESKTOP_FLOW_REMOTE_UPLOAD === "1") {
    const uploaded = await uploadFlowAssetViaRemoteCdp(window, filePath, attachToPrompt, onStatus);
    if (uploaded) return;
  }
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
  let fileChooserResolve;
  const fileChooserPromise = new Promise((resolve) => { fileChooserResolve = resolve; });
  const fileChooserListener = (_event, method, params) => {
    if (method === "Page.fileChooserOpened") {
      onStatus("Đã nhận sự kiện file chooser từ Google Flow.");
      console.log("[Flow upload] Page.fileChooserOpened", params);
      fileChooserResolve(params || {});
    }
  };
  window.webContents.debugger.on("message", fileChooserListener);
  try {
    await window.webContents.debugger.sendCommand("Page.enable", { enableFileChooserOpenedEvent: true });
  } catch (error) {
    console.log("[Flow upload] Page.enable mở rộng không thành công", error?.message || error);
    try { await window.webContents.debugger.sendCommand("Page.enable"); } catch (fallbackError) {
      onStatus("CDP không bật được Page.enable: " + (fallbackError?.message || fallbackError));
      throw fallbackError;
    }
  }
  try { await window.webContents.debugger.sendCommand("Page.setInterceptFileChooserDialog", { enabled: true }); } catch (error) {
    onStatus("CDP không bật được chế độ bắt file chooser: " + (error?.message || error));
    throw error;
  }
  const mediaMenuPoint = await waitForFlowControlPoint(window, ["Add media menu", "Thêm nội dung nghe nhìn", "Thêm phương tiện"], true, 5_000).catch(() => null);
  onStatus(mediaMenuPoint ? "Đã tìm thấy nút Add media menu của Flow." : "Không thấy Add media menu, đang dùng nút thành phần dự phòng.");
  const ingredientsPoint = mediaMenuPoint
    ? null
    : await waitForFlowControlPoint(window, ["Add ingredients to the prompt box", "Thêm thành phần vào hộp câu lệnh", "Thêm thành phần vào ô nhập câu lệnh"], false, 15_000);
  await dispatchBrowserClick(window, mediaMenuPoint ?? ingredientsPoint);
  onStatus("Đã mở menu thêm nội dung Google Flow, đang tìm Upload...");
  const uploadPoint = await waitForFlowUploadMenuPoint(window, 15_000);
  await dispatchBrowserClick(window, uploadPoint);
  onStatus("Đã nhấn Upload, đang chờ hộp chọn tệp Google Flow...");
  console.log("[Flow upload] Đã nhấn Upload, đang chờ hộp chọn tệp Google Flow...");
  let chooser = null;
  let chooserReceived = false;
  const chooserWait = fileChooserPromise.then((params) => {
    chooserReceived = true;
    return params;
  });
  for (let elapsed = 0; elapsed < 12_000 && !chooserReceived; elapsed += 250) {
    await window.webContents.debugger.sendCommand("Runtime.evaluate", { expression: "void 0", returnByValue: true }).catch(() => {});
    chooser = await Promise.race([chooserWait, delay(250).then(() => null)]);
  }
  window.webContents.debugger.removeListener("message", fileChooserListener);
  if (chooser === null) {
    if (options.preferDropFallback) {
      const dropped = await uploadFlowAssetViaDrop(window, filePath, onStatus);
      if (dropped) {
        await waitForFlowAsset(window, filename, beforeImageCount);
        if (attachToPrompt) await attachFlowAssetToPrompt(window, filename, previousAttachmentCount);
        else await dispatchBrowserEscape(window);
        return;
      }
    }
    for (let elapsed = 0; elapsed < 3_000 && !chooserReceived; elapsed += 250) {
      const backendNodeId = await findFlowFileInputBackendNodeId(window).catch(() => null);
      if (backendNodeId) {
        onStatus("Đã tìm thấy ô file bằng CDP DOM, đang gắn tệp...");
        await window.webContents.debugger.sendCommand("DOM.setFileInputFiles", { files: [filePath], backendNodeId });
        chooser = { backendNodeId };
        break;
      }
      await delay(250);
    }
    if (chooser === null) {
      await window.webContents.executeJavaScript("(() => { if (!document.querySelector('input[data-modeling-ai-flow-upload]')) { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.dataset.modelingAiFlowUpload = 'true'; input.style.position = 'fixed'; input.style.left = '-10000px'; document.body.appendChild(input); } return true; })()", true);
      let candidate = null;
      for (let elapsed = 0; elapsed < 5_000; elapsed += 250) {
        await delay(250);
        candidate = await findFlowFileInput(window).catch(() => null);
        if (candidate?.result?.objectId) break;
      }
      if (candidate?.result?.objectId) {
        await window.webContents.debugger.sendCommand("DOM.setFileInputFiles", { files: [filePath], objectId: candidate.result.objectId });
        await window.webContents.executeJavaScript("(() => { const input = document.querySelector('input[data-modeling-ai-flow-upload]'); input?.dispatchEvent(new Event('change', { bubbles: true })); return true; })()", true);
        onStatus("Đã gắn tệp bằng ô file CDP dự phòng, đang chờ Flow lưu ảnh...");
        await waitForFlowAsset(window, filename, beforeImageCount);
        if (attachToPrompt) await attachFlowAssetToPrompt(window, filename, previousAttachmentCount);
        else await dispatchBrowserEscape(window);
        return;
      }
    }
    if (chooser === null) throw new Error("Google Flow không phát sự kiện file chooser và không tìm thấy ô file bằng CDP DOM để tải " + filename + ".");
  }
  if (chooser?.backendNodeId) {
    onStatus("Đã bắt sự kiện file chooser của Google Flow.");
    console.log("[Flow upload] Đã bắt sự kiện file chooser của Google Flow.");
    try { await window.webContents.debugger.sendCommand("DOM.enable"); } catch { /* DOM có thể đã được bật sẵn. */ }
    await window.webContents.debugger.sendCommand("DOM.setFileInputFiles", { files: [filePath], backendNodeId: chooser.backendNodeId });
    onStatus("Đã gắn tệp vào Google Flow, đang chờ Flow lưu ảnh...");
    console.log("[Flow upload] Đã gắn tệp vào Google Flow, đang chờ Flow lưu ảnh...");
    await waitForFlowAsset(window, filename, beforeImageCount);
    if (attachToPrompt) await attachFlowAssetToPrompt(window, filename, previousAttachmentCount);
    else await dispatchBrowserEscape(window);
    return;
  }
  throw new Error("Google Flow đã phát file chooser nhưng thiếu backendNodeId khi tải " + filename + ".");
}

async function addFlowAssetToStart(window, filePath) {
  const filename = path.basename(filePath);
  let uploadedAsset = await resolveFlowAssetIdentity(window, filename);
  await clickFlowControl(window, ["Bắt đầu", "Start"], true);
  await flowHumanPause("upload");
  let selected = false;
  for (let elapsed = 0; elapsed < 20_000 && !selected; elapsed += 250) {
    selected = await executeFlowJavaScript(window, `(() => {
      const target = ${JSON.stringify(filename)}.toLowerCase();
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
      const matches = [...document.querySelectorAll('button')].filter((element) => visible(element) && [element.textContent, element.getAttribute('aria-label')].filter(Boolean).some((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase() === target));
      const button = matches.find((element) => element.closest('.cdk-overlay-pane, [role="dialog"]')) || matches[matches.length - 1];
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!selected) await delay(250);
  }
  if (!selected) {
    const tilePoint = await findFlowAssetTilePoint(window, filename);
    if (tilePoint) {
      await dispatchBrowserClick(window, tilePoint);
      await delay(500);
      selected = true;
    }
  }
  if (!selected) throw new Error("Không tìm thấy ảnh " + filename + " trong bảng chọn Start frame Google Flow.");
  for (let elapsed = 0; elapsed < 5_000 && !uploadedAsset; elapsed += 250) {
    uploadedAsset = await resolveFlowAssetIdentity(window, filename);
    if (!uploadedAsset) await delay(250);
  }
  if (!uploadedAsset) throw new Error("Không resolve được identity asset " + filename + " sau khi chọn Start frame.");
  const hasStartFrame = () => verifyFlowStartFrameAttachment(window, uploadedAsset);
  for (let elapsed = 0; elapsed < 2_000; elapsed += 250) {
    if (await hasStartFrame()) return;
    await delay(250);
  }
  let confirmed = false;
  for (let elapsed = 0; elapsed < 5_000 && !confirmed; elapsed += 250) {
    confirmed = await executeFlowJavaScript(window, `(() => {
    const labels = ['add to prompt', 'thêm vào câu lệnh', 'thêm vào prompt'];
    const button = [...document.querySelectorAll('button')].find((element) => labels.includes((element.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase()));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
    if (!confirmed) await delay(250);
  }
  if (!confirmed && !await hasStartFrame()) throw new Error("Không xác nhận được ảnh " + filename + " vào Start frame Google Flow.");
  for (let elapsed = 0; elapsed < 10_000; elapsed += 250) {
    const attached = await hasStartFrame();
    if (attached) return;
    await delay(250);
  }
  throw new Error("Ảnh cảnh " + filename + " chưa được đặt vào Start frame Google Flow.");
}

async function clearFlowComposer(window) {
  const point = await findFlowControlPoint(window, ["Xoá câu lệnh", "Xóa câu lệnh", "Clear prompt"], false);
  if (point) {
    await dispatchBrowserClick(window, point);
    await flowHumanPause("control");
  }
}

async function ensureFlowMode(window, modes) {
  const wanted = (Array.isArray(modes) ? modes : [modes]).map((mode) => mode.toLowerCase());
  let reopenAttempts = 0;
  let lastObserved = [];
  for (let elapsed = 0; elapsed < 15_000; elapsed += 500) {
    const state = await executeFlowJavaScript(window, `(() => {
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const isVisible = (element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const labelsFor = (element) => [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent]
        .filter(Boolean).map((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase());
      const panel = roots.flatMap((root) => [...root.querySelectorAll('flow-toggles[aria-label="Mode"]')]).find(isVisible);
      const candidates = panel ? [...panel.querySelectorAll('[role="radio"]')].filter(isVisible) : [];
      const candidate = candidates.find((element) => labelsFor(element).some((label) => ${JSON.stringify(wanted)}.some((value) => label === value || label.endsWith(' ' + value) || label.endsWith(value))));
      const observed = candidates.flatMap(labelsFor);
      if (!candidate) return { selected: false, point: null, panelVisible: Boolean(panel), observed };
      const bounds = candidate.getBoundingClientRect();
      const selected = candidate.getAttribute('aria-checked') === 'true' || Boolean(candidate.closest('mat-button-toggle')?.classList.contains('mat-button-toggle-checked'));
      return { selected, point: { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }, panelVisible: true, observed };
    })()`, true);
    lastObserved = state?.observed || lastObserved;
    if (state?.selected) return;
    if (state?.point) {
      await dispatchBrowserClick(window, state.point);
      await delay(350);
      return;
    }
    if (!state?.panelVisible && reopenAttempts < 2) {
      const reopened = await executeFlowJavaScript(window, `(() => {
        const button = [...document.querySelectorAll('button[aria-label="Settings trigger"]')].find((element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; });
        if (!button) return false;
        button.click();
        return true;
      })()`, true).catch(() => false);
      if (reopened) reopenAttempts += 1;
    }
    await delay(500);
  }
  recordBrowserAction({ action: "flow-mode-control-missing", wanted, observed: lastObserved, reopenAttempts });
  throw new Error('Không tìm thấy chế độ ' + wanted.join(' / ') + ' trong cài đặt Google Flow.');
}

async function ensureFlowVideoMode(window) {
  for (let elapsed = 0; elapsed < 30_000; elapsed += 500) {
    const state = await executeFlowJavaScript(window, `(() => {
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const visible = (element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const label = (element) => [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent]
        .filter(Boolean).map((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase());
      const candidate = roots.flatMap((root) => [...root.querySelectorAll('[role="radio"], [role="option"], button')])
        .find((element) => visible(element) && label(element).some((value) => value === 'video' || value.endsWith(' video') || /videocam\\s*video$/.test(value)));
      if (candidate) {
        const selected = candidate.getAttribute('aria-checked') === 'true';
        if (!selected) candidate.click();
        return { selected, clicked: !selected };
      }
      const summary = document.body?.innerText || '';
      return { selected: /(?:^|\\n)video\\s*·\\s*\\d+p\\s*·/im.test(summary), clicked: false };
    })()` , true);
    if (state?.selected) return;
    await delay(state?.clicked ? 700 : 500);
  }
  throw new Error('Không tìm thấy hoặc không chọn được chế độ Video trong cài đặt Google Flow.');
}

async function ensureFlowFramesMode(window, timeout = 15_000) {
  const startedAt = Date.now();
  let lastObserved = [];
  while (Date.now() - startedAt < timeout) {
    const state = await executeFlowJavaScript(window, `(() => {
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const visible = (element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const labelsFor = (element) => [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).map(normalize);
      const hasLabel = (element, target) => labelsFor(element).some((label) => label === target || label.endsWith(' ' + target) || label.endsWith(target));
      const radios = roots.flatMap((root) => [...root.querySelectorAll('button[role="radio"], [role="radio"]')]).filter(visible);
      const frames = radios.find((element) => hasLabel(element, 'frames'));
      const ingredients = radios.find((element) => hasLabel(element, 'ingredients'));
      const checked = (element) => Boolean(element && (element.getAttribute('aria-checked') === 'true' || element.closest('mat-button-toggle')?.classList.contains('mat-button-toggle-checked')));
      const framesSelected = checked(frames);
      const ingredientsSelected = checked(ingredients);
      if (!frames) return { ready: false, clicked: false, framesSelected, ingredientsSelected, observed: radios.flatMap(labelsFor).filter(Boolean) };
      if (!framesSelected || ingredientsSelected) frames.click();
      return {
        ready: framesSelected && !ingredientsSelected,
        clicked: !framesSelected || ingredientsSelected,
        framesSelected,
        ingredientsSelected,
        observed: radios.flatMap(labelsFor).filter(Boolean),
      };
    })()`, true);
    lastObserved = state?.observed || lastObserved;
    if (state?.ready) {
      recordBrowserAction({ action: "flow-frames-mode-verified", framesSelected: true, ingredientsSelected: false, observed: lastObserved });
      return;
    }
    await delay(state?.clicked ? 500 : 350);
  }
  recordBrowserAction({ action: "flow-frames-mode-not-selected", framesSelected: false, ingredientsSelected: false, observed: lastObserved });
  throw createFlowGenerationFailure("FLOW_START_FRAME_MODE_NOT_SELECTED", "Google Flow chưa xác nhận chế độ Frames/Start frame.", {
    firstDivergence: "FLOW_START_FRAME_MODE_NOT_CONFIRMED",
    observed: lastObserved,
  });
}

async function configureFlowVideo(window) {
  await clickFlowControl(window, ["Settings trigger"], true);
  await ensureFlowVideoMode(window);
  await ensureFlowAspectRatio(window, "9:16");
  await clickFlowControl(window, ["Chọn nhóm mô hình", "Select model", "Model"], false);
  await clickFlowControl(window, ["Veo 3.1 - Lite [Lower Priority]"], true, 15_000);
  const qualityPoint = await findFlowControlPoint(window, ["720p"], true);
  if (qualityPoint) { await dispatchBrowserClick(window, qualityPoint); await flowHumanPause("control"); }
  await clickFlowControl(window, ["4 giây", "4 seconds", "4s"], false);
  await clickFlowControl(window, ["x1"], true);
  // Flow exposes the Start/End frame inputs after the other settings are set.
  await ensureFlowFramesMode(window);
  await dispatchBrowserEscape(window);
}

async function resolveFlowAssetIdentity(window, filename) {
  return executeFlowJavaScript(window, `(() => {
    const target = ${JSON.stringify(filename)}.toLowerCase();
    const sourceFor = (image) => image?.currentSrc || image?.src || '';
    const containers = [...document.querySelectorAll('flow-grid-tile-container, [aria-label], button, [role="option"]')]
      .filter((element) => [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent]
        .filter(Boolean).some((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase().includes(target)));
    const image = containers.flatMap((element) => [...element.querySelectorAll('img')])
      .find((candidate) => candidate.getAttribute('data-media-id') || sourceFor(candidate));
    if (!image) return null;
    return { mediaId: image.getAttribute('data-media-id') || null, source: sourceFor(image) || null };
  })()`);
}

async function verifyFlowStartFrameAttachment(window, asset) {
  if (!asset?.mediaId && !asset?.source) return false;
  return Boolean(await executeFlowJavaScript(window, `(() => {
    const expected = ${JSON.stringify(asset)};
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      }
    }
    const visible = (element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const labelsFor = (element) => [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).map(normalize);
    const hasLabel = (element, target) => labelsFor(element).some((label) => label === target || label.endsWith(' ' + target) || label.endsWith(target));
    const radios = roots.flatMap((root) => [...root.querySelectorAll('button[role="radio"], [role="radio"]')]).filter(visible);
    const frames = radios.find((element) => hasLabel(element, 'frames'));
    const ingredients = radios.find((element) => hasLabel(element, 'ingredients'));
    const framesSelected = Boolean(frames && (frames.getAttribute('aria-checked') === 'true' || frames.closest('mat-button-toggle')?.classList.contains('mat-button-toggle-checked')));
    const ingredientsSelected = Boolean(ingredients && (ingredients.getAttribute('aria-checked') === 'true' || ingredients.closest('mat-button-toggle')?.classList.contains('mat-button-toggle-checked')));
    // Flow closes the settings popover after the Start-frame picker opens. In that
    // state the radio controls are absent, so rely on the pre-submit Frames
    // postcondition and require a slot-specific attachment below. If controls are
    // still present, a visible Ingredients selection remains a hard failure.
    if ((frames || ingredients) && (!framesSelected || ingredientsSelected)) return false;
    const sourceFor = (image) => image?.currentSrc || image?.src || '';
    const clean = (value) => { try { return new URL(value).pathname; } catch { return String(value || '').split('?')[0]; } };
    const sameAsset = (image) => {
      const source = sourceFor(image);
      return (expected.mediaId && (image?.getAttribute('data-media-id') === expected.mediaId || source.includes('/image/' + expected.mediaId)))
        || (expected.source && clean(source) === clean(expected.source));
    };
    const attached = roots.flatMap((root) => [...root.querySelectorAll('button[aria-label="Image ingredient"] img, .chip-container[aria-label="Image ingredient"] img, img.ghost-image, flow-image-ingredient-chip img, flow-media-chip img, .filled-chip img')])
      .some(sameAsset);
    return attached;
  })()`));
}

async function ensureFlowAspectRatio(window, ratio, timeout = 15_000) {
  const startedAt = Date.now();
  const expectedUrl = window.webContents.getURL();
  let reopenAttempts = 0;
  while (Date.now() - startedAt < timeout) {
    const state = await executeFlowJavaScript(window, `(() => {
      const expectedUrl = ${JSON.stringify(expectedUrl)};
      const ratio = ${JSON.stringify(ratio)};
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
      const panel = [...document.querySelectorAll('flow-toggles[aria-label="Aspect ratio"]')].find(visible);
      if (!panel) return { url: location.href, ready: false };
      const button = [...panel.querySelectorAll('button[role="radio"]')].find((element) => {
        const text = element.querySelector('.toggle-text')?.textContent?.replace(/\\s+/g, ' ').trim();
        return text === ratio;
      });
      return { url: location.href, ready: true, found: Boolean(button), selected: button?.getAttribute('aria-checked') === 'true' };
    })()`);
    if (state?.url !== expectedUrl) throw new Error("FLOW_CDP_TARGET_MISMATCH: Settings đang được đọc từ Flow page khác.");
    if (state?.ready && state?.found) {
      if (state.selected) return;
      const changed = await executeFlowJavaScript(window, `(() => {
        const panel = [...document.querySelectorAll('flow-toggles[aria-label="Aspect ratio"]')].find((element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0; });
        const button = [...(panel?.querySelectorAll('button[role="radio"]') || [])].find((element) => element.querySelector('.toggle-text')?.textContent?.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(ratio)});
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!changed) throw new Error("FLOW_ASPECT_RATIO_CONTROL_MISSING: không tìm thấy nút " + ratio + ".");
      await delay(250);
      continue;
    }
    if (reopenAttempts < 2) {
      await clickFlowControl(window, ["Settings trigger"], true, 5_000);
      reopenAttempts += 1;
    }
    await delay(250);
  }
  throw new Error("FLOW_ASPECT_RATIO_READY_TIMEOUT: Settings chưa sẵn sàng cho " + ratio + ".");
}

async function configureFlowImage(window) {
  await clickFlowControl(window, ["Điều kiện kích hoạt cài đặt", "Video settings", "Settings"], false);
  await ensureFlowMode(window, ["Image", "Ảnh"]);
  await clickFlowControl(window, ["9:16"], true);
  await clickFlowControl(window, ["Chọn nhóm mô hình", "Select model", "Model"], false);
  await clickFlowControl(window, ["Nano Banana Pro"], true, 15_000);
  await clickFlowControl(window, ["x1"], true);
  await dispatchBrowserEscape(window);
}

async function createFlowProjectAttempt(window) {
  await waitForFlowState(window, "FLOW_PAGE_LOADING");
  await waitForFlowState(window, "FLOW_SESSION_CHECK");
  let requestedWorkspace = false;
  for (let elapsed = 0; elapsed < FLOW_STATE_TIMEOUTS.FLOW_PROJECT_CREATING; elapsed += 500) {
    if (window.webContents.getURL().includes("accounts.google.com")) {
      throw new Error("Google Flow yêu cầu đăng nhập. Hãy đăng nhập một lần trong cửa sổ Flow rồi chạy lại.");
    }
    const nextPoint = await findFlowControlPoint(window, ["Tiếp theo", "Next"], true);
    if (nextPoint) {
      await dispatchBrowserClick(window, nextPoint);
      await delay(500);
      continue;
    }
    if (!requestedWorkspace) {
      const enterFlowPoint = await findFlowControlPoint(window, ["Create with Google Flow", "Tạo bằng Google Flow", "Try Google Flow", "Thử Google Flow"], true);
      if (enterFlowPoint) {
        const clicked = await executeFlowJavaScript(window, `(() => {
          const labels = ["Create with Google Flow", "Tạo bằng Google Flow", "Try Google Flow", "Thử Google Flow"];
          const wanted = labels.map((value) => value.toLowerCase());
          const button = [...document.querySelectorAll("button, [role=\"button\"]")].find((element) => {
            const values = [element.getAttribute("aria-label"), element.textContent]
              .filter(Boolean)
              .map((value) => value.replace(/\\s+/g, " ").trim().toLowerCase());
            return values.some((value) => wanted.includes(value));
          });
          if (!button) return false;
          button.click();
          return true;
        })()`, true);
        if (!clicked) await dispatchBrowserClick(window, enterFlowPoint);
        requestedWorkspace = true;
        await delay(1_000);
        continue;
      }
    }
    const newProjectPoint = await findFlowControlPoint(window, ["Dự án mới", "New project"], false);
    if (newProjectPoint) {
      const clicked = await executeFlowJavaScript(window, `(() => {
        const wanted = ["Dự án mới", "New project"];
        const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim().toLowerCase();
        const button = [...document.querySelectorAll("button, [role=\\"button\\"]")].find((element) => {
          const labels = [element.getAttribute("aria-label"), element.getAttribute("title"), element.textContent].map(normalize).filter(Boolean);
          return labels.some((label) => wanted.some((value) => {
            const target = normalize(value);
            return label === target || label.endsWith(target);
          }));
        });
        if (!button) return false;
        button.click();
        return true;
      })()`, true);
      if (!clicked) await dispatchBrowserClick(window, newProjectPoint);
      break;
    }
    await delay(500);
  }
  for (let elapsed = 0; elapsed < FLOW_STATE_TIMEOUTS.FLOW_PROJECT_LOADING; elapsed += 500) {
    const url = window.webContents.getURL();
    if (/flow\.google\.com\/project\//i.test(url)) return url;
    await delay(500);
  }
  throw new Error("FLOW_PROJECT_LOADING_TIMEOUT: Google Flow không mở được project mới.");
}

async function inspectFlowReadiness(window) {
  if (!window || window.isDestroyed()) return { url: null, readyState: "destroyed", loginRequired: false, projectId: null, promptReady: false, uploadReady: false, loadingOverlay: false, homeReady: false };
  try {
    const state = await window.webContents.executeJavaScript(`(() => {
      const url = location.href;
      const text = document.body?.innerText || '';
      const roots = [document]; const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
      const labels = roots.flatMap((root) => [...root.querySelectorAll('button, [role="button"], [role="menuitem"], a, input[type="file"]')]).filter(visible).map((element) => [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim().toLowerCase());
      const projectMatch = url.match(/flow\\.google\\.com\\/project\\/([^/?#]+)/i);
      const promptReady = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"]')]).some((element) => visible(element) && element.getBoundingClientRect().width > 100 && element.getBoundingClientRect().height >= 20);
      const uploadReady = Boolean(roots.flatMap((root) => [...root.querySelectorAll('input[type="file"], flow-ingredient-bar')]).find(visible)) || labels.some((label) => /add media|add ingredients|thêm phương tiện|thêm thành phần|upload/.test(label));
      const homeReady = !projectMatch && labels.some((label) => /new project|dự án mới|create with google flow|tạo bằng google flow|try google flow|thử google flow/.test(label));
      const loadingOverlay = Boolean(roots.flatMap((root) => [...root.querySelectorAll('[aria-busy="true"], [role="progressbar"], mat-progress-spinner')]).find(visible));
      const loginRequired = /accounts\\.google\\.com/i.test(url) || (!projectMatch && /sign in|đăng nhập|log in/i.test(text) && !promptReady);
      return { url, readyState: document.readyState, title: document.title, loginRequired, projectId: projectMatch?.[1] || null, promptReady, uploadReady, loadingOverlay, homeReady };
    })()`, true);
    return state || { url: window.webContents.getURL(), readyState: "unknown", loginRequired: false, projectId: null, promptReady: false, uploadReady: false, loadingOverlay: false, homeReady: false };
  } catch (error) {
    return { url: window.webContents.getURL(), readyState: "error", loginRequired: false, projectId: null, promptReady: false, uploadReady: false, loadingOverlay: false, homeReady: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function waitForFlowState(window, state, timeout = FLOW_STATE_TIMEOUTS[state] || 30_000) {
  const startedAt = Date.now();
  recordBrowserAction({ action: "flow-state-wait", state, timeoutMs: timeout, url: window?.webContents?.getURL?.() || null });
  for (let elapsed = 0; elapsed < timeout; elapsed += 500) {
    if (!window || window.isDestroyed()) throw new Error(`FLOW_STATE_FAILED_${state}: cửa sổ Flow đã bị đóng.`);
    const snapshot = await inspectFlowReadiness(window);
    if (snapshot.loginRequired) throw new Error("BROWSER_ENVIRONMENT_NOT_READY: Google Flow yêu cầu đăng nhập.");
    const ready = state === "FLOW_WINDOW_STARTING"
      ? true
      : state === "FLOW_PAGE_LOADING"
        ? /flow\.google\.com/i.test(snapshot.url || "") && (snapshot.readyState !== "loading" || snapshot.homeReady || snapshot.projectId)
        : state === "FLOW_SESSION_CHECK"
          ? !snapshot.loginRequired && /flow\.google\.com/i.test(snapshot.url || "")
          : state === "FLOW_HOME_READY"
            ? snapshot.homeReady
            : state === "FLOW_PROJECT_CREATING"
              ? Boolean(snapshot.projectId)
              : state === "FLOW_PROJECT_LOADING"
                ? Boolean(snapshot.projectId) && snapshot.readyState !== "loading"
                : state === "FLOW_PROJECT_READY"
                  ? Boolean(snapshot.projectId && snapshot.promptReady && snapshot.uploadReady && !snapshot.loadingOverlay)
                  : false;
    if (ready) {
      recordBrowserAction({ action: "flow-state-ready", state, success: true, elapsedMs: Date.now() - startedAt, snapshot });
      return snapshot;
    }
    await delay(500);
  }
  const snapshot = await inspectFlowReadiness(window);
  recordBrowserAction({ action: "flow-state-timeout", state, success: false, timeoutMs: timeout, snapshot });
  throw new Error(`FLOW_STATE_TIMEOUT_${state}: trạng thái trình duyệt chưa sẵn sàng.`);
}

async function preflightFlowBrowser(window) {
  await waitForFlowState(window, "FLOW_WINDOW_STARTING");
  await window.webContents.loadURL(FLOW_HOME_URL);
  await waitForFlowState(window, "FLOW_PAGE_LOADING");
  await waitForFlowState(window, "FLOW_SESSION_CHECK");
  await waitForFlowState(window, "FLOW_HOME_READY");
  return window;
}

async function createFlowProject(window) {
  let currentWindow = window;
  const strategies = [
    { id: "flow-refresh-redetect", prepare: async () => { if (!currentWindow.webContents.getURL().startsWith("https://flow.google.com")) await currentWindow.webContents.loadURL(FLOW_HOME_URL); else await currentWindow.webContents.reload(); } },
    { id: "flow-home-recreate", prepare: async () => { await currentWindow.webContents.loadURL(FLOW_HOME_URL); } },
    { id: "flow-window-recreate", prepare: async () => { await closeFlowWindow(false); currentWindow = await createFlowWindow(); } },
    { id: "flow-session-recreate", prepare: async () => { await closeFlowWindow(false); currentWindow = await createFlowWindow(); await currentWindow.webContents.session.clearCache().catch(() => {}); } },
  ];
  let lastError = "";
  for (const strategy of strategies) {
    try {
      recordBrowserAction({ action: "flow-recovery-strategy", strategyId: strategy.id, success: false });
      await strategy.prepare();
      await waitForFlowState(currentWindow, "FLOW_PAGE_LOADING");
      await waitForFlowState(currentWindow, "FLOW_SESSION_CHECK");
      await waitForFlowState(currentWindow, "FLOW_HOME_READY");
      recordBrowserAction({ action: "flow-state-transition", state: "FLOW_PROJECT_CREATING", strategyId: strategy.id });
      const projectUrl = await createFlowProjectAttempt(currentWindow);
      await waitForFlowState(currentWindow, "FLOW_PROJECT_LOADING");
      const ready = await waitForFlowState(currentWindow, "FLOW_PROJECT_READY");
      recordBrowserAction({ action: "flow-project-ready", strategyId: strategy.id, success: true, projectId: ready.projectId, url: ready.url });
      return { window: currentWindow, projectUrl: projectUrl || ready.url };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      recordBrowserAction({ action: "flow-recovery-strategy", strategyId: strategy.id, success: false, error: lastError });
      if (/BROWSER_ENVIRONMENT_NOT_READY|đăng nhập/i.test(lastError)) throw error;
      await captureBrowserFailure(currentWindow, { action: "flow-project-create", state: strategy.id, error: lastError });
    }
  }
  throw new Error(`FLOW_PROJECT_OPEN_FAILURE: Google Flow không mở được project mới sau các strategy browser khác nhau. ${lastError}`);
}

async function reloadFlowProject(window, projectUrl, settleMs = 1_500) {
  const targetUrl = projectUrl || window.webContents.getURL();
  flowLoadPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Google Flow tải lại quá lâu.")), 60_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timeout); resolve(); });
  });
  // Opening a generated clip leaves Flow in its video viewer. A browser reload
  // preserves that viewer, so the next scene cannot find the video controls.
  // Navigate to the original project URL instead to restore the composer.
  await window.webContents.loadURL(targetUrl);
  await flowLoadPromise;
  if (!window.webContents.getURL().startsWith(targetUrl)) {
    await window.webContents.loadURL(targetUrl);
    await waitForFlowLoad(window);
  }
  await delay(settleMs);
  await waitForFlowComposer(window);
}

async function waitForFlowComposer(window, timeout = 20_000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 500) {
    const ready = await executeFlowJavaScript(window, `(() => {
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const isVisible = (element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return bounds.width > 100 && bounds.height >= 20 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      return roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"]')]).some(isVisible);
    })()`, true);
    if (ready) return;
    const backPoint = await findFlowControlPoint(window, ["Back button to go to previous page", "Quay lại", "Back", "arrow_back"], false, 1_000).catch(() => null);
    if (backPoint) {
      await dispatchBrowserClick(window, backPoint);
      await delay(800);
      continue;
    }
    await delay(500);
  }
  throw new Error("Google Flow chưa quay về màn hình soạn lệnh.");
}

function createFlowGenerationFailure(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.firstDivergence = typeof details.firstDivergence === "string" ? details.firstDivergence : code;
  error.details = details;
  if (typeof details.cause === "string") error.cause = details.cause;
  return error;
}

function isNonRetryableFlowProviderBlock(error) {
  return Boolean(error && typeof error === "object" && error.code === "FLOW_PROVIDER_UNUSUAL_ACTIVITY");
}

const MAX_FLOW_PROVIDER_RELOAD_RECOVERY = 1;
const FLOW_PROVIDER_RELOAD_SETTLE_MS = 10_000;
// Flow interaction pacing: keep each UI transition observable before the next
// action. This improves managed-browser reliability; it is not an anti-abuse
// bypass and it does not increase the recovery budget.
const FLOW_HUMAN_PACE = Object.freeze({
  control: 900,
  escape: 700,
  prompt: 1_200,
  upload: 1_500,
  beforeGenerate: 2_500,
});

async function flowHumanPause(kind) {
  await delay(FLOW_HUMAN_PACE[kind] || FLOW_HUMAN_PACE.control);
}

async function inspectFlowVideo(window, beforeSources = [], beforeCardCount = 0) {
  const expression = [
    "(() => {",
    "  const before = new Set(" + JSON.stringify(beforeSources) + ");",
    "  const roots = [document]; const seen = new Set(roots);",
    "  for (let index = 0; index < roots.length; index += 1) { for (const element of roots[index].querySelectorAll('*')) { if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); } } }",
    "  const videos = roots.flatMap((root) => [...root.querySelectorAll('video')]).filter((video) => { const bounds = video.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0; });",
    "  const sourceFor = (video) => video.currentSrc || video.src || video.querySelector('source')?.src || '';",
    "  const video = videos.reverse().find((candidate) => { const source = sourceFor(candidate); return source && !before.has(source) && candidate.readyState >= 2 && Number.isFinite(candidate.duration) && candidate.duration > 0; });",
    "  const resourceSources = performance.getEntriesByType('resource').map((entry) => entry.name).filter((source) => /flow-content\\.google\\/video\\//i.test(source) && !before.has(source));",
    "  const videoCards = roots.flatMap((root) => [...root.querySelectorAll('img[alt=\"Generated video thumbnail\"]')]).filter((element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0; });",
    "  const thumbnail = videoCards[0] || null;",
    "  const text = document.body?.innerText || '';",
    "  const playButton = roots.flatMap((root) => [...root.querySelectorAll('button[aria-label=\"Play\"], button[aria-label=\"Phát\"]')]).find((element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0; });",
    "  const playCircle = roots.flatMap((root) => [...root.querySelectorAll('[role=\"button\"]')]).find((element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0 && element.querySelector('mat-icon')?.textContent?.trim() === 'play_circle'; });",
    "  const downloadButton = roots.flatMap((root) => [...root.querySelectorAll('button, [role=\"button\"]')]).find((element) => { const bounds = element.getBoundingClientRect(); const label = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim().toLowerCase(); return bounds.width > 0 && bounds.height > 0 && /download media|tải xuống/.test(label); });",
    "  const thumbnailBounds = thumbnail?.getBoundingClientRect();",
    "  const playButtonBounds = playButton?.getBoundingClientRect();",
    "  const playCircleBounds = playCircle?.getBoundingClientRect();",
    "  const downloadBounds = downloadButton?.getBoundingClientRect();",
    "  const editorPage = /\\/edit\\//i.test(location.href) && (Boolean(thumbnail) || /total duration|current time/i.test(text));",
    "  const unusualActivity = /unusual activity|hoạt động bất thường/i.test(text);",
    "  const notCharged = /not been charged|chưa bị tính phí/i.test(text);",
    "  return { videoSource: video ? sourceFor(video) : (resourceSources[resourceSources.length - 1] || null), duration: video && Number.isFinite(video.duration) ? video.duration : null, videoCardCount: videoCards.length, videoCard: Boolean(thumbnail), thumbnailPoint: thumbnailBounds ? { x: thumbnailBounds.left + thumbnailBounds.width / 2, y: thumbnailBounds.top + thumbnailBounds.height / 2 } : null, playButton: Boolean(playButton), playButtonPoint: playButtonBounds ? { x: playButtonBounds.left + playButtonBounds.width / 2, y: playButtonBounds.top + playButtonBounds.height / 2 } : null, playCircle: Boolean(playCircle), playCirclePoint: playCircleBounds ? { x: playCircleBounds.left + playCircleBounds.width / 2, y: playCircleBounds.top + playCircleBounds.height / 2 } : null, editorReady: editorPage, downloadPoint: downloadBounds ? { x: downloadBounds.left + downloadBounds.width / 2, y: downloadBounds.top + downloadBounds.height / 2 } : null, unusualActivity, notCharged, failed: unusualActivity || /không thành công|không tải được video|failed|couldn't load video|could not load video|generation failed/i.test(text) };",
    "})()",
  ].join("\n");
  return executeFlowJavaScript(window, expression).then((state) => ({ ...state, beforeCardCount }));
}

async function waitForFlowVideo(window, beforeSources, beforeCardCount = 0, timeout = 600_000, context = {}) {
  let openedVideoCard = false;
  let startedPlayback = false;
  for (let elapsed = 0; elapsed < timeout; elapsed += 2_000) {
    const state = await inspectFlowVideo(window, beforeSources, beforeCardCount);
    if (state?.unusualActivity && (!Number.isFinite(context.providerDetectionNotBefore) || Date.now() >= context.providerDetectionNotBefore)) {
      const details = {
        stage: context.stage || "STAGE_4_VIDEO_GENERATION",
        sceneId: typeof context.sceneId === "string" ? context.sceneId : null,
        flowProjectUrl: redactNetworkUrl(typeof context.flowProjectUrl === "string" ? context.flowProjectUrl : window?.webContents?.getURL?.() || ""),
        flowUrl: redactNetworkUrl(window?.webContents?.getURL?.() || ""),
        providerMessage: "We noticed some unusual activity. Please visit the Help Center for more information. You have not been charged for this generation.",
        providerBlockedAt: new Date().toISOString(),
        recommendedManualRetryAfter: null,
        autoRetryAllowed: false,
        generateTriggered: context.generateTriggered !== false,
        generationStarted: false,
        providerJobCreated: false,
        beforeCardCount,
        observedCardCount: state.videoCardCount ?? 0,
        generationRequestObserved: false,
        notCharged: state.notCharged === true,
        recoveryAttempt: Number.isInteger(context.providerRecoveryAttempt) ? context.providerRecoveryAttempt : 0,
        recoveryBudget: MAX_FLOW_PROVIDER_RELOAD_RECOVERY,
        boundedReloadRecoveryAllowed: context.allowProviderReloadRecovery === true,
        firstDivergence: "FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK",
      };
      recordBrowserAction({ action: "flow-generation-blocked", code: "FLOW_PROVIDER_UNUSUAL_ACTIVITY", ...details });
      throw createFlowGenerationFailure("FLOW_PROVIDER_UNUSUAL_ACTIVITY", "Google Flow tạm chặn tạo video vì phát hiện hoạt động bất thường.", details);
    }
    if (state?.videoSource) return state;
    if (state?.editorReady) return state;
    if (state?.videoCardCount > beforeCardCount && !openedVideoCard) {
      openedVideoCard = true;
      if (state.thumbnailPoint) await dispatchBrowserClick(window, state.thumbnailPoint);
      await delay(1_000);
      continue;
    }
    if (!startedPlayback && (state?.playButtonPoint || state?.playCirclePoint)) {
      startedPlayback = true;
      await dispatchBrowserClick(window, state.playButtonPoint || state.playCirclePoint);
      await delay(1_000);
      continue;
    }
    if (state?.failed) return state;
    await delay(2_000);
  }
  return { failed: false, timedOut: true };
}

async function waitForFlowSubmissionAcknowledgement(window, beforeSources = [], beforeCardCount = 0, timeout = 7_000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 250) {
    const videoState = await inspectFlowVideo(window, beforeSources, beforeCardCount).catch(() => null);
    if (videoState?.unusualActivity || videoState?.videoSource || videoState?.editorReady || videoState?.videoCardCount > beforeCardCount) return videoState;
    const uiState = await executeFlowJavaScript(window, `(() => {
      const roots = [document]; const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
      const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]).find(visible);
      const button = roots.flatMap((root) => [...root.querySelectorAll('button, [role="button"]')]).find((element) => visible(element) && String(element.getAttribute('aria-label') || '').toLowerCase() === 'start generation');
      const text = document.body?.innerText || '';
      return { promptPresent: Boolean(input), sendDisabled: Boolean(button?.disabled || button?.getAttribute('aria-disabled') === 'true'), busy: /generating|đang tạo|stop generation|dừng tạo|cancel generation/i.test(text) };
    })()`).catch(() => null);
    if (uiState && (!uiState.promptPresent || uiState.sendDisabled || uiState.busy)) return { submitted: true, ...uiState };
    await delay(250);
  }
  return null;
}

async function clickFlowGenerateDomFallback(window) {
  return executeFlowJavaScript(window, `(() => {
    const roots = [document]; const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
    const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
    const button = roots.flatMap((root) => [...root.querySelectorAll('button, [role="button"]')]).find((element) => visible(element) && String(element.getAttribute('aria-label') || '').toLowerCase() === 'start generation');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    button.click();
    return true;
  })()`).catch(() => false);
}

async function readFlowMediaDataThroughPageOnce(window, source, mediaType = "video") {
  if (typeof source !== "string" || !source) return null;
  const result = await executeFlowJavaScript(window, `(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(${JSON.stringify(source)}, { credentials: 'include', cache: 'no-store', signal: controller.signal });
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob.type.startsWith(${JSON.stringify(mediaType + "/")} ) || blob.size < 1024) return null;
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return { dataUrl, mimeType: blob.type.toLowerCase(), size: blob.size };
    } catch { return null; }
    finally { clearTimeout(timeout); }
  })()`).catch(() => null);
  const dataUrl = result?.dataUrl;
  const match = typeof dataUrl === "string" ? new RegExp(`^data:${mediaType}/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$`, "i").exec(dataUrl) : null;
  return match ? { buffer: Buffer.from(match[1], "base64"), mimeType: result.mimeType || `${mediaType}/octet-stream` } : null;
}

async function readFlowMediaDataThroughPage(window, source, mediaType = "video") {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await readFlowMediaDataThroughPageOnce(window, source, mediaType);
    if (result) return result;
    if (attempt < 7) await delay(2_000);
  }
  return null;
}

async function readFlowMediaBufferThroughPage(window, source, mediaType = "video") {
  const result = await readFlowMediaDataThroughPage(window, source, mediaType);
  return result?.buffer || null;
}

function detectFlowImageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer)) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buffer.length >= 6 && (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a")) return "image/gif";
  return "image/png";
}

function flowMediaOriginPath(value) {
  try {
    const url = new URL(String(value || ""));
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

async function continueFlowFetchRequest(connection, requestId) {
  try {
    await connection.sendCommand("Fetch.continueResponse", { requestId });
  } catch {
    try { await connection.sendCommand("Fetch.continueRequest", { requestId }); } catch { /* Response may already be released. */ }
  }
}

async function readFlowMediaBufferThroughCdp(window, source, mediaType = "video") {
  if (!window?.edgeRuntime || typeof source !== "string" || !source) return null;
  const connection = window.webContents?.debugger;
  const expectedPath = flowMediaOriginPath(source);
  if (!connection || typeof connection.sendCommand !== "function" || !expectedPath) return null;
  // Match the exact generated media URL. A broad host pattern can pause
  // unrelated Flow requests and, more importantly, miss the query-bearing
  // response after the page has cached the asset.
  const pattern = `${expectedPath}*`;
  let timer;
  let captured = false;
  let resolveCapture;
  let rejectCapture;
  const capturePromise = new Promise((resolve, reject) => { resolveCapture = resolve; rejectCapture = reject; });
  const onMessage = async (_event, method, params) => {
    if (method !== "Fetch.requestPaused" || captured) return;
    const requestId = params?.requestId;
    const pausedUrl = params?.request?.url || params?.responseHeaders?.url || "";
    if (!requestId) return;
    if (flowMediaOriginPath(pausedUrl) !== expectedPath) {
      await continueFlowFetchRequest(connection, requestId);
      return;
    }
    captured = true;
    try {
      const body = await connection.sendCommand("Fetch.getResponseBody", { requestId });
      const buffer = typeof body?.body === "string"
        ? (body.base64Encoded ? Buffer.from(body.body, "base64") : Buffer.from(body.body, "utf8"))
        : null;
      if (!buffer || buffer.length < 1024) throw new Error("FLOW_CDP_MEDIA_BODY_INVALID");
      resolveCapture(buffer);
    } catch (error) {
      rejectCapture(error);
    } finally {
      await continueFlowFetchRequest(connection, requestId);
    }
  };
  connection.on("message", onMessage);
  try {
    await connection.sendCommand("Network.enable").catch(() => {});
    await connection.sendCommand("Network.setCacheDisabled", { cacheDisabled: true }).catch(() => {});
    await connection.sendCommand("Fetch.enable", { patterns: [{ urlPattern: pattern, requestStage: "Response" }] });
    timer = setTimeout(() => rejectCapture(new Error("FLOW_CDP_MEDIA_CAPTURE_TIMEOUT")), 120_000);
    await connection.sendCommand("Page.reload", { ignoreCache: true });
    return await capturePromise;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    connection.off("message", onMessage);
    try { await connection.sendCommand("Fetch.disable"); } catch { /* CDP session may have closed after capture. */ }
    try { await connection.sendCommand("Network.setCacheDisabled", { cacheDisabled: false }); } catch { /* CDP session may have closed after capture. */ }
  }
}

async function getFlowVideoBuffer(window, result) {
  if (typeof result?.videoSource === "string" && result.videoSource && !result.videoSource.startsWith("blob:")) {
    if (window?.edgeRuntime) {
      const buffer = await readFlowMediaBufferThroughPage(window, result.videoSource, "video");
      if (buffer) return buffer;
      const cdpBuffer = await readFlowMediaBufferThroughCdp(window, result.videoSource, "video");
      if (cdpBuffer) return cdpBuffer;
      throw new Error("Google Flow không cho phép tải video vừa tạo qua Edge/CDP.");
    }
    const response = await window.webContents.session.fetch(result.videoSource);
    if (!response.ok) throw new Error("Google Flow không cho phép tải video vừa tạo.");
    return Buffer.from(await response.arrayBuffer());
  }
  if (result?.editorReady) {
    const editorVideoSource = await executeFlowJavaScript(window, "(() => performance.getEntriesByType('resource').map((entry) => entry.name).filter((source) => /flow-content\\.google\\/video\\//i.test(source)).pop() || null)()");
    if (typeof editorVideoSource === "string") {
      if (window?.edgeRuntime) {
        const buffer = await readFlowMediaBufferThroughPage(window, editorVideoSource, "video");
        if (buffer) return buffer;
        const cdpBuffer = await readFlowMediaBufferThroughCdp(window, editorVideoSource, "video");
        if (cdpBuffer) return cdpBuffer;
      }
      const response = await window.webContents.session.fetch(editorVideoSource);
      if (response.ok) return Buffer.from(await response.arrayBuffer());
    }
    return downloadFlowEditorVideo(window, result.downloadPoint);
  }
  const dataUrl = await executeFlowJavaScript(window, "(async () => { const video = [...document.querySelectorAll('video')].reverse().find((candidate) => (candidate.currentSrc || candidate.src || '').startsWith('blob:')); if (!video) return null; const response = await window.fetch(video.currentSrc || video.src); const blob = await response.blob(); return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); })()");
  const match = typeof dataUrl === "string" ? /^data:video\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl) : null;
  if (!match) throw new Error("Không tìm thấy dữ liệu video Google Flow để tải về app.");
  return Buffer.from(match[1], "base64");
}

async function waitForFlowVideoWithRecovery(window, projectUrl, beforeSources, beforeCardCount = 0, context = {}) {
  try {
    let state = await waitForFlowVideo(window, beforeSources, beforeCardCount, 600_000, context);
    if (state?.videoSource && !state?.failed) return state;
    await reloadFlowProject(window, projectUrl);
    state = await waitForFlowVideo(window, beforeSources, beforeCardCount, 30_000, context);
    if (state?.failed) {
      const retryPoint = await waitForFlowControlPoint(window, ["Thử lại", "Try again", "Retry"], true, 15_000);
      await dispatchBrowserClick(window, retryPoint);
      state = await waitForFlowVideo(window, beforeSources, beforeCardCount, 600_000, context);
      if (state?.videoSource && !state?.failed) return state;
      if (state?.videoSource && state?.failed) throw new Error("Google Flow vẫn báo tạo video không thành công sau khi gửi tạo lại.");
      throw new Error("Google Flow vẫn không tạo được video sau khi gửi tạo lại.");
    }
    if (state?.videoSource) return state;
    if (!state?.failed) throw new Error("Google Flow không trả về video sau khi tải lại trang.");
    throw new Error("Google Flow vẫn báo tạo video không thành công sau khi tải lại và gửi tạo lại.");
  } catch (error) {
    if (isNonRetryableFlowProviderBlock(error) && context.allowProviderReloadRecovery === true) {
      const recoveryAttempt = Number.isInteger(context.providerRecoveryAttempt) ? context.providerRecoveryAttempt : 0;
      if (recoveryAttempt < MAX_FLOW_PROVIDER_RELOAD_RECOVERY && typeof context.resendAfterReload === "function") {
        recordBrowserAction({
          action: "flow-provider-block-reload-recovery",
          success: false,
          recoveryAttempt: recoveryAttempt + 1,
          recoveryBudget: MAX_FLOW_PROVIDER_RELOAD_RECOVERY,
          projectUrl: redactNetworkUrl(projectUrl),
          code: error.code,
        });
        await reloadFlowProject(window, projectUrl, FLOW_PROVIDER_RELOAD_SETTLE_MS);
        const prepared = await context.resendAfterReload(window, recoveryAttempt + 1);
        const retryContext = {
          ...context,
          providerRecoveryAttempt: recoveryAttempt + 1,
          allowProviderReloadRecovery: true,
          providerDetectionNotBefore: Date.now() + FLOW_PROVIDER_RELOAD_SETTLE_MS,
        };
        try {
          const state = await waitForFlowVideo(window, prepared?.beforeSources || [], prepared?.beforeCardCount || 0, 600_000, retryContext);
          if (state?.videoSource && !state?.failed) return state;
          if (state?.unusualActivity) {
            throw createFlowGenerationFailure("FLOW_PROVIDER_UNUSUAL_ACTIVITY", "Google Flow tạm chặn tạo video vì phát hiện hoạt động bất thường.", {
              stage: context.stage || "STAGE_4_VIDEO_GENERATION",
              sceneId: context.sceneId || null,
              flowProjectUrl: redactNetworkUrl(projectUrl),
              providerBlockedAt: new Date().toISOString(),
              autoRetryAllowed: false,
              generateTriggered: context.generateTriggered !== false,
              generationStarted: false,
              providerJobCreated: false,
              recoveryAttempt: recoveryAttempt + 1,
              recoveryBudget: MAX_FLOW_PROVIDER_RELOAD_RECOVERY,
              firstDivergence: "FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK",
            });
          }
          if (state?.failed) throw new Error("Google Flow vẫn báo tạo video không thành công sau khi tải lại và gửi lại.");
          throw new Error("Google Flow không trả về video sau khi tải lại và gửi lại.");
        } catch (retryError) {
          // Keep the provider's structured failure if the bounded resend is
          // blocked again; never downgrade it to a generic video error.
          if (isNonRetryableFlowProviderBlock(retryError)) throw retryError;
          throw retryError;
        }
      }
    }
    throw error;
  }
}

function normalizeFlowPromptText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function setFlowPrompt(window, prompt) {
  const prepared = await executeFlowJavaScript(window, `(() => {
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      }
    }
    const visible = (element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 100 && bounds.height >= 20 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]).find(visible);
    if (!input) return { error: 'FLOW_PROMPT_INPUT_NOT_FOUND' };
    input.focus();
    if (input.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(input, '');
    } else {
      document.execCommand('selectAll', false);
      document.execCommand('delete', false);
    }
    input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'deleteContentBackward' }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { tagName: input.tagName, contentEditable: input.getAttribute('contenteditable') === 'true' };
  })()`);
  if (prepared?.error) throw new Error(prepared.error);

  if (prepared?.contentEditable && window?.edgeRuntime) {
    await window.webContents.debugger.sendCommand("Input.insertText", { text: prompt });
  } else {
    await executeFlowJavaScript(window, `(() => {
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const visible = (element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return bounds.width > 100 && bounds.height >= 20 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]).find(visible);
      if (!input) return false;
      input.focus();
      if (input.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(input, ${JSON.stringify(prompt)});
      } else {
        document.execCommand('insertText', false, ${JSON.stringify(prompt)});
      }
      input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(prompt)} }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(prompt)} }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  await flowHumanPause("prompt");
  const state = await executeFlowJavaScript(window, `(() => {
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      }
    }
    const visible = (element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width > 100 && bounds.height >= 20 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]).find(visible);
    const button = roots.flatMap((root) => [...root.querySelectorAll('button, [role="button"]')]).find((element) => visible(element) && String(element.getAttribute('aria-label') || '').toLowerCase() === 'start generation');
    return {
      text: input?.tagName === 'TEXTAREA' ? input.value : (input?.innerText || input?.textContent || ''),
      sendDisabled: Boolean(button?.disabled || button?.getAttribute('aria-disabled') === 'true'),
    };
  })()`);
  const observed = normalizeFlowPromptText(state?.text);
  const expected = normalizeFlowPromptText(prompt);
  if (observed !== expected) {
    recordBrowserAction({ action: "flow-prompt-input", success: false, inputMethod: prepared?.contentEditable && window?.edgeRuntime ? "EDGE_CDP_INPUT_INSERT_TEXT" : "DOM_INPUT", expectedLength: prompt.length, observedLength: String(state?.text || "").length, sendDisabled: Boolean(state?.sendDisabled) });
    throw new Error("FLOW_PROMPT_INPUT_NOT_ACCEPTED");
  }
  if (state?.sendDisabled) {
    recordBrowserAction({ action: "flow-prompt-input", success: false, inputMethod: prepared?.contentEditable && window?.edgeRuntime ? "EDGE_CDP_INPUT_INSERT_TEXT" : "DOM_INPUT", expectedLength: prompt.length, observedLength: observed.length, sendDisabled: true });
    throw new Error("FLOW_GENERATE_CONTROL_DISABLED_AFTER_PROMPT");
  }
  recordBrowserAction({ action: "flow-prompt-input", success: true, inputMethod: prepared?.contentEditable && window?.edgeRuntime ? "EDGE_CDP_INPUT_INSERT_TEXT" : "DOM_INPUT", expectedLength: prompt.length, observedLength: observed.length, sendDisabled: false });
  return state;
}

async function downloadFlowEditorVideo(window, downloadPoint) {
  if (window?.edgeRuntime) {
    const point = downloadPoint || await waitForFlowControlPoint(window, ["Download media", "Tải xuống"], true, 15_000);
    await dispatchBrowserClick(window, point);
    for (let elapsed = 0; elapsed < 120_000; elapsed += 1_000) {
      const source = await executeFlowJavaScript(window, "(() => { const video = [...document.querySelectorAll('video')].reverse().find((candidate) => candidate.currentSrc || candidate.src); return video?.currentSrc || video?.src || performance.getEntriesByType('resource').map((entry) => entry.name).filter((item) => /flow-content\\.google\\/video\\//i.test(item)).pop() || null; })()").catch(() => null);
      const buffer = await readFlowMediaBufferThroughPage(window, source, "video");
      if (buffer) return buffer;
      await delay(1_000);
    }
    throw new Error("Google Flow không tải được video từ màn hình editor qua Edge/CDP.");
  }
  const downloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "modeling-flow-video-"));
  let downloadedPath = null;
  let cleanup = () => {};
  const downloadPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Google Flow không tải được video từ màn hình editor.")); }, 120_000);
    const onDownload = (_event, item) => {
      const filename = item.getFilename?.() || "flow-video.mp4";
      const target = path.join(downloadRoot, filename.toLowerCase().endsWith(".mp4") ? filename : "flow-video.mp4");
      downloadedPath = target;
      item.setSavePath(target);
      item.once("done", (_doneEvent, state) => {
        cleanup();
        if (state !== "completed") reject(new Error("Google Flow tải video thất bại ở màn hình editor."));
        else resolve(target);
      });
    };
    cleanup = () => { clearTimeout(timeout); window.webContents.session.removeListener("will-download", onDownload); };
    window.webContents.session.on("will-download", onDownload);
  });
  try {
    const point = downloadPoint || await waitForFlowControlPoint(window, ["Download media", "Tải xuống"], true, 15_000);
    await dispatchBrowserClick(window, point);
    const filePath = await downloadPromise;
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 1024) throw new Error("Google Flow tải về video editor không hợp lệ.");
    return buffer;
  } finally {
    fs.rmSync(downloadRoot, { recursive: true, force: true });
  }
}

async function inspectFlowImage(window, beforeSources = []) {
  const expression = [
    "(() => {",
    "  const before = new Set(" + JSON.stringify(beforeSources) + ");",
    "  const roots = [document]; const seen = new Set(roots);",
    "  for (let index = 0; index < roots.length; index += 1) { for (const element of roots[index].querySelectorAll('*')) { if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); } } }",
    "  const images = roots.flatMap((root) => [...root.querySelectorAll('img')]).filter((image) => { const bounds = image.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0; });",
    "  const sourceFor = (image) => image.currentSrc || image.src || image.querySelector('source')?.src || '';",
    "  const referenceSources = new Set(images.filter((candidate) => candidate.closest('flow-base-prompt-box, flow-ingredient-bar, .frame-trigger')).map(sourceFor).filter(Boolean));",
    "  const isReferenceImage = (candidate) => referenceSources.has(sourceFor(candidate)) || Boolean(candidate.closest('flow-base-prompt-box, flow-ingredient-bar, .frame-trigger'));",
    "  const image = images.reverse().find((candidate) => { const source = sourceFor(candidate); return source && !before.has(source) && !isReferenceImage(candidate) && candidate.complete && (candidate.naturalWidth || candidate.width) >= 128 && (candidate.naturalHeight || candidate.height) >= 128 && /(?:flow-content\\.google\\/image\\/|flow\\.google\\.com\\/asb\\/)/i.test(source); });",
    "  const text = document.body?.innerText || '';",
    "  const cleanSource = (value) => String(value || '').split('?')[0];",
    "  const mediaIdFromSource = (value) => { const source = cleanSource(value); const marker = '/image/'; const index = source.indexOf(marker); return index >= 0 ? source.slice(index + marker.length).split('/')[0] : null; };",
    "  const mediaId = image?.getAttribute('data-media-id') || image?.closest('flow-grid-tile-container')?.querySelector('img[data-media-id]')?.getAttribute('data-media-id') || mediaIdFromSource(image ? sourceFor(image) : '') || images.find((candidate) => candidate.getAttribute('data-media-id') && cleanSource(sourceFor(candidate)) === cleanSource(image ? sourceFor(image) : ''))?.getAttribute('data-media-id') || null;",
    "  return { imageSource: image ? sourceFor(image) : null, mediaId, failed: /không thành công|không tải được ảnh|failed|couldn't load image|could not load image|generation failed/i.test(text) };",
    "})()",
  ].join("\n");
  return executeFlowJavaScript(window, expression);
}

async function waitForFlowImage(window, beforeSources, timeout = 600_000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 2_000) {
    const state = await inspectFlowImage(window, beforeSources);
    if (state?.imageSource) return state;
    if (state?.failed) return state;
    await delay(2_000);
  }
  return { failed: false, timedOut: true };
}

async function getFlowImageBuffer(window, result) {
  if (typeof result?.imageSource === "string" && result.imageSource && !result.imageSource.startsWith("blob:")) {
    if (window?.edgeRuntime) {
      // flow-content.google image URLs are intentionally not CORS-readable
      // from the page context. Capture the authenticated response through
      // the managed Edge CDP session first, before waiting on the URL to be
      // promoted to a different tile source.
      const liveCdpSources = [...new Set([...(await listFlowImageSources(window)), result.imageSource])];
      for (const liveSource of liveCdpSources) {
        const directCdpBuffer = await readFlowMediaBufferThroughCdp(window, liveSource, "image");
        if (directCdpBuffer) {
          recordBrowserAction({ action: "flow-image-direct-cdp-success", source: redactNetworkUrl(liveSource), mimeType: detectFlowImageMimeType(directCdpBuffer), byteLength: directCdpBuffer.length });
          return { buffer: directCdpBuffer, mimeType: detectFlowImageMimeType(directCdpBuffer) };
        }
      }
      const pageMedia = await readFlowImageDataFromCandidates(window, result.imageSource);
      if (pageMedia) {
        return pageMedia;
      }
      // Managed Edge owns the authenticated Flow page, so the Electron
      // session may not be able to read the image through page-context fetch.
      // Reuse the response-body CDP bridge already used for Flow video before
      // failing closed; never substitute a screenshot or an unvalidated blob.
      const cdpSources = [...new Set([...(await listFlowImageSources(window)), result.imageSource])];
      recordBrowserAction({ action: "flow-image-cdp-candidates", count: cdpSources.length, sources: cdpSources.map((source) => redactNetworkUrl(source)) });
      for (const candidateSource of cdpSources) {
        const cdpBuffer = await readFlowMediaBufferThroughCdp(window, candidateSource, "image");
        if (cdpBuffer) return { buffer: cdpBuffer, mimeType: detectFlowImageMimeType(cdpBuffer) };
      }
      // The exact-source CDP reload can cause Flow to replace its temporary
      // flow-content URL with the final asb tile source. Re-observe the live
      // DOM after that reload before failing closed.
      const postReloadPageMedia = await readFlowImageDataFromCandidates(window, result.imageSource, 45_000);
      if (postReloadPageMedia) {
        recordBrowserAction({ action: "flow-image-post-cdp-page-fetch-success", mimeType: postReloadPageMedia.mimeType, byteLength: postReloadPageMedia.buffer.length });
        return postReloadPageMedia;
      }
      throw new Error("Google Flow không cho phép tải ảnh vừa tạo qua Edge/CDP.");
    }
    try {
      const response = await window.webContents.session.fetch(result.imageSource, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("Google Flow không cho phép tải ảnh vừa tạo.");
      const mimeType = (response.headers.get("content-type") || "image/png").split(";")[0].toLowerCase();
      if (!mimeType.startsWith("image/")) throw new Error("Google Flow không trả về tệp ảnh hợp lệ.");
      return { buffer: Buffer.from(await response.arrayBuffer()), mimeType };
    } catch {
      const dataUrl = await executeFlowJavaScript(window, `(async () => {
        const response = await fetch(${JSON.stringify(result.imageSource)});
        if (!response.ok) return null;
        const blob = await response.blob();
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      })()`);
      const match = typeof dataUrl === "string" ? /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl) : null;
      if (!match) throw new Error("Google Flow không cho phép tải ảnh vừa tạo.");
      return { buffer: Buffer.from(match[2], "base64"), mimeType: match[1].toLowerCase() };
    }
  }
  const dataUrl = await executeFlowJavaScript(window, "(async () => { const image = [...document.querySelectorAll('img')].reverse().find((candidate) => (candidate.currentSrc || candidate.src || '').startsWith('blob:')); if (!image) return null; const response = await window.fetch(image.currentSrc || image.src); const blob = await response.blob(); return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); })()");
  const match = typeof dataUrl === "string" ? /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl) : null;
  if (!match) throw new Error("Không tìm thấy dữ liệu ảnh Google Flow để tải về app.");
  return { buffer: Buffer.from(match[2], "base64"), mimeType: match[1].toLowerCase() };
}

async function waitForFlowImageWithRecovery(window, projectUrl, beforeSources) {
  let state = await waitForFlowImage(window, beforeSources);
  if (state?.imageSource && !state?.failed) return state;
  await reloadFlowProject(window, projectUrl);
  state = await waitForFlowImage(window, beforeSources, 30_000);
  if (state?.failed) {
    const retryPoint = await waitForFlowControlPoint(window, ["Thử lại", "Try again", "Retry"], true, 15_000);
    await dispatchBrowserClick(window, retryPoint);
    state = await waitForFlowImage(window, beforeSources);
    if (state?.imageSource && !state?.failed) return state;
    if (state?.imageSource && state?.failed) throw new Error("Google Flow vẫn báo tạo ảnh không thành công sau khi gửi tạo lại.");
    throw new Error("Google Flow vẫn không tạo được ảnh sau khi gửi tạo lại.");
  }
  if (state?.imageSource) return state;
  if (!state?.failed) throw new Error("Google Flow không trả về ảnh sau khi tải lại trang.");
  throw new Error("Google Flow vẫn báo tạo ảnh không thành công sau khi tải lại và gửi tạo lại.");
}

async function listFlowImageSources(window) {
  const sources = await executeFlowJavaScript(window, `(() => {
    const roots = [document]; const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
    return [...new Set(roots.flatMap((root) => [...root.querySelectorAll('img')]).map((image) => image.currentSrc || image.src || image.querySelector('source')?.src || '').filter((source) => source.startsWith("https://flow-content.google/image/") || source.startsWith("https://flow.google.com/asb/")))];
  })()`).catch(() => []);
  return Array.isArray(sources) ? sources.filter((source) => typeof source === "string" && source) : [];
}

async function readFlowImageDataFromCandidates(window, initialSource, timeoutMs = 120_000) {
  const candidates = new Set();
  const lastAttemptAt = new Map();
  const startedAt = Date.now();
  let lastLoggedSources = "";
  while (Date.now() - startedAt < timeoutMs) {
    const observedSources = await listFlowImageSources(window);
    for (const source of [initialSource, ...observedSources]) {
      if (typeof source === "string" && source && !source.startsWith("blob:")) candidates.add(source);
    }
    const sources = [...candidates];
    const sourceKey = sources.join("|");
    if (sourceKey !== lastLoggedSources) {
      lastLoggedSources = sourceKey;
      recordBrowserAction({ action: "flow-image-download-candidates", count: sources.length, sources: sources.map((source) => redactNetworkUrl(source)) });
    }
    for (const candidateSource of sources) {
      const lastAttempt = lastAttemptAt.get(candidateSource) || 0;
      if (Date.now() - lastAttempt < 8_000) continue;
      lastAttemptAt.set(candidateSource, Date.now());
      const pageMedia = await readFlowMediaDataThroughPageOnce(window, candidateSource, "image");
      if (pageMedia) {
        recordBrowserAction({ action: "flow-image-page-fetch-success", source: redactNetworkUrl(candidateSource), mimeType: pageMedia.mimeType, byteLength: pageMedia.buffer.length });
        return pageMedia;
      }
    }
    await delay(2_000);
  }
  return null;
}

async function captureGeminiImage(window, rect, source = null) {
  if (typeof source === "string" && source) {
    const adjustedRect = await window.webContents.executeJavaScript(`(() => {
      const expected = ${JSON.stringify(source)};
      const image = [...document.querySelectorAll('img')].find((candidate) => (candidate.currentSrc || candidate.src || '') === expected);
      if (!image) return null;
      image.scrollIntoView({ block: 'center', inline: 'center' });
      const bounds = image.getBoundingClientRect();
      return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
    })()`, true).catch(() => null);
    if (adjustedRect) rect = adjustedRect;
  }
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    throw new Error("Không xác định được vùng ảnh Gemini vừa tạo.");
  }
  const image = await window.webContents.capturePage({
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.max(1, Math.floor(rect.width)),
    height: Math.max(1, Math.floor(rect.height)),
  });
  const png = image.toPNG();
  if (png.length < 1024) throw new Error("Không thể chụp ảnh Gemini vừa tạo.");
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function readGeminiImageElementDataUrl(window, source) {
  if (typeof source !== "string" || !source.startsWith("blob:")) return null;
  return window.webContents.executeJavaScript(`(() => {
    const expected = ${JSON.stringify(source)};
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
    const image = roots.flatMap((root) => [...root.querySelectorAll('img')]).find((candidate) => (candidate.currentSrc || candidate.src || '') === expected);
    if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(image, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      return dataUrl.startsWith('data:image/png;base64,') && dataUrl.length >= 1024 ? dataUrl : null;
    } catch { return null; }
  })()`, true).catch(() => null);
}

async function getGeminiImageDataUrl(window, source, captureRect) {
  if (typeof source !== "string" || !source) throw new Error("Không tìm thấy nguồn ảnh Gemini.");
  const rawSource = source;
  source = normalizeGeminiImageSource(source);
  if (source.startsWith("data:image/")) return source;
  if (source.startsWith("blob:")) {
    const elementDataUrl = await readGeminiImageElementDataUrl(window, source);
    if (typeof elementDataUrl === "string" && elementDataUrl.startsWith("data:image/")) return elementDataUrl;
    const blobDataUrl = await window.webContents.executeJavaScript(`(async () => {
      try {
        const response = await fetch(${JSON.stringify(source)});
        if (!response.ok) return null;
        const blob = await response.blob();
        if (!blob.type.startsWith('image/') || blob.size < 1024) return null;
        return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
      } catch { return null; }
    })()`, true).catch(() => null);
    if (typeof blobDataUrl === "string" && blobDataUrl.startsWith("data:image/")) return blobDataUrl;
    throw new Error("Không thể đọc bitmap blob Gemini; không lưu ảnh chụp giao diện.");
  }
  try {
    const response = await window.webContents.session.fetch(source, { redirect: "follow" });
    recordBrowserAction({ action: "gemini-image-source-fetch", rawSource: redactNetworkUrl(rawSource), source: redactNetworkUrl(source), status: response.status, contentType: response.headers.get("content-type") || null, redirected: response.url !== source });
    if (!response.ok) throw new Error("Gemini chặn tải trực tiếp ảnh.");
    const mimeType = (response.headers.get("content-type") || "image/png").split(";")[0].toLowerCase();
    if (!mimeType.startsWith("image/")) throw new Error("Gemini không trả về tệp ảnh hợp lệ.");
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    recordBrowserAction({ action: "gemini-image-source-fetch-failed", rawSource: redactNetworkUrl(rawSource), source: redactNetworkUrl(source), reason: error instanceof Error ? error.message : String(error) });
    return captureGeminiImage(window, captureRect, source);
  }
}

async function waitForGeminiImageResult(window, beforeSources, beforeCanvasCount) {
  const before = JSON.stringify(beforeSources);
  const snapshotExpression = `(async () => {
    const roots = [document]; const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
    const allImages = () => roots.flatMap((root) => [...root.querySelectorAll('img')]);
    const allCanvases = () => roots.flatMap((root) => [...root.querySelectorAll('canvas')]);
    const before = new Set(${before});
    const isUsableImageSource = (source) => /^blob:|^data:image\\//i.test(source) || /^https:\\/\\/lh\\d+\\.googleusercontent\\.com\\//i.test(source);
    const candidate = allImages().filter((image) => {
      const source = image.currentSrc || image.src;
      const className = String(image.className || '').toLowerCase();
      const alt = String(image.alt || '').toLowerCase();
      return source && isUsableImageSource(source) && !before.has(source) && !className.includes('preview') && !className.includes('sparkle') && !alt.includes('bản xem trước') && image.complete && (image.naturalWidth || image.width) >= 256 && (image.naturalHeight || image.height) >= 256;
    }).at(-1);
    if (candidate) {
      const bounds = candidate.getBoundingClientRect();
      const source = candidate.currentSrc || candidate.src;
      if (source.startsWith('blob:')) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = candidate.naturalWidth || candidate.width;
          canvas.height = candidate.naturalHeight || candidate.height;
          const context = canvas.getContext('2d');
          if (context && canvas.width >= 256 && canvas.height >= 256) {
            context.drawImage(candidate, 0, 0);
            const dataUrl = canvas.toDataURL('image/png');
            if (dataUrl.startsWith('data:image/png;base64,') && dataUrl.length >= 1024) return { kind: 'dataUrl', dataUrl };
          }
        } catch { /* Try the dedicated renderer-side extraction on the next step. */ }
      }
      return { kind: 'image', source, captureRect: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }, naturalWidth: candidate.naturalWidth || candidate.width || 0, naturalHeight: candidate.naturalHeight || candidate.height || 0 };
    }
    const canvas = allCanvases().slice(${Number(beforeCanvasCount) || 0}).find((item) => item.width >= 128 && item.height >= 128);
    if (canvas) { try { return { kind: 'dataUrl', dataUrl: canvas.toDataURL('image/png') }; } catch { return { kind: 'error', error: 'Không thể đọc ảnh Gemini vừa tạo.' }; } }
    return null;
  })()`;
  const readSourceExpression = (source) => `(async () => {
    try {
      const response = await fetch(${JSON.stringify(source)}, { credentials: 'include' });
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob.type.startsWith('image/') || blob.size < 1024) return null;
      return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    } catch { return null; }
  })()`;
  for (let elapsed = 0; elapsed < 180_000; elapsed += 1_500) {
    try {
      const snapshot = await window.webContents.executeJavaScript(snapshotExpression, true);
      if (snapshot?.kind === 'dataUrl') return { dataUrl: snapshot.dataUrl };
      if (snapshot?.kind === 'error') return { error: snapshot.error };
    if (snapshot?.kind === 'image') {
        const elementDataUrl = await readGeminiImageElementDataUrl(window, snapshot.source);
        if (typeof elementDataUrl === 'string' && elementDataUrl.startsWith('data:image/')) return { dataUrl: elementDataUrl };
        const dataUrl = await window.webContents.executeJavaScript(readSourceExpression(snapshot.source), true).catch(() => null);
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) return { dataUrl };
        if (snapshot.source.startsWith('blob:')) return { error: 'Không thể đọc bitmap blob Gemini; không lưu ảnh chụp giao diện.' };
        if (!snapshot.source.startsWith('blob:')) return { imageSource: snapshot.source, captureRect: snapshot.captureRect };
      }
    } catch (error) {
      recordBrowserAction({ action: 'gemini-image-poll-error', reason: error instanceof Error ? error.message : String(error) });
    }
    await delay(1_500);
  }
  return { error: 'Gemini không tạo ảnh trong thời gian chờ 180 giây.' };
}

ipcMain.handle("gemini-browser:run-job", async (event, value) => {
  return withGeminiBrowserOperation(async () => {
  const projectId = value?.projectId;
  const slots = value?.slots;
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId) || !Array.isArray(slots) || slots.length === 0) {
    throw new Error("Yêu cầu tạo ảnh không hợp lệ.");
  }
  const channelId = await findProjectChannelId(projectId);
  const characterReferencePath = channelId ? findChannelMainCharacterImagePath(channelId) : null;
  const characterReferenceCrop = characterReferencePath && channelId ? await createGeminiIdentityReferenceCrop(characterReferencePath, channelId) : null;
  if (slots.some((slot) => slot?.kind === "scene") && !characterReferenceCrop) throw new Error("MAIN_CHARACTER_IDENTITY_MISSING: Cảnh Gemini Image yêu cầu Character Identity Pack reference.");
  const window = await createGeminiWindow();
  const geminiRunId = value?.runId || null;
  const imageCommandId = crypto.randomUUID();
  let primaryError = null;
  try {
  await preflightGeminiForRun(window, geminiRunId, "IMAGE");
  const images = {};
  for (let index = 0; index < slots.length; index += 1) {
    if (index > 0) {
      sendProgress(event, "gemini-browser:progress", { processed: index, total: slots.length, label: "Đang tải lại Gemini trước khi dán ảnh tiếp theo..." });
      await reloadGeminiBeforeNextPrompt(window);
    }
    const slot = slots[index];
    if (!slot || !["character", "background", "scene"].includes(slot.kind) || typeof slot.prompt !== "string") throw new Error("Prompt ảnh không hợp lệ.");
    if (slot.kind === "scene") await attachGeminiCharacterReference(window, characterReferenceCrop);
    await selectGeminiImageGenerationTool(window);
    sendProgress(event, "gemini-browser:progress", { processed: index, total: slots.length, label: slot.label ?? `Ảnh ${index + 1}` });
    const prepareScript = `(() => {
      const prompt = ${JSON.stringify(slot.prompt)};
      const collectRoots = () => {
        const roots = [document];
        const seen = new Set(roots);
        for (let index = 0; index < roots.length; index += 1) {
          for (const element of roots[index].querySelectorAll("*")) {
            if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
          }
        }
        return roots;
      };
      const allImages = () => collectRoots().flatMap((root) => [...root.querySelectorAll("img")]);
      const allCanvases = () => collectRoots().flatMap((root) => [...root.querySelectorAll("canvas")]);
      const before = new Set(allImages().map((image) => image.currentSrc || image.src).filter(Boolean));
      const beforeCanvases = new Set(allCanvases());
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 100 && bounds.height >= 20 && style.visibility !== "hidden" && style.display !== "none"; };
      const input = collectRoots().flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]).filter(visible).at(-1);
      if (!input) return { error: "Không tìm thấy ô nhập prompt Gemini." };
      input.focus();
      if (input.tagName === "TEXTAREA") {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(input, prompt);
      } else {
        document.execCommand("selectAll", false);
        document.execCommand("insertText", false, prompt);
      }
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
      input.focus();
      return { beforeSources: [...before], beforeCanvasCount: beforeCanvases.size, promptPrefix: prompt.slice(0, 48) };
    })()`;
    const prepared = await window.webContents.executeJavaScript(prepareScript, true);
    if (!prepared || prepared.error) throw new Error(prepared?.error ?? "Không thể chuẩn bị prompt Gemini.");
    await new Promise((resolve) => setTimeout(resolve, 350));
    safeSendInputEvent(window, { type: "keyDown", keyCode: "ENTER" });
    safeSendInputEvent(window, { type: "keyUp", keyCode: "ENTER" });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const sendScript = `(() => {
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll("*")) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const input = document.querySelector('textarea, [contenteditable="true"]');
      if (!input) return { error: "Không tìm thấy ô nhập prompt Gemini." };
      const inputText = input.tagName === "TEXTAREA" ? input.value : (input.innerText || input.textContent || "");
      if (!inputText.includes(${JSON.stringify(prepared.promptPrefix)})) return { sent: true };
      input.focus();
      const inputBounds = input.getBoundingClientRect();
      const candidates = roots.flatMap((root) => [...root.querySelectorAll('button, [role="button"]')]).filter((element) => {
        const label = ((element.getAttribute("aria-label") || "") + " " + (element.getAttribute("title") || "") + " " + (element.textContent || "")).toLowerCase();
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return !element.disabled && bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" && style.display !== "none" && (label.includes("send") || label.includes("gửi") || label.includes("submit"));
      });
      const send = candidates.sort((left, right) => {
        const leftBounds = left.getBoundingClientRect();
        const rightBounds = right.getBoundingClientRect();
        return Math.hypot(leftBounds.left - inputBounds.right, leftBounds.top - inputBounds.bottom) - Math.hypot(rightBounds.left - inputBounds.right, rightBounds.top - inputBounds.bottom);
      })[0];
      if (!send) return { sent: false };
      const bounds = send.getBoundingClientRect();
      return { sent: true, clickPoint: { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } };
    })()`;
    const sendResult = await window.webContents.executeJavaScript(sendScript, true);
    if (sendResult?.error) throw new Error(sendResult.error);
    if (!sendResult?.sent) {
      throw new Error("Gemini chưa nhận được prompt. Hãy kiểm tra cửa sổ Gemini đang mở và thử lại.");
    }
    if (sendResult.clickPoint) {
      await dispatchBrowserClick(window, sendResult.clickPoint);
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
    const deliveryCheck = await window.webContents.executeJavaScript(`(() => {
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll("*")) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 100 && bounds.height >= 20 && style.visibility !== "hidden" && style.display !== "none"; };
      const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]).filter(visible).at(-1);
      return input ? (input.tagName === "TEXTAREA" ? input.value : (input.innerText || input.textContent || "")) : "";
    })()`, true);
    if (deliveryCheck.includes(prepared.promptPrefix)) {
      window.webContents.focus();
      safeSendInputEvent(window, { type: "keyDown", keyCode: "ENTER" });
      safeSendInputEvent(window, { type: "keyUp", keyCode: "ENTER" });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const retryCheck = await window.webContents.executeJavaScript(`(() => {
        const roots = [document];
        const seen = new Set(roots);
        for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll("*")) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 100 && bounds.height >= 20 && style.visibility !== "hidden" && style.display !== "none"; };
        const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]).filter(visible).at(-1);
        return input ? (input.tagName === "TEXTAREA" ? input.value : (input.innerText || input.textContent || "")) : "";
      })()`, true);
      if (retryCheck.includes(prepared.promptPrefix)) throw new Error("Gemini không nhận thao tác gửi tự động. App đã thử cả chuột trình duyệt và phím Enter.");
    }
    const script = `(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const collectRoots = () => {
        const roots = [document];
        const seen = new Set(roots);
        for (let index = 0; index < roots.length; index += 1) {
          for (const element of roots[index].querySelectorAll("*")) {
            if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
          }
        }
        return roots;
      };
      const allImages = () => collectRoots().flatMap((root) => [...root.querySelectorAll("img")]);
      const allCanvases = () => collectRoots().flatMap((root) => [...root.querySelectorAll("canvas")]);
      const before = new Set(${JSON.stringify(prepared.beforeSources)});
      const beforeCanvasCount = ${prepared.beforeCanvasCount};
      for (let elapsed = 0; elapsed < 180000; elapsed += 1500) {
        await sleep(1500);
      const candidates = allImages().filter((image) => {
        const source = image.currentSrc || image.src;
          const className = String(image.className || '').toLowerCase();
          const alt = String(image.alt || '').toLowerCase();
          return source && !before.has(source) && !className.includes('preview') && !className.includes('sparkle') && !alt.includes('bản xem trước') && image.complete && (image.naturalWidth || image.width) >= 256 && (image.naturalHeight || image.height) >= 256;
        });
        const image = candidates[candidates.length - 1];
        if (image) {
          const bounds = image.getBoundingClientRect();
          const captureRect = { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
          let source = image.currentSrc || image.src;
          if (/^https:\/\/gemini\.google\.comhttps?:\/\//i.test(source)) source = source.replace(/^https:\/\/gemini\.google\.com/i, "");
          try { console.info("[GEMINI_IMAGE_CANDIDATE]", JSON.stringify({ tag: image.tagName.toLowerCase(), className: String(image.className || '').slice(0, 160), alt: image.alt || null, sourceKind: source.split(':', 1)[0] || null, sourceOriginPath: (() => { try { const parsed = new URL(source); return parsed.origin + parsed.pathname; } catch { return null; } })(), naturalWidth: image.naturalWidth || 0, naturalHeight: image.naturalHeight || 0, rect: captureRect })); } catch { /* Diagnostic only. */ }
          try {
            const response = await fetch(source, { credentials: "include" });
            if (response.ok) {
              const blob = await response.blob();
              if (blob.type.startsWith("image/") && blob.size >= 1024) {
                const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
                return { dataUrl };
              }
            }
          } catch { /* Try the authenticated Electron session/fallback capture below. */ }
          return { imageSource: source, captureRect };
        }
        const canvases = allCanvases();
        const canvas = canvases.slice(beforeCanvasCount).find((item) => item.width >= 128 && item.height >= 128);
        if (canvas) {
          try { return { dataUrl: canvas.toDataURL("image/png") }; } catch { return { error: "Không thể đọc ảnh Gemini vừa tạo." }; }
        }
      }
      return { error: "Gemini không tạo ảnh trong thời gian chờ 180 giây." };
    })()`;
    const result = await waitForGeminiImageResult(window, prepared.beforeSources, prepared.beforeCanvasCount);
    if (!result?.dataUrl && !result?.imageSource) throw new Error(result?.error ?? "Không thể tạo ảnh trên Gemini Ultra.");
    const dataUrl = result.dataUrl ?? await getGeminiImageDataUrl(window, result.imageSource, result.captureRect);
    const url = saveGeminiImage(projectId, slot, dataUrl);
    images[`${slot.kind}-${Number.isInteger(slot.sceneNumber) ? slot.sceneNumber : 0}`] = `${url}&v=${Date.now()}`;
    sendProgress(event, "gemini-browser:progress", { processed: index + 1, total: slots.length, label: slot.label ?? `Ảnh ${index + 1}` });
  }
  return { status: "completed", images };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      if (geminiRunId) await persistGeminiConversationAfterStep(window, { snapshot: () => ({ commandId: imageCommandId }) }, geminiRunId, "IMAGE");
    } catch (finalizerError) {
      recordBrowserAction({ action: "gemini-conversation-finalizer-error", commandId: imageCommandId, primaryError: primaryError instanceof Error ? primaryError.message : null, finalizerError: finalizerError instanceof Error ? finalizerError.message : String(finalizerError) });
      if (!primaryError) throw finalizerError;
    } finally {
      if (geminiRunId) await closeGeminiAfterStep(window);
    }
  }
  });
});

function assertFlowPromptContract(prompt, context) {
  const forbiddenLegacyRules = /beige oval body|white shorts with red hearts|do not add a shirt|remove his shorts/i;
  if (forbiddenLegacyRules.test(prompt)) {
    throw new Error(`PROMPT_CONTRACT_FAILED: ${context} còn chứa quy tắc trang phục cứng trái với Scene Appearance State.`);
  }
  const hasIdentityBlock = /character identity(?: invariants)?\s*:/i.test(prompt);
  const hasAppearanceBlock = /scene appearance(?: state)?\b(?:\s*\([^)]*\))?\s*(?::|\bis\b)/i.test(prompt);
  if (hasIdentityBlock && !hasAppearanceBlock) {
    throw new Error(`PROMPT_CONTRACT_FAILED: ${context} có Character Identity nhưng thiếu Scene Appearance State.`);
  }
}

async function validatedPromptForSend(slot, context, metadata) {
  if (!slot || typeof slot.promptId !== "string" || typeof slot.validatedPrompt !== "string" || !slot.validatedPrompt.trim() || typeof slot.validatedPromptHash !== "string") throw new Error(`PROMPT_FIDELITY_GATE_REQUIRED: ${context} chưa có validated prompt trace.`);
  const actualHash = crypto.createHash("sha256").update(slot.validatedPrompt, "utf8").digest("hex");
  if (actualHash !== slot.validatedPromptHash) throw new Error(`PROMPT_MUTATED_AFTER_VALIDATION: ${context} hash không khớp validated prompt.`);
  const session = await ensureDesktopSession();
  if (!session) throw new Error(`PROMPT_FIDELITY_VERIFY_UNAVAILABLE: ${context} không xác minh được trace với server.`);
  const response = await fetch(`${APP_URL}/api/v1/prompt-fidelity/verify`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: `ai_content_modeling_session=${session.token}` }, body: JSON.stringify({ projectId: metadata.projectId, sceneNumber: metadata.sceneNumber, promptType: metadata.promptType, promptId: slot.promptId, prompt: slot.validatedPrompt, promptHash: slot.validatedPromptHash }) });
  if (!response.ok) throw new Error(`PROMPT_MUTATED_AFTER_VALIDATION: ${context} server từ chối prompt trace.`);
  return slot.validatedPrompt;
}

async function runFlowImageJobUnlocked(event, projectId, channelId, slots) {
  sendProgress(event, "flow-browser:image-progress", { processed: 0, total: slots.length, label: "Đang mở Google Flow..." });
  let window = await createFlowWindow();
  await preflightFlowBrowser(window);
  sendProgress(event, "flow-browser:image-progress", { processed: 0, total: slots.length, label: "Đang mở một project Google Flow cho toàn bộ ảnh..." });
  const createdProject = await createFlowProject(window);
  window = createdProject.window;
  const projectUrl = createdProject.projectUrl;
  const images = {};
  const characterReferencePath = findChannelMainCharacterImagePath(channelId);
  const generatedFlowSources = { character: null, background: null, scenes: new Map() };
  const generatedFlowMediaIds = { character: null, background: null, scenes: new Map() };
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const isCharacter = slot?.kind === "character";
    const isBackground = slot?.kind === "background";
    const isScene = slot?.kind === "scene";
    const useReferences = slot?.useReferences !== false;
    const useCharacterReference = slot?.useCharacterReference ?? useReferences;
    const useBackgroundReference = slot?.useBackgroundReference ?? useReferences;
    if (!slot || (!isCharacter && !isBackground && !isScene) || (isScene && (!Number.isInteger(slot.sceneNumber) || slot.sceneNumber < 1)) || ((isBackground || isCharacter) && slot.sceneNumber !== undefined && slot.sceneNumber !== 0) || typeof slot.prompt !== "string" || !slot.prompt.trim()) {
      throw new Error("Dữ liệu ảnh tạo bằng Google Flow không hợp lệ.");
    }
    if (isCharacter) throw new Error("MAIN_CHARACTER_IDENTITY_PACK_IS_SOURCE_OF_TRUTH: không tạo nhân vật chính mới từ text prompt.");
    sendProgress(event, "flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang chuẩn bị " + (slot.label || "ảnh") + " trong cùng project Flow..." });
    let slotError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await clearFlowComposer(window);
        sendProgress(event, "flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang cấu hình Google Flow cho " + (slot.label || "ảnh") + "..." });
        await configureFlowImage(window);
        const activeCharacterReference = characterReferencePath;
        if (isScene && useCharacterReference && (generatedFlowMediaIds.character || generatedFlowSources.character || activeCharacterReference)) {
          sendProgress(event, "flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang gắn ảnh nhân vật chính làm tham chiếu..." });
          if (generatedFlowMediaIds.character) {
            await attachFlowAssetMediaIdToPrompt(window, generatedFlowMediaIds.character, await countFlowPromptAttachments(window));
          } else if (generatedFlowSources.character) {
            await attachFlowAssetSourceToPrompt(window, generatedFlowSources.character, await countFlowPromptAttachments(window));
          } else {
            await uploadFlowAsset(window, activeCharacterReference, true, undefined, { preferDropFallback: true });
          }
        }
        if (isScene && useBackgroundReference) {
          const backgroundPath = findGeneratedImagePath(projectId, "background", 0);
          if (!fs.existsSync(backgroundPath) || fs.statSync(backgroundPath).size < 1024) throw new Error("Ảnh bối cảnh đồng nhất chưa được tạo và lưu thành công vào app.");
          sendProgress(event, "flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang gắn ảnh bối cảnh đồng nhất làm tham chiếu..." });
          if (generatedFlowMediaIds.background) {
            await attachFlowAssetMediaIdToPrompt(window, generatedFlowMediaIds.background, await countFlowPromptAttachments(window));
          } else if (generatedFlowSources.background) {
            await attachFlowAssetSourceToPrompt(window, generatedFlowSources.background, await countFlowPromptAttachments(window));
          } else {
            await uploadFlowAsset(window, backgroundPath, true, undefined, { preferDropFallback: true });
          }
          if (slot.sceneNumber > 1 && slot.includePreviousReference !== false) {
            let previousPath = null;
            if (slot.candidateId) {
              try { previousPath = findGeneratedImagePath(projectId, "scene", slot.sceneNumber - 1, slot.candidateId); }
              catch { /* Baseline may be the currently approved image. */ }
            }
            if (!previousPath) previousPath = findGeneratedImagePath(projectId, "scene", slot.sceneNumber - 1);
            if (fs.existsSync(previousPath) && fs.statSync(previousPath).size >= 1024) {
              const previousSource = generatedFlowSources.scenes.get(slot.sceneNumber - 1);
              const previousMediaId = generatedFlowMediaIds.scenes.get(slot.sceneNumber - 1);
              if (previousMediaId) {
                await attachFlowAssetMediaIdToPrompt(window, previousMediaId, await countFlowPromptAttachments(window));
              } else if (previousSource) {
                await attachFlowAssetSourceToPrompt(window, previousSource, await countFlowPromptAttachments(window));
              } else {
                await uploadFlowAsset(window, previousPath, true, undefined, { preferDropFallback: true });
              }
            }
          }
        }

    const compiledPrompt = await validatedPromptForSend(slot, "ảnh " + (slot.label || "cảnh"), { projectId, channelId, promptType: "IMAGE", sceneNumber: isScene ? slot.sceneNumber : undefined });
    assertFlowPromptContract(compiledPrompt, "ảnh " + (slot.label || "cảnh"));

    const prepared = await executeFlowJavaScript(window, [
      "(() => {",
      "  const roots = [document];",
      "  const seen = new Set(roots);",
      "  for (let index = 0; index < roots.length; index += 1) {",
      "    for (const element of roots[index].querySelectorAll('*')) {",
      "      if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }",
      "    }",
      "  }",
      "  const allImages = () => roots.flatMap((root) => [...root.querySelectorAll('img')]);",
      "  const beforeSources = allImages().map((image) => image.currentSrc || image.src).filter(Boolean);",
      "  const beforeResources = performance.getEntriesByType('resource').map((entry) => entry.name).filter((source) => /flow-content\\.google\\/image\\//i.test(source));",
      "  return { beforeSources: [...beforeSources, ...beforeResources] };",
      "})()",
    ].join("\n"), true);
    if (prepared?.error) throw new Error(prepared.error);
    await setFlowPrompt(window, compiledPrompt);

    if (isScene && (useCharacterReference || useBackgroundReference) && await countFlowPromptAttachments(window) < ((useCharacterReference && activeCharacterReference ? 1 : 0) + (useBackgroundReference ? 1 : 0))) {
      throw new Error("Ảnh tham chiếu nhân vật hoặc bối cảnh chưa vào ô lệnh; chưa gửi tạo ảnh.");
    }
    await delay(1_500);
    sendProgress(event, "flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang gửi lệnh tạo " + (slot.label || "ảnh") + "..." });
    const sendPoint = await waitForFlowControlPoint(window, ["Bắt đầu tạo", "Tạo ảnh", "Generate", "Create", "Start generation", "arrow_forward"], false, 30_000);
    await dispatchBrowserClick(window, sendPoint);
    await delay(1_200);
    sendProgress(event, "flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang chờ Google Flow tạo " + (slot.label || "ảnh") + "..." });
    const result = await waitForFlowImageWithRecovery(window, projectUrl, prepared.beforeSources ?? []);
    if (result?.imageSource) {
      if (isCharacter) generatedFlowSources.character = result.imageSource;
      if (isCharacter) generatedFlowMediaIds.character = result.mediaId;
      else if (isBackground) {
        generatedFlowSources.background = result.imageSource;
        generatedFlowMediaIds.background = result.mediaId;
      } else if (isScene) {
        generatedFlowSources.scenes.set(slot.sceneNumber, result.imageSource);
        generatedFlowMediaIds.scenes.set(slot.sceneNumber, result.mediaId);
      }
    }
    const { buffer, mimeType } = await getFlowImageBuffer(window, result);
    const url = saveFlowImage(projectId, slot, buffer, mimeType);
    const sceneNumber = Number.isInteger(slot.sceneNumber) ? slot.sceneNumber : 0;
    const savedPath = findGeneratedImagePath(projectId, slot.kind, sceneNumber, slot.candidateId);
    if (!fs.existsSync(savedPath) || fs.statSync(savedPath).size < 1024) throw new Error((isCharacter ? "Ảnh nhân vật" : isBackground ? "Ảnh bối cảnh đồng nhất" : "Ảnh cảnh " + sceneNumber) + " chưa được lưu thành công vào app.");
    if (!fs.readFileSync(savedPath).equals(buffer)) throw new Error("Dữ liệu ảnh lưu trong app không khớp ảnh tải về từ Flow.");
    sendProgress(event, "flow-browser:image-progress", { processed: index, total: slots.length, label: "Đã xác nhận tệp ảnh tải về; giữ Flow mở trước khi chuyển bước..." });
    await delay(3_000);
    images[`${slot.kind}-${sceneNumber}`] = `${url}&v=${Date.now()}`;
    sendProgress(event, "flow-browser:image-progress", { processed: index + 1, total: slots.length, label: "Đã tải và lưu " + (slot.label || "ảnh") + " vào app" });
        slotError = null;
        break;
      } catch (error) {
        slotError = error;
        if (attempt === 1) throw error;
        sendProgress(event, "flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang tải lại Google Flow để thử lại ảnh..." });
        await reloadFlowProject(window, projectUrl);
      }
    }
    if (slotError) throw slotError;
  }
  return { status: "completed", images };
}

async function runFlowImageJob(event, projectId, channelId, slots) {
  return withFlowOperation(() => runFlowImageJobUnlocked(event, projectId, channelId, slots));
}

async function geminiVideoUiState(window) {
  return window.webContents.executeJavaScript(`(() => {
    const roots = [document]; const seen = new Set(roots);
    for (let i = 0; i < roots.length; i++) for (const node of roots[i].querySelectorAll('*')) if (node.shadowRoot && !seen.has(node.shadowRoot)) { seen.add(node.shadowRoot); roots.push(node.shadowRoot); }
    const visible = (node) => { const box = node?.getBoundingClientRect?.(); const style = node ? getComputedStyle(node) : null; return Boolean(box && box.width > 0 && box.height > 0 && style?.visibility !== 'hidden' && style?.display !== 'none'); };
    const controls = roots.flatMap(root => [...root.querySelectorAll('button,[role="button"],[role="menuitem"],[role="menuitemcheckbox"],gem-list-item')]).filter(visible);
    const label = (node) => String(node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\\s+/g, ' ').trim();
    const has = (pattern) => controls.some(node => pattern.test(label(node)));
    const input = roots.flatMap(root => [...root.querySelectorAll('[contenteditable="true"],textarea,[role="textbox"]')]).find(visible);
    const videos = roots.flatMap(root => [...root.querySelectorAll('video')]).filter(visible).map(node => node.currentSrc || node.src || node.querySelector('source')?.src).filter(Boolean);
    const inputLabel = String(input?.getAttribute?.('aria-label') || input?.getAttribute?.('placeholder') || input?.textContent || '');
    const videoRoute = location.hostname === 'gemini.google.com' && location.pathname === '/videos';
    const videoPrompt = /(?:mô tả video|describe your video)/i.test(inputLabel);
    const videoModeBadge = roots.flatMap(root => [...root.querySelectorAll('*')]).some(node => visible(node) && /^(?:Video)$/i.test(String(node.textContent || '').replace(/\\s+/g, ' ').trim()));
    const videoLanding = videoRoute && /(?:^|\\n)Tạo video(?:\\n|$)|(?:^|\\n)Create video(?:\\n|$)/i.test(String(document.body?.innerText || ''));
    const videoComposer = videoPrompt || videoModeBadge || videoLanding;
    const toolsMenuOpen = has(/^(?:Tệp|Files?|Drive|Google Photos|Sổ ghi chú|Notebooks|Tạo hình ảnh|Create image|Tạo video|Create video|Tạo nhạc|Create music|Canvas)$/i);
    return { url: location.href, videoRoute, videoMode: Boolean(input) && videoComposer, videoLanding, videoTool: has(/^(?:Tạo video|Create video)$/i), tools: has(/(?:Nội dung tải lên và công cụ|Uploads? and tools|Add files)/i), toolsMenuOpen, tryButton: has(/^(?:Dùng thử|Try it)$/i), upload: has(/^(?:Tệp|Files?|Tải tệp lên|Upload file|Thêm tệp|Add files?)$/i), inputReady: Boolean(input), videos, textTail: String(document.body?.innerText || '').slice(-1800) };
  })()`, true);
}

async function clickGeminiVideoControl(window, names) {
  const clicked = await window.webContents.executeJavaScript(`(() => {
    const names = ${JSON.stringify(names)};
    const roots = [document]; const seen = new Set(roots);
    for (let i = 0; i < roots.length; i++) for (const node of roots[i].querySelectorAll('*')) if (node.shadowRoot && !seen.has(node.shadowRoot)) { seen.add(node.shadowRoot); roots.push(node.shadowRoot); }
    const visible = (node) => { const box = node?.getBoundingClientRect?.(); const style = node ? getComputedStyle(node) : null; return Boolean(box && box.width > 0 && box.height > 0 && style?.visibility !== 'hidden' && style?.display !== 'none'); };
    const normalize = (value) => String(value || '').normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const wanted = names.map(normalize);
    const button = roots.flatMap(root => [...root.querySelectorAll('button,[role="button"],[role="menuitem"],[role="menuitemcheckbox"],gem-list-item')]).find(node => visible(node) && wanted.some(name => {
      const value = normalize([node.getAttribute('aria-label'), node.getAttribute('title'), node.textContent].join(' '));
      return value === name || value.includes(name);
    }));
    if (!button || button.disabled) return false;
    button.click(); return true;
  })()`, true);
  if (!clicked) throw new Error(`GEMINI_VIDEO_CONTROL_NOT_FOUND: ${names.join('/')}`);
}

// File pickers are guarded by Chromium as a trusted user-activation API.
// Calling HTMLElement.click() from executeJavaScript can open menus, but it
// does not reliably create the activation Gemini needs before it requests the
// native chooser. Return viewport coordinates so the caller can use actual
// CDP pointer events instead.
async function findGeminiVideoControlPoint(window, names) {
  return window.webContents.executeJavaScript(`(() => {
    const names = ${JSON.stringify(names)};
    const roots = [document]; const seen = new Set(roots);
    for (let i = 0; i < roots.length; i++) for (const node of roots[i].querySelectorAll('*')) if (node.shadowRoot && !seen.has(node.shadowRoot)) { seen.add(node.shadowRoot); roots.push(node.shadowRoot); }
    const visible = (node) => { const box = node?.getBoundingClientRect?.(); const style = node ? getComputedStyle(node) : null; return Boolean(box && box.width > 0 && box.height > 0 && style?.visibility !== 'hidden' && style?.display !== 'none'); };
    const normalize = (value) => String(value || '').normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const wanted = names.map(normalize);
    const button = roots.flatMap(root => [...root.querySelectorAll('button,[role="button"],[role="menuitemcheckbox"]')]).find(node => visible(node) && !node.disabled && wanted.some(name => {
      const value = normalize([node.getAttribute('aria-label'), node.getAttribute('title'), node.textContent].join(' '));
      return value === name || value.includes(name);
    }));
    if (!button) return null;
    const box = button.getBoundingClientRect();
    return { x: box.left + (box.width / 2), y: box.top + (box.height / 2) };
  })()`, true);
}

async function findGeminiVideoFileInputBackendNodeId(window) {
  const documentResult = await window.webContents.debugger.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
  const visit = (node) => {
    if (!node) return null;
    const attributes = Array.isArray(node.attributes) ? node.attributes : [];
    const attribute = (name) => {
      const index = attributes.findIndex((value) => String(value).toLowerCase() === name);
      return index >= 0 ? String(attributes[index + 1] || "") : "";
    };
    if (/^input$/i.test(String(node.nodeName || "")) && attribute("type").toLowerCase() === "file" && Number.isInteger(node.backendNodeId)) return node.backendNodeId;
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
      const match = visit(child);
      if (match) return match;
    }
    return null;
  };
  return visit(documentResult?.root) || null;
}

async function selectGeminiVideoGenerationTool(window) {
  const initialState = await geminiVideoUiState(window);
  if (initialState.videoMode) return;
  // The current Gemini video UI exposes the tools menu as a compact plus
  // button. Its text may be empty, but aria-haspopup=menu is stable.
  let opened = Boolean(initialState.toolsMenuOpen || initialState.videoTool);
  for (let attempt = 0; attempt < 60 && !opened; attempt += 1) {
    opened = await window.webContents.executeJavaScript(`(() => {
    const roots=[document],seen=new Set(roots);for(let i=0;i<roots.length;i++)for(const n of roots[i].querySelectorAll('*'))if(n.shadowRoot&&!seen.has(n.shadowRoot)){seen.add(n.shadowRoot);roots.push(n.shadowRoot);}
    const visible=n=>{const b=n?.getBoundingClientRect?.(),s=n?getComputedStyle(n):null;return Boolean(b&&b.width>0&&b.height>0&&s?.display!=='none'&&s?.visibility!=='hidden');};
    const input=roots.flatMap(r=>[...r.querySelectorAll('[contenteditable="true"],textarea,[role="textbox"]')]).find(visible);if(!input)return false;const box=input.getBoundingClientRect();
    const candidates=roots.flatMap(r=>[...r.querySelectorAll('button,[role="button"]')]).filter(n=>visible(n)&&n.getAttribute('aria-haspopup')==='menu');
    const target=candidates.sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return Math.hypot(x.right-box.left,x.top-box.bottom)-Math.hypot(y.right-box.left,y.top-box.bottom);})[0];if(!target||target.disabled)return false;target.click();return true;
    })()`, true).catch(() => false);
    if (!opened) await delay(250);
  }
  if (!opened) throw new Error("GEMINI_VIDEO_TOOL_LAUNCHER_NOT_FOUND");
  for (let i = 0; i < 40 && !(await geminiVideoUiState(window)).videoTool; i++) await delay(250);
  const selected = await window.webContents.executeJavaScript(`(() => {
    const roots=[document],seen=new Set(roots);for(let i=0;i<roots.length;i++)for(const n of roots[i].querySelectorAll('*'))if(n.shadowRoot&&!seen.has(n.shadowRoot)){seen.add(n.shadowRoot);roots.push(n.shadowRoot);}
    const visible=n=>{const b=n?.getBoundingClientRect?.(),s=n?getComputedStyle(n):null;return Boolean(b&&b.width>0&&b.height>0&&s?.display!=='none'&&s?.visibility!=='hidden');};
    const node=roots.flatMap(r=>[...r.querySelectorAll('button,[role="button"],[role="menuitem"],[role="menuitemcheckbox"],gem-list-item')]).find(n=>visible(n)&&/^(?:tạo video|create video)$/i.test(String(n.getAttribute('aria-label')||n.textContent||'').replace(/\\s+/g,' ').trim()));if(!node||node.disabled)return false;node.click();return true;
  })()`, true).catch(() => false);
  if (!selected) throw new Error("GEMINI_VIDEO_TOOL_OPTION_NOT_FOUND");
  for (let i = 0; i < 40; i++) {
    const state = await geminiVideoUiState(window);
    if (state.videoMode) return;
    if (state.tryButton) { await clickGeminiVideoControl(window, ["Dùng thử", "Try it"]); break; }
    await delay(250);
  }
  for (let i = 0; i < 80; i++) { if ((await geminiVideoUiState(window)).videoMode) return; await delay(250); }
  throw new Error("GEMINI_VIDEO_MODE_NOT_READY");
}

async function openGeminiVideoComposer(window) {
  const expectedUrl = "https://gemini.google.com/videos";
  if (!/^https:\/\/gemini\.google\.com\/videos(?:[/?#]|$)/i.test(window.webContents.getURL())) await window.webContents.loadURL(expectedUrl);
  for (let elapsed = 0; elapsed < 30_000; elapsed += 250) {
    const state = await geminiVideoUiState(window);
    if (/accounts\.google\.com|signin|challenge|captcha/i.test(state.url) || /sign in|đăng nhập|choose an account|chọn tài khoản|captcha|verify you are human/i.test(state.textTail)) throw new Error("GEMINI_AUTH_REQUIRED");
    // /videos is the first-party Video landing/composer. Do not click the
    // generic chat tools menu while this page is hydrating: that menu's
    // “Tạo video” item switches back to /app and destroys the Video context.
    // The explicit videoLanding predicate below is the readiness gate.
    if (/^https:\/\/gemini\.google\.com\/videos(?:[/?#]|$)/i.test(state.url) && state.videoMode && state.inputReady) return state;
    await delay(250);
  }
  throw new Error("GEMINI_VIDEO_PAGE_NOT_READY");
}

async function uploadGeminiVideoReference(window, imagePath) {
  const filePath = assertReadableAbsoluteFile(imagePath);
  const baseline = await readEdgeGeminiAttachmentEvidence(window, [filePath]);
  const confirmPreview = async (paths, timeoutMs) => {
    for (let elapsed = 0; elapsed < timeoutMs; elapsed += 250) {
      const evidence = await readEdgeGeminiAttachmentEvidence(window, paths);
      if (evidence?.confirmed && (evidence.previewCount > (baseline?.previewCount || 0) || evidence.previewImageCount > (baseline?.previewImageCount || 0) || evidence.filenamePresent)) return evidence;
      await delay(250);
    }
    return { confirmed: false };
  };
  try {
    await uploadWithEdgeFileChooser({
      window, cdp: window.webContents.debugger, filePaths: [filePath],
      getMainFrameId: () => getEdgeGeminiMainFrameId(window),
      targetIsCurrent: () => !window.isDestroyed() && /^https:\/\/gemini\.google\.com\//i.test(window.webContents.getURL()),
      openToolbar: async () => {
        const initialState = await geminiVideoUiState(window);
        if (initialState.upload) return;
        // This is a non-native menu toggle. A CDP user-gesture evaluation is
        // more reliable than a pointer click here because the menu otherwise
        // races its own animation and can toggle closed again.
        if (!initialState.toolsMenuOpen) await clickGeminiVideoControl(window, ["Nội dung tải lên và công cụ", "Uploads and tools", "Add files"]);
        for (let elapsed = 0; elapsed < 10_000; elapsed += 250) {
          if ((await geminiVideoUiState(window)).upload) return;
          await delay(250);
        }
        throw new Error("GEMINI_VIDEO_UPLOAD_MENU_NOT_READY");
      },
      findUploadAction: async () => (await geminiVideoUiState(window)).upload,
      clickUploadAction: async () => {
        const point = await findGeminiVideoControlPoint(window, ["Tệp", "Files", "Tải tệp lên", "Upload file", "Thêm tệp", "Add files"]);
        if (!point) throw new Error("GEMINI_VIDEO_UPLOAD_CONTROL_NOT_FOUND");
        await dispatchBrowserClick(window, point);
      },
      confirmPreview,
    });
  } catch (error) {
    // Gemini's current Video composer exposes a real hidden input, but some
    // builds do not emit Page.fileChooserOpened for that control. This is a
    // narrow CDP fallback for the same rendered input, not a second upload or
    // a UI bypass: it sets the selected file then still requires its preview.
    if (!(error instanceof Error) || error.message !== "EDGE_FILE_CHOOSER_NOT_OPENED") throw error;
    const backendNodeId = await findGeminiVideoFileInputBackendNodeId(window);
    if (!backendNodeId) throw new Error("GEMINI_VIDEO_FILE_INPUT_NOT_FOUND");
    await window.webContents.debugger.sendCommand("DOM.setFileInputFiles", { backendNodeId, files: [filePath] });
    const preview = await confirmPreview([filePath], 15_000);
    if (!preview?.confirmed) throw new Error("GEMINI_VIDEO_REFERENCE_PREVIEW_NOT_CONFIRMED");
    recordBrowserAction({ action: "gemini-video-reference-upload", provider: "EDGE_CDP", method: "DOM_SET_FILE_INPUT_FILES", filename: path.basename(filePath), preview });
  }
}

async function readGeminiVideoBuffer(window, source) {
  const dataUrl = await window.webContents.executeJavaScript(`(async () => {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(${JSON.stringify(source)}, { credentials: 'include', signal: controller.signal });
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob.type.startsWith('video/') || blob.size < 1024) return null;
      return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    } finally { clearTimeout(timeout); }
  })()`, true).catch(() => null);
  const match = typeof dataUrl === "string" ? /^data:video\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl) : null;
  const buffer = match ? Buffer.from(match[1], "base64") : null;
  if (!buffer || buffer.length < 1024 || buffer.toString("ascii", 4, 8) !== "ftyp") throw new Error("GEMINI_VIDEO_DOWNLOAD_INVALID: không tải được MP4 hợp lệ từ Gemini.");
  return buffer;
}

async function runGeminiVideoJobUnlocked(event, projectId, channelId, slots) {
  const window = await createGeminiWindow();
  const videos = {};
  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index];
    if (!Number.isInteger(slot?.sceneNumber) || typeof slot.englishPrompt !== "string" || !slot.englishPrompt.trim()) throw new Error("GEMINI_VIDEO_SLOT_INVALID");
    const sceneNumber = slot.sceneNumber;
    sendProgress(event, "gemini-browser:video-progress", { processed: index, total: slots.length, label: `Đang mở Gemini tạo video cảnh ${sceneNumber}...` });
    // Gemini Video has its own first-party composer at /videos. Opening it
    // directly avoids treating the chat-tool menu as the video product and
    // matches the UI where the user can create a video manually.
    let before = await openGeminiVideoComposer(window);
    const imagePath = findSceneImagePath(projectId, sceneNumber);
    await uploadGeminiVideoReference(window, imagePath);
    const prompt = await validatedPromptForSend(slot, `video cảnh ${sceneNumber}`, { projectId, channelId, promptType: "VIDEO", sceneNumber });
    const submitVideoPrompt = async () => {
      const command = createGeminiCommand({ purpose: "VIDEO_GENERATION", prompt });
      await startGeminiNavigationObserver(window, command);
      await startGeminiNetworkObserver(window, command);
      const baseline = await captureGeminiResponseSnapshot(window, null, "VIDEO_GENERATION");
      const baselineConversationId = conversationIdFromUrl(baseline.conversationUrl);
      command.recordConversationState({ url: baseline.conversationUrl, mode: baseline.conversationMode, assistantTurnCount: baseline.assistantTurnCount, userTurnCount: baseline.userTurnCount });
      command.setSubmissionBaseline({ expectedConversationUrl: baseline.conversationUrl, expectedConversationId: baselineConversationId, allowNewConversation: !baselineConversationId, userTurnCount: baseline.userTurnCount, assistantTurnCount: baseline.assistantTurnCount, userTurns: baseline.userTurns });
      await submitGeminiCommand(window, command, prompt, "GEMINI_VIDEO_COMPOSER_MISSING", baseline);
      if (command.snapshot().submissionConfirmed !== true) throw new Error("GEMINI_VIDEO_SUBMISSION_NOT_CONFIRMED");
      return command;
    };
    sendProgress(event, "gemini-browser:video-progress", { processed: index, total: slots.length, label: `Đang gửi prompt cảnh ${sceneNumber} tới Gemini...` });
    let command;
    try {
      command = await submitVideoPrompt();
    } catch (error) {
      const firstAttempt = error instanceof Error && error.message.startsWith("GEMINI_SUBMISSION_NOT_CONFIRMED");
      const resetToBareApp = isBareGeminiAppUrl(window.webContents.getURL());
      if (!firstAttempt || !resetToBareApp) throw error;
      // Google may rotate its cookies exactly when the Video composer submits.
      // A fresh /videos page and one resend are permitted only when no user
      // turn was created, so this cannot duplicate a real video request.
      recordBrowserAction({ action: "gemini-video-submit-reload-recovery", sceneNumber, recoveryAttempt: 1, recoveryBudget: 1, result: "RETRY", reason: "BARE_APP_WITHOUT_CONFIRMED_USER_TURN" });
      before = await openGeminiVideoComposer(window);
      await uploadGeminiVideoReference(window, imagePath);
      command = await submitVideoPrompt().catch((recoveryError) => {
        if (recoveryError instanceof Error && recoveryError.message.startsWith("GEMINI_SUBMISSION_NOT_CONFIRMED") && isBareGeminiAppUrl(window.webContents.getURL())) {
          const terminal = new Error("GEMINI_VIDEO_PAGE_RESET_DURING_SEND");
          terminal.code = "GEMINI_VIDEO_PAGE_RESET_DURING_SEND";
          terminal.firstDivergence = "GEMINI_VIDEO_PAGE_RESET_DURING_SEND";
          throw terminal;
        }
        throw recoveryError;
      });
    }
    let source = null;
    for (let elapsed = 0; elapsed < 600_000; elapsed += 2_000) {
      const state = await geminiVideoUiState(window);
      if (/video.*(?:failed|couldn.t be generated)|không thể tạo video|video.*(?:not available|limit reached)/i.test(state.textTail)) throw new Error(`GEMINI_VIDEO_PROVIDER_FAILED: ${state.textTail.slice(-350)}`);
      source = state.videos.find(value => !before.videos.includes(value));
      if (source) break;
      await delay(2_000);
    }
    if (!source) throw new Error("GEMINI_VIDEO_RESULT_TIMEOUT");
    const buffer = await readGeminiVideoBuffer(window, source);
    const url = saveGeminiVideo(projectId, sceneNumber, buffer);
    videos[`scene-${sceneNumber}`] = url;
    sendProgress(event, "gemini-browser:video-progress", { processed: index + 1, total: slots.length, label: `Đã lưu video cảnh ${sceneNumber} từ Gemini.` });
  }
  return { status: "completed", videos };
}

async function runGeminiVideoJob(event, projectId, channelId, slots) {
  return withGeminiBrowserOperation(() => runGeminiVideoJobUnlocked(event, projectId, channelId, slots));
}

async function runFlowVideoJobUnlocked(event, projectId, channelId, slots) {
  sendProgress(event, "gemini-browser:video-progress", { processed: 0, total: slots.length, label: "Đang mở Google Flow..." });
  let window = await createFlowWindow();
  await preflightFlowBrowser(window);
  const videos = {};
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (!Number.isInteger(slot?.sceneNumber) || typeof slot.visualBlock !== "string" || typeof slot.actionBlock !== "string" || typeof slot.audioBlock !== "string" || typeof slot.englishPrompt !== "string" || !slot.englishPrompt.trim()) {
      throw new Error("Dữ liệu phân cảnh tạo video không hợp lệ.");
    }
    const sceneNumber = slot.sceneNumber;
    sendProgress(event, "gemini-browser:video-progress", { processed: index, total: slots.length, label: `Đang mở project Google Flow riêng cho cảnh ${sceneNumber}...` });
    const createdProject = await createFlowProject(window);
    window = createdProject.window;
    const projectUrl = createdProject.projectUrl;
    const imagePath = findSceneImagePath(projectId, sceneNumber);
    sendProgress(event, "gemini-browser:video-progress", { processed: index, total: slots.length, label: slot.label || "Cảnh " + sceneNumber });

    const prompt = await validatedPromptForSend(slot, "video cảnh " + sceneNumber, { projectId, channelId, promptType: "VIDEO", sceneNumber });
    assertFlowPromptContract(prompt, "video cảnh " + sceneNumber);

    const prepareVideoSubmission = async (targetWindow) => {
      await clearFlowComposer(targetWindow);
      sendProgress(event, "gemini-browser:video-progress", { processed: index, total: slots.length, label: "Đang cấu hình Google Flow cho cảnh " + sceneNumber + "..." });
      await configureFlowVideo(targetWindow);
      sendProgress(event, "gemini-browser:video-progress", { processed: index, total: slots.length, label: "Đang tải đúng ảnh cảnh " + sceneNumber + " lên Google Flow..." });
      await uploadFlowAsset(targetWindow, imagePath, false, (label) => sendProgress(event, "gemini-browser:video-progress", { processed: index, total: slots.length, label }), { preferDropFallback: true });
      await addFlowAssetToStart(targetWindow, imagePath);

      const prepared = await targetWindow.webContents.executeJavaScript([
        "(() => {",
        "  const roots = [document];",
        "  const seen = new Set(roots);",
        "  for (let index = 0; index < roots.length; index += 1) {",
        "    for (const element of roots[index].querySelectorAll('*')) {",
        "      if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }",
        "    }",
        "  }",
        "  const videos = roots.flatMap((root) => [...root.querySelectorAll('video')]);",
        "  const beforeSources = videos.map((video) => video.currentSrc || video.src || video.querySelector('source')?.src).filter(Boolean);",
        "  const beforeCardCount = roots.flatMap((root) => [...root.querySelectorAll('img[alt=\"Generated video thumbnail\"]')]).filter((element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0; }).length;",
        "  const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable=\"true\"], [role=\"textbox\"]')]).filter((element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 100 && bounds.height >= 20 && style.visibility !== 'hidden' && style.display !== 'none'; }).at(-1);",
        "  if (!input) return { error: 'Không tìm thấy ô nhập prompt Google Flow.' };",
        "  input.focus();",
        "  if (input.tagName === 'TEXTAREA') { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(input, ''); }",
        "  else { document.execCommand('selectAll', false); document.execCommand('delete', false); }",
        "  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));",
        "  return { beforeSources, beforeCardCount };",
        "})()",
      ].join("\n"), true);
      if (prepared?.error) throw new Error(prepared.error);
      await setFlowPrompt(targetWindow, prompt);
      return prepared;
    };

    const submitPreparedVideo = async (targetWindow, prepared) => {
      const sendPoint = await waitForFlowControlPoint(targetWindow, ["Bắt đầu tạo", "Tạo video", "Generate", "Create", "Start generation", "arrow_forward"], false, 30_000);
      await flowHumanPause("beforeGenerate");
      await dispatchBrowserClick(targetWindow, sendPoint);
      let acknowledgement = await waitForFlowSubmissionAcknowledgement(targetWindow, prepared.beforeSources ?? [], prepared.beforeCardCount ?? 0);
      if (!acknowledgement) {
        const fallbackClicked = await clickFlowGenerateDomFallback(targetWindow);
        if (fallbackClicked) acknowledgement = await waitForFlowSubmissionAcknowledgement(targetWindow, prepared.beforeSources ?? [], prepared.beforeCardCount ?? 0);
      }
      if (!acknowledgement) throw createFlowGenerationFailure("FLOW_GENERATION_SUBMISSION_NOT_CONFIRMED", "Google Flow không xác nhận đã nhận lệnh tạo video.", {
        stage: "STAGE_4_VIDEO_GENERATION",
        sceneId: typeof slot.sceneId === "string" ? slot.sceneId : null,
        flowProjectUrl: projectUrl,
        generateTriggered: true,
        generationStarted: false,
        providerJobCreated: false,
        beforeCardCount: prepared.beforeCardCount ?? 0,
        userAction: "GENERATE_CLICK_WITH_DOM_FALLBACK",
      });
      return prepared;
    };

    const prepared = await prepareVideoSubmission(window);

    const checkpointId = `manual-flow:${projectId}:scene-${sceneNumber}`;
    saveManualFlowCheckpoint({
      id: checkpointId,
      status: "WAITING_FOR_MANUAL_FLOW_SUBMISSION",
      projectId,
      sceneNumber,
      flowProjectUrl: projectUrl,
      startFramePath: imagePath,
      expectedPrompt: prompt,
      preSubmitVideoSources: prepared.beforeSources ?? [],
      preSubmitCardCount: prepared.beforeCardCount ?? 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    sendProgress(event, "gemini-browser:video-progress", { processed: index, total: slots.length, label: "Đang gửi lệnh tạo video cảnh " + sceneNumber + "..." });
    await submitPreparedVideo(window, prepared);

    sendProgress(event, "gemini-browser:video-progress", { processed: index, total: slots.length, label: "Đang chờ Google Flow tạo video cảnh " + sceneNumber + "..." });
    const result = await waitForFlowVideoWithRecovery(window, projectUrl, prepared.beforeSources ?? [], prepared.beforeCardCount ?? 0, {
      stage: "STAGE_4_VIDEO_GENERATION",
      sceneId: typeof slot.sceneId === "string" ? slot.sceneId : null,
      flowProjectUrl: projectUrl,
      generateTriggered: true,
      allowProviderReloadRecovery: true,
      resendAfterReload: async (targetWindow, recoveryAttempt) => {
        sendProgress(event, "gemini-browser:video-progress", { processed: index, total: slots.length, label: "Flow tạm báo hoạt động bất thường; đã tải lại project và gửi lại một lần (" + recoveryAttempt + "/" + MAX_FLOW_PROVIDER_RELOAD_RECOVERY + ")..." });
        const retryPrepared = await prepareVideoSubmission(targetWindow);
        updateManualFlowCheckpoint(checkpointId, {
          preSubmitVideoSources: retryPrepared.beforeSources ?? [],
          preSubmitCardCount: retryPrepared.beforeCardCount ?? 0,
          updatedAt: new Date().toISOString(),
        });
        await submitPreparedVideo(targetWindow, retryPrepared);
        return retryPrepared;
      },
    });
    const buffer = await getFlowVideoBuffer(window, result);
    const url = saveGeminiVideo(projectId, sceneNumber, buffer);
    const savedPath = path.join(app.getPath("userData"), "generated-videos", projectId, "scene-" + sceneNumber + ".mp4");
    if (buffer.length < 1024 || !fs.existsSync(savedPath) || !fs.readFileSync(savedPath).equals(buffer)) {
      throw new Error("Video cảnh " + sceneNumber + " chưa tải và lưu đầy đủ vào app; chưa chuyển cảnh tiếp theo.");
    }
    removeManualFlowCheckpoint(checkpointId);
    sendProgress(event, "gemini-browser:video-progress", { processed: index, total: slots.length, label: "Đã xác nhận tệp video tải về; giữ Flow mở trước khi chuyển bước..." });
    await delay(3_000);
    videos["scene-" + sceneNumber] = url + "&v=" + Date.now();
    sendProgress(event, "gemini-browser:video-progress", { processed: index + 1, total: slots.length, label: `Đã tải và lưu thành công video cảnh ${sceneNumber}.` });
  }
  return { status: "completed", videos };
}

async function runFlowVideoJob(event, projectId, channelId, slots) {
  return withFlowOperation(() => runFlowVideoJobUnlocked(event, projectId, channelId, slots));
}

async function resumeAfterManualFlowSubmission(checkpointId) {
  const checkpoint = readManualFlowCheckpoints()[checkpointId];
  if (!checkpoint || !["WAITING_FOR_MANUAL_FLOW_SUBMISSION", "COMPLETED"].includes(checkpoint.status)) {
    throw new Error("MANUAL_FLOW_CHECKPOINT_NOT_FOUND");
  }
  const savedPath = path.join(app.getPath("userData"), "generated-videos", checkpoint.projectId, "scene-" + checkpoint.sceneNumber + ".mp4");
  const savedVideoAvailable = fs.existsSync(savedPath) && fs.statSync(savedPath).size >= 1024;
  if (savedVideoAvailable) {
    updateManualFlowCheckpoint(checkpointId, { status: "COMPLETED", savedVideoPath: savedPath });
    return { status: "MANUAL_HANDOFF_RESUME", checkpointId, video: `/api/v1/projects/${checkpoint.projectId}/videos?sceneNumber=${checkpoint.sceneNumber}` };
  }
  try {
    let window = await createFlowWindow();
    try {
      await window.webContents.loadURL(checkpoint.flowProjectUrl);
      await delay(1_500);
      let result = await waitForFlowVideo(window, checkpoint.preSubmitVideoSources || [], checkpoint.preSubmitCardCount || 0, 20_000, {
        stage: "STAGE_4_VIDEO_GENERATION",
        sceneId: typeof checkpoint.sceneId === "string" ? checkpoint.sceneId : null,
        flowProjectUrl: checkpoint.flowProjectUrl,
        generateTriggered: true,
      });
      if (!result?.videoSource && !result?.editorReady) {
        return { status: "MANUAL_SUBMISSION_NOT_COMPLETED", checkpointId };
      }
      let buffer;
      try {
        buffer = await withTimeout(getFlowVideoBuffer(window, result), MANUAL_FLOW_HANDOFF_MEDIA_TIMEOUT_MS, "MANUAL_FLOW_HANDOFF_MEDIA_TIMEOUT");
      } catch (primaryError) {
        const fallbackSource = checkpoint.resolvedVideoSource;
        if (typeof fallbackSource !== "string") throw primaryError;
        if (window?.edgeRuntime) {
          buffer = await withTimeout(readFlowMediaBufferThroughPage(window, fallbackSource, "video"), MANUAL_FLOW_HANDOFF_MEDIA_TIMEOUT_MS, "MANUAL_FLOW_HANDOFF_MEDIA_TIMEOUT");
          if (!buffer) throw primaryError;
        } else {
          const response = await window.webContents.session.fetch(fallbackSource);
          if (!response.ok) throw primaryError;
          buffer = Buffer.from(await response.arrayBuffer());
        }
        updateManualFlowCheckpoint(checkpointId, { recoveredWarning: `RECOVERED_WARNING: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}` });
      }
      const url = saveGeminiVideo(checkpoint.projectId, checkpoint.sceneNumber, buffer);
      if (buffer.length < 1024 || !fs.existsSync(savedPath) || !fs.readFileSync(savedPath).equals(buffer)) {
        throw new Error("MANUAL_FLOW_VIDEO_SAVE_FAILED");
      }
      updateManualFlowCheckpoint(checkpointId, { status: "COMPLETED", savedVideoPath: savedPath, resolvedVideoSource: result.videoSource || checkpoint.resolvedVideoSource || null });
      return { status: "MANUAL_HANDOFF_RESUME", checkpointId, video: url };
    } finally {
      await closeFlowWindow(false).catch(() => {});
    }
  } catch (error) {
    await closeFlowWindow(false).catch(() => {});
    throw error;
  }
}

async function prepareManualFlowSubmission(projectId, channelId, slot) {
  if (!Number.isInteger(slot?.sceneNumber) || typeof slot.visualBlock !== "string" || typeof slot.actionBlock !== "string" || typeof slot.audioBlock !== "string" || typeof slot.englishPrompt !== "string") {
    throw new Error("MANUAL_FLOW_SUBMISSION_INPUT_INVALID");
  }
  const checkpointId = `manual-flow:${projectId}:scene-${slot.sceneNumber}`;
  const existingCheckpoint = readManualFlowCheckpoints()[checkpointId];
  let window = await createFlowWindow();
  let projectUrl;
  if (existingCheckpoint?.flowProjectUrl) {
    await window.webContents.loadURL(existingCheckpoint.flowProjectUrl);
    await waitForFlowState(window, "FLOW_PROJECT_LOADING");
    await waitForFlowState(window, "FLOW_PROJECT_READY");
    projectUrl = existingCheckpoint.flowProjectUrl;
  } else {
    await preflightFlowBrowser(window);
    const created = await createFlowProject(window);
    window = created.window;
    projectUrl = created.projectUrl;
  }
  const checkpointStartFrame = existingCheckpoint?.startFramePath;
  const imagePath = typeof checkpointStartFrame === "string" && fs.existsSync(checkpointStartFrame) && fs.statSync(checkpointStartFrame).size >= 1024
    ? checkpointStartFrame
    : findSceneImagePath(projectId, slot.sceneNumber);
  const prompt = await validatedPromptForSend(slot, "manual video cảnh " + slot.sceneNumber, { projectId, channelId, promptType: "VIDEO", sceneNumber: slot.sceneNumber });
  await clearFlowComposer(window);
  await configureFlowVideo(window);
  await uploadFlowAsset(window, imagePath, false, () => {}, { preferDropFallback: true });
  await addFlowAssetToStart(window, imagePath);
  const rehydrated = await window.webContents.executeJavaScript([
    "(() => {",
    "  const prompt = " + JSON.stringify(prompt) + ";",
    "  const roots = [document]; const seen = new Set(roots);",
    "  for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }",
    "  const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable=\"true\"]')]).find((element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 100 && bounds.height >= 20; });",
    "  if (!input) return { ready: false, reason: 'PROMPT_INPUT_MISSING' };",
    "  input.focus();",
    "  if (input.tagName === 'TEXTAREA') { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(input, prompt); } else { document.execCommand('selectAll', false); document.execCommand('insertText', false, prompt); }",
    "  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));",
    "  input.dispatchEvent(new Event('change', { bubbles: true }));",
    "  return { ready: true, promptLength: (input.value || input.innerText || '').length };",
    "})()",
  ].join("\n"), true);
  if (!rehydrated?.ready) throw new Error("MANUAL_FLOW_REHYDRATION_FAILED: " + (rehydrated?.reason || "PROMPT_NOT_FILLED"));
  const ready = await waitForFlowControlPoint(window, ["Start generation", "arrow_forward"], false, 15_000).then(() => true).catch(() => false);
  if (!ready) throw new Error("MANUAL_FLOW_REHYDRATION_FAILED: GENERATE_NOT_READY");
  saveManualFlowCheckpoint({ id: checkpointId, status: "WAITING_FOR_MANUAL_FLOW_SUBMISSION", projectId, channelId, sceneNumber: slot.sceneNumber, flowProjectUrl: projectUrl, startFramePath: imagePath, expectedPrompt: prompt, preSubmitVideoSources: [], preSubmitCardCount: 0, createdAt: existingCheckpoint?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
  window.show();
  window.focus();
  return { status: "WAITING_FOR_MANUAL_FLOW_SUBMISSION", checkpointId, flowProjectUrl: projectUrl, startFramePath: imagePath, prompt };
}


ipcMain.handle("flow-browser:run-image-job", async (event, value) => {
  const projectId = value?.projectId;
  const channelId = value?.channelId;
  const slots = value?.slots;
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId) || typeof channelId !== "string" || !/^[A-Za-z0-9_-]+$/.test(channelId) || !Array.isArray(slots) || slots.length === 0) {
    throw new Error("Yêu cầu tạo ảnh bằng Google Flow không hợp lệ.");
  }
  const result = await runFlowImageJob(event, projectId, channelId, slots);
  await closeFlowWindow();
  return result;
});

ipcMain.handle("gemini-browser:run-video-job", async (event, value) => {
  try {
    const projectId = value?.projectId;
    const channelId = value?.channelId;
    const slots = value?.slots;
    if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId) || typeof channelId !== "string" || !/^[A-Za-z0-9_-]+$/.test(channelId) || !Array.isArray(slots) || slots.length === 0) {
      throw new Error("Yêu cầu tạo video không hợp lệ.");
    }
    const result = await runGeminiVideoJob(event, projectId, channelId, slots);
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: serializeGeminiError(error) };
  }
});

ipcMain.handle("flow-browser:run-video-job", async (event, value) => {
  try {
    const { projectId, channelId, slots } = value || {};
    if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId) || typeof channelId !== "string" || !/^[A-Za-z0-9_-]+$/.test(channelId) || !Array.isArray(slots) || !slots.length) throw new Error("Yêu cầu tạo video Flow không hợp lệ.");
    const result = await runFlowVideoJob(event, projectId, channelId, slots);
    await closeFlowWindow();
    return { ok: true, data: result };
  } catch (error) { return { ok: false, error: serializeGeminiError(error) }; }
});

ipcMain.handle("flow-browser:resume-after-manual-submission", async (_event, value) => {
  const checkpointId = value?.checkpointId;
  if (typeof checkpointId !== "string" || !/^manual-flow:[A-Za-z0-9_-]+:scene-\d+$/.test(checkpointId)) {
    throw new Error("MANUAL_FLOW_CHECKPOINT_INVALID");
  }
  try {
    return await withFlowOperation(() => resumeAfterManualFlowSubmission(checkpointId));
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
});

ipcMain.handle("flow-browser:prepare-manual-submission", async (_event, value) => {
  const projectId = value?.projectId;
  const channelId = value?.channelId;
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId) || typeof channelId !== "string" || !/^[A-Za-z0-9_-]+$/.test(channelId)) throw new Error("MANUAL_FLOW_SUBMISSION_INPUT_INVALID");
  return withFlowOperation(() => prepareManualFlowSubmission(projectId, channelId, value?.slot));
});

ipcMain.handle("gemini-browser:open-flow", async () => {
  const window = await createFlowWindow();
  await waitForFlowLoad(window);
  window.show();
  window.focus();
  return { status: "opened" };
});

ipcMain.handle("video-editor:pick-audio", async () => {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: "Chọn nhạc nền hoặc hiệu ứng âm thanh",
    properties: ["openFile"],
    filters: [{ name: "Tệp âm thanh", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"] }],
  });
  if (selection.canceled || !selection.filePaths[0]) return { status: "cancelled" };
  return { status: "selected", path: selection.filePaths[0], name: path.basename(selection.filePaths[0]) };
});

ipcMain.handle("video-editor:render-final", async (event, value) => {
  const projectId = value?.projectId;
  const sceneNumbers = value?.sceneNumbers;
  const isValidSceneList = Array.isArray(sceneNumbers)
    && sceneNumbers.length > 0
    && sceneNumbers.length <= 30
    && sceneNumbers.every((sceneNumber) => Number.isInteger(sceneNumber) && sceneNumber > 0)
    && new Set(sceneNumbers).size === sceneNumbers.length;
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId) || !isValidSceneList) {
    throw new Error("Yêu cầu ghép video không hợp lệ.");
  }
  return renderFinalVideo(event, projectId, sceneNumbers, value?.options);
});

ipcMain.handle("gemini-browser:import-images", async (_event, value) => {
  const projectId = value?.projectId;
  const slots = value?.slots;
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId) || !Array.isArray(slots) || slots.length === 0) {
    throw new Error("Yêu cầu nhập ảnh không hợp lệ.");
  }
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: `Chọn ${slots.length} ảnh theo đúng thứ tự`,
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Tất cả tệp hình ảnh", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"] }],
  });
  if (selection.canceled) return { status: "cancelled", images: {} };
  if (selection.filePaths.length !== slots.length) throw new Error(`Hãy chọn đúng ${slots.length} ảnh theo thứ tự đã hiển thị.`);
  const imageRoot = path.join(app.getPath("userData"), "generated-images", projectId);
  fs.mkdirSync(imageRoot, { recursive: true });
  const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);
  const allowedKinds = new Set(["character", "background", "scene"]);
  const images = {};
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const source = selection.filePaths[index];
    if (!slot || !allowedKinds.has(slot.kind)) throw new Error("Loại ảnh không hợp lệ.");
    const extension = path.extname(source).toLowerCase();
    if (!allowedExtensions.has(extension)) throw new Error("Định dạng ảnh chưa được hỗ trợ.");
    const stat = fs.statSync(source);
    if (stat.size > 20 * 1024 * 1024) throw new Error("Mỗi ảnh phải nhỏ hơn 20 MB.");
    const sceneNumber = Number.isInteger(slot.sceneNumber) ? slot.sceneNumber : 0;
    for (const oldExtension of allowedExtensions) {
      const oldTarget = path.join(imageRoot, `${slot.kind}-${sceneNumber}${oldExtension}`);
      if (fs.existsSync(oldTarget)) fs.rmSync(oldTarget);
    }
    const targetName = `${slot.kind}-${sceneNumber}${extension}`;
    fs.copyFileSync(source, path.join(imageRoot, targetName));
    images[`${slot.kind}-${sceneNumber}`] = `/api/v1/projects/${projectId}/images?kind=${slot.kind}&sceneNumber=${sceneNumber}`;
  }
  return { status: "imported", images };
});

async function createWindow(syncAfterUpdate = false) {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: "#f4f7fb",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedExternalUrl(url)) return { action: "deny" };
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow = window;
  const desktopSession = await ensureDesktopSession();
  if (desktopSession) {
    await window.webContents.session.cookies.set({
      url: APP_URL,
      name: "ai_content_modeling_session",
      value: desktopSession.token,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      expirationDate: new Date(desktopSession.expiresAt).getTime() / 1000,
    });
  }
  const url = syncAfterUpdate ? `${APP_URL}/?autoSync=1` : APP_URL;
  void window.loadURL(url);
}

app.whenReady()
  .then(async () => {
    await startLocalServices();
    await waitForServer();
    await verifyDevRendererIdentity();
    await flushDesktopRuntimeFailures();
    await createWindow(consumeSyncAfterUpdate());
    if (process.env.DESKTOP_FLOW_BRIDGE_DISABLED !== "1") startDesktopFlowBridge();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  })
  .catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    fs.appendFileSync(path.join(app.getPath("userData"), "desktop-runtime.log"), `[startup-error] ${message}\n`, "utf8");
    dialog.showErrorBox("Không thể khởi động Modeling AI", "Ứng dụng không thể khởi động dịch vụ nội bộ. Hãy mở lại ứng dụng hoặc gửi file desktop-runtime.log để kiểm tra.");
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  if (desktopFlowBridgeTimer) clearInterval(desktopFlowBridgeTimer);
  serverProcess?.kill();
  workerProcess?.kill();
});
