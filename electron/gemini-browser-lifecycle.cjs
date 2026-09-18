const crypto = require("node:crypto");

const TERMINAL_STATES = new Set(["PARSED", "VALIDATED", "TIMEOUT", "INVALID_RESPONSE", "FAILED"]);
const FINAL_RESPONSE_SELECTORS = ["message-content", "[data-message-content]", "[data-response-content]", "[data-testid*='markdown']", "[data-testid*='response']", "[class*='markdown']", "[class*='response-content']"];
const POSITIVE_FINAL_RESPONSE_SIGNALS = ["MESSAGE_CONTENT", "RESPONSE_DATA_ATTRIBUTE", "MARKDOWN_CLASS", "MARKDOWN_TEST_ID"];
const LATENCY_PAGE_MILESTONES = ["SUBMIT", "PLUS_5S", "PLUS_30S", "PLUS_60S", "FIRST_RESPONSE_DOM_TOKEN", "FINAL_RESPONSE_VISIBLE", "TIMEOUT"];
const STATUS_NODE_SELECTORS = ["[role='status']", "[aria-live]", "[aria-busy='true']", "[role='progressbar']", "mat-progress-spinner"];
const ACCESSIBILITY_CHROME_SELECTORS = ["[aria-label]", "[title]"];
const STATUS_TEXT_PATTERNS = [/^Initiating(?: the)? Analysis$/i, /^Gemini (?:đã nói|said)$/i, /^(?:thinking|đang suy nghĩ|generating|đang tạo|loading|đang tải|processing|đang xử lý)[. …]*$/i];
const TRANSITIONS = {
  QUEUED: new Set(["SUBMITTED", "TIMEOUT", "FAILED"]),
  SUBMITTED: new Set(["GENERATING", "TIMEOUT", "FAILED"]),
  GENERATING: new Set(["RESPONSE_COMPLETE", "TIMEOUT", "FAILED"]),
  RESPONSE_COMPLETE: new Set(["RESPONSE_CAPTURED", "TIMEOUT", "FAILED"]),
  RESPONSE_CAPTURED: new Set(["PARSED", "INVALID_RESPONSE", "FAILED"]),
  PARSED: new Set(["VALIDATED", "FAILED"]),
  VALIDATED: new Set(),
  TIMEOUT: new Set(),
  INVALID_RESPONSE: new Set(),
  FAILED: new Set(),
};

function hashText(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function redactNetworkUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}

function normalizeNetworkInitiator(initiator = {}) {
  const callFrames = Array.isArray(initiator.stack?.callFrames) ? initiator.stack.callFrames : [];
  return {
    type: typeof initiator.type === "string" ? initiator.type : null,
    url: redactNetworkUrl(initiator.url),
    lineNumber: Number.isFinite(initiator.lineNumber) ? initiator.lineNumber : null,
    columnNumber: Number.isFinite(initiator.columnNumber) ? initiator.columnNumber : null,
    stack: callFrames.slice(0, 32).map((frame) => ({
      functionName: typeof frame?.functionName === "string" ? frame.functionName.slice(0, 200) : null,
      url: redactNetworkUrl(frame?.url),
      lineNumber: Number.isFinite(frame?.lineNumber) ? frame.lineNumber : null,
      columnNumber: Number.isFinite(frame?.columnNumber) ? frame.columnNumber : null,
    })),
  };
}

function normalizeDocumentNavigationRequest(params = {}) {
  const request = params.request || {};
  return {
    requestId: params.requestId || null,
    loaderId: params.loaderId || null,
    frameId: params.frameId || null,
    documentURL: redactNetworkUrl(params.documentURL),
    url: redactNetworkUrl(request.url),
    method: typeof request.method === "string" ? request.method : null,
    timestamp: Number.isFinite(params.wallTime) ? new Date(params.wallTime * 1_000).toISOString() : new Date().toISOString(),
    initiator: normalizeNetworkInitiator(params.initiator),
    redirectResponsePresent: Boolean(params.redirectResponse),
    hasUserGesture: params.hasUserGesture === true ? true : params.hasUserGesture === false ? false : null,
    mixedContentType: typeof params.mixedContentType === "string" ? params.mixedContentType : null,
    referrerPolicy: typeof request.referrerPolicy === "string" ? request.referrerPolicy : null,
    type: params.type || null,
  };
}

function balancedJsonValueEnd(value, startIndex) {
  const opening = value[startIndex];
  if (opening !== "{" && opening !== "[") return -1;
  const expectedClosers = [];
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === "{") expectedClosers.push("}");
    else if (character === "[") expectedClosers.push("]");
    else if (character === "}" || character === "]") {
      if (expectedClosers.pop() !== character) return -1;
      if (expectedClosers.length === 0) return index;
    }
  }
  return -1;
}

function repairTrailingTopLevelProperty(candidate, rootEnd, rootObject) {
  const suffix = candidate.slice(rootEnd + 1).trim();
  const property = /^\]\s*,\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*/.exec(suffix);
  if (!property || Object.prototype.hasOwnProperty.call(rootObject, property[1])) return null;
  const valueStart = property[0].length;
  const valueEnd = balancedJsonValueEnd(suffix, valueStart);
  if (valueEnd < valueStart || suffix.slice(valueEnd + 1).trim() !== "}") return null;
  let propertyValue;
  try { propertyValue = JSON.parse(suffix.slice(valueStart, valueEnd + 1)); }
  catch { return null; }
  return { ...rootObject, [property[1]]: propertyValue };
}

function extractGeminiJsonCandidate(rawResponse) {
  const raw = String(rawResponse ?? "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON_OBJECT_NOT_FOUND");
  const candidate = raw.slice(start, end + 1).replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(candidate); }
  catch (firstError) {
    const normalized = candidate.replace(/,\s*([}\]])/g, "$1");
    try { return JSON.parse(normalized); }
    catch {
      const rootEnd = balancedJsonValueEnd(candidate, 0);
      if (rootEnd > 0) {
        try {
          const rootObject = JSON.parse(candidate.slice(0, rootEnd + 1));
          const repaired = repairTrailingTopLevelProperty(candidate, rootEnd, rootObject);
          if (repaired) return repaired;
        } catch { /* The strict parser failure remains authoritative. */ }
      }
      throw firstError;
    }
  }
}

function isGeminiGenerationRequest(request) {
  if (!request || String(request.method || "").toUpperCase() !== "POST") return false;
  try {
    const url = new URL(String(request.url || ""));
    return url.origin === "https://gemini.google.com" && /\/assistant\.lamda\.BardFrontendService\/StreamGenerate$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function findAttributedGeminiGenerationRequest(requests, { commandId, sessionId, submitAttemptAt } = {}) {
  const submittedAt = Date.parse(submitAttemptAt || "");
  if (!commandId || !sessionId || !Number.isFinite(submittedAt)) return null;
  return (Array.isArray(requests) ? requests : [])
    .filter((request) => request?.commandId === commandId && request?.sessionId === sessionId && isGeminiGenerationRequest(request) && Number.isFinite(Date.parse(request.startedAt)) && Date.parse(request.startedAt) >= submittedAt)
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))[0] || null;
}

function submissionConfirmationSource(snapshot) {
  if (snapshot?.composerReady === true) return "DOM_COMPOSER_CLEARED";
  if (snapshot?.userMessagePresent === true) return "DOM_USER_MESSAGE";
  if (snapshot?.stopButtonPresent === true || snapshot?.streamingIndicatorPresent === true) return "DOM_GENERATING_UI";
  if (snapshot?.newResponseCount === 1) return "DOM_RESPONSE_TURN";
  return null;
}

function shouldRetryGeminiSend({ composerStillContainsPrompt, submissionConfirmed, generationRequestStarted, pageReady, retryBudgetAvailable = true } = {}) {
  return composerStillContainsPrompt === true && submissionConfirmed !== true && generationRequestStarted !== true && pageReady === true && retryBudgetAvailable === true;
}

function authorizeGeminiSendRetry({ retryEligible, confirmationGraceExpired, submissionConfirmed, generationRequestStarted, pageReady, retryBudgetAvailable = true, duplicateSendGuardPass = true, commandStillCurrent = true } = {}) {
  return retryEligible === true && confirmationGraceExpired === true && submissionConfirmed !== true && generationRequestStarted !== true && pageReady === true && retryBudgetAvailable === true && duplicateSendGuardPass === true && commandStillCurrent === true;
}

function isGeminiTargetReady({ url, loading, readyState } = {}) {
  return /^https:\/\/gemini\.google\.com\//i.test(String(url || "")) && loading !== true && ["interactive", "complete"].includes(readyState);
}

function latencyDelta(startAt, endAt) {
  if (!startAt || !endAt) return null;
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function percentile(values, percentileRank) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarizeRendererHeartbeat(samples) {
  const normalized = (Array.isArray(samples) ? samples : []).map((sample) => ({
    timestamp: sample?.timestamp || null,
    expectedDeltaMs: Number.isFinite(sample?.expectedDeltaMs) ? sample.expectedDeltaMs : null,
    actualDeltaMs: Number.isFinite(sample?.actualDeltaMs) ? sample.actualDeltaMs : null,
    driftMs: Number.isFinite(sample?.driftMs) ? sample.driftMs : null,
  })).filter((sample) => sample.driftMs !== null);
  const drifts = normalized.map((sample) => Math.max(0, sample.driftMs));
  return {
    expectedIntervalMs: normalized.find((sample) => sample.expectedDeltaMs !== null)?.expectedDeltaMs ?? 1_000,
    sampleCount: normalized.length,
    maxDriftMs: drifts.length ? Math.max(...drifts) : null,
    p95DriftMs: percentile(drifts, 95),
    samples: normalized,
  };
}

function deriveLatencyBuckets(timeline = {}) {
  return {
    appToSubmissionConfirmMs: latencyDelta(timeline.submitAttemptAt, timeline.submissionConfirmedAt),
    submissionToNetworkRequestMs: latencyDelta(timeline.submissionConfirmedAt, timeline.networkRequestStartedAt),
    networkRequestToFirstByteMs: latencyDelta(timeline.networkRequestStartedAt, timeline.networkFirstByteAt),
    firstByteToFirstDomMs: latencyDelta(timeline.networkFirstByteAt, timeline.firstQualifiedResponseDomAt),
    firstDomToFinalResponseMs: latencyDelta(timeline.firstQualifiedResponseDomAt, timeline.finalResponseVisibleAt),
    finalResponseToCaptureMs: latencyDelta(timeline.finalResponseVisibleAt, timeline.responseCapturedAt),
    totalCommandMs: latencyDelta(timeline.queuedAt, timeline.responseCapturedAt || timeline.timeoutAt),
  };
}

function candidateMetadata(candidate) {
  const { text: _text, turnText: _turnText, statusText: _statusText, finalResponseText: _finalResponseText, nestedCandidates: _nestedCandidates, contentCandidates: _contentCandidates, ...metadata } = candidate || {};
  return metadata;
}

function textLines(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function isStatusOnlyText(value) {
  const lines = textLines(value);
  return lines.length > 0 && lines.every((line) => STATUS_TEXT_PATTERNS.some((pattern) => pattern.test(line)));
}

function isMeaningfulResponseText(value) {
  const text = String(value || "").trim();
  return text.length > 0 && !isStatusOnlyText(text);
}

function scoreFinalResponseCandidate(candidate) {
  let score = 0;
  if (candidate?.isMessageContent) score += 10;
  if (candidate?.hasResponseData) score += 8;
  if (candidate?.hasMarkdownClass) score += 6;
  if (candidate?.hasMarkdownTestId) score += 5;
  if (candidate?.isPre || candidate?.isCode) score += 2;
  if (candidate?.accessibilityChrome) score -= 12;
  if (candidate?.statusLike) score -= 12;
  if (candidate?.insideComposer || candidate?.visible === false || candidate?.attached === false || candidate?.detached === true || candidate?.ariaHidden === true || candidate?.zeroSize === true) score -= 20;
  if (isMeaningfulResponseText(candidate?.text)) score += Math.min(5, Math.floor(String(candidate.text).trim().length / 120));
  return score;
}

function positiveFinalResponseSignals(candidate) {
  const signals = [];
  if (candidate?.isMessageContent === true) signals.push("MESSAGE_CONTENT");
  if (candidate?.hasResponseData === true) signals.push("RESPONSE_DATA_ATTRIBUTE");
  if (candidate?.hasMarkdownClass === true) signals.push("MARKDOWN_CLASS");
  if (candidate?.hasMarkdownTestId === true) signals.push("MARKDOWN_TEST_ID");
  return signals;
}

function finalResponseCandidateDiagnostic(candidate, score, qualified, rejectionReasons, positiveSignals) {
  return {
    candidateId: candidate?.candidateId || null,
    selector: candidate?.selector || null,
    tag: candidate?.tag || null,
    role: candidate?.role || null,
    className: candidate?.className || null,
    dataAttributeNames: Array.isArray(candidate?.dataAttributeNames) ? candidate.dataAttributeNames : [],
    score,
    positiveSignals,
    rejectionReasons,
    isMessageContent: candidate?.isMessageContent === true,
    isMarkdownContainer: candidate?.hasMarkdownClass === true || candidate?.hasMarkdownTestId === true,
    statusLike: candidate?.statusLike === true,
    accessibilityChrome: candidate?.accessibilityChrome === true,
    hidden: candidate?.ariaHidden === true || candidate?.visible === false || candidate?.zeroSize === true,
    detached: candidate?.detached === true || candidate?.attached === false,
    textLength: String(candidate?.text || "").length,
    textSample: String(candidate?.text || "").slice(0, 160),
    qualifiedFinalResponse: qualified,
  };
}

function extractFinalResponseContent(turn) {
  const candidates = Array.isArray(turn?.contentCandidates) ? turn.contentCandidates : [];
  const evaluated = candidates.map((candidate) => {
    const positiveSignals = positiveFinalResponseSignals(candidate);
    const rejectionReasons = [];
    if (!candidate) rejectionReasons.push("MISSING_CANDIDATE");
    if (candidate?.insideComposer === true) rejectionReasons.push("INSIDE_COMPOSER");
    if (candidate?.visible === false) rejectionReasons.push("HIDDEN_OR_NOT_VISIBLE");
    if (candidate?.attached === false || candidate?.detached === true) rejectionReasons.push("DETACHED");
    if (candidate?.ariaHidden === true) rejectionReasons.push("ARIA_HIDDEN");
    if (candidate?.zeroSize === true) rejectionReasons.push("ZERO_SIZE");
    if (candidate?.accessibilityChrome === true) rejectionReasons.push("ACCESSIBILITY_CHROME");
    if (candidate?.statusLike === true) rejectionReasons.push("STATUS_CHROME");
    if (!isMeaningfulResponseText(candidate?.text)) rejectionReasons.push("NON_MEANINGFUL_TEXT");
    if (positiveSignals.length === 0) rejectionReasons.push("NO_POSITIVE_RESPONSE_SIGNAL");
    const score = candidate ? scoreFinalResponseCandidate(candidate) : null;
    const qualified = rejectionReasons.length === 0;
    return { candidate, score, positiveSignals, rejectionReasons, qualified };
  });
  const eligible = evaluated
    .filter((entry) => entry.qualified)
    .map((entry) => ({ ...entry.candidate, score: entry.score }))
    .sort((left, right) => right.score - left.score || (right.contentDepth || 0) - (left.contentDepth || 0) || String(right.text || "").length - String(left.text || "").length);
  const diagnostics = evaluated.map((entry) => finalResponseCandidateDiagnostic(entry.candidate, entry.score, entry.qualified, entry.rejectionReasons, entry.positiveSignals));
  if (eligible.length) {
    const best = eligible[0];
    return { found: true, text: String(best.text || ""), candidate: candidateMetadata(best), selector: best.selector || best.domPath || best.candidateId, score: best.score, candidateCount: candidates.length, qualifiedCandidateCount: eligible.length, diagnostics };
  }
  return { found: false, text: "", candidate: null, selector: null, score: null, candidateCount: candidates.length, qualifiedCandidateCount: 0, diagnostics };
}

function normalizeGeminiResponseSnapshot(rawSnapshot, preSubmitSnapshot = null) {
  const rawCandidates = Array.isArray(rawSnapshot?.candidates) ? rawSnapshot.candidates : [];
  const preSubmitTurnIds = new Set((Array.isArray(preSubmitSnapshot?.assistantTurns) ? preSubmitSnapshot.assistantTurns : []).map((turn) => turn?.turnId || turn?.candidateId).filter(Boolean));
  const groups = new Map();
  for (const candidate of rawCandidates) {
    if (!candidate || candidate.insideComposer || candidate.role === "user" || candidate.visible === false || candidate.attached === false || candidate.detached === true || candidate.ariaHidden === true || candidate.zeroSize === true) continue;
    const turnId = candidate.parentTurnId || candidate.candidateId;
    if (!turnId) continue;
    const group = groups.get(turnId) || { turnId, candidates: [], orderIndex: Number.MAX_SAFE_INTEGER };
    group.candidates.push(candidate);
    group.orderIndex = Math.min(group.orderIndex, Number.isInteger(candidate.orderIndex) ? candidate.orderIndex : Number.MAX_SAFE_INTEGER);
    groups.set(turnId, group);
  }
  const metadataForCandidate = (candidate) => {
    const turnId = candidate?.parentTurnId || candidate?.candidateId;
    const existedBeforeSubmit = preSubmitTurnIds.has(turnId) || candidate?.existedBeforeSubmit === true;
    return { ...candidateMetadata(candidate), existedBeforeSubmit, appearedAfterSubmit: !existedBeforeSubmit, insidePreviousAssistantTurn: existedBeforeSubmit };
  };
  const assistantTurns = [...groups.values()]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((group) => {
      const root = group.candidates.find((candidate) => candidate.isTurnRoot) || group.candidates[0];
      const existedBeforeSubmit = preSubmitTurnIds.has(group.turnId) || group.candidates.some((candidate) => candidate.existedBeforeSubmit === true);
      return {
        ...candidateMetadata(root),
        turnId: group.turnId,
        candidateId: group.turnId,
        turnText: typeof root.text === "string" ? root.text : "",
        turnTextLength: Number.isInteger(root.textLength) ? root.textLength : String(root.text || "").length,
        turnTextHash: root.textHash || null,
        statusText: root.statusText || "",
        statusTextLength: String(root.statusText || "").length,
        statusTextHash: root.statusTextHash || null,
        contentCandidates: Array.isArray(root.contentCandidates) ? root.contentCandidates : [],
        contentExtractionAvailable: root.contentExtractionAvailable === true,
        nestedNodeCount: group.candidates.length,
        nestedCandidates: group.candidates.map(metadataForCandidate),
        existedBeforeSubmit,
        appearedAfterSubmit: !existedBeforeSubmit,
      };
    });
  const newTurns = assistantTurns.filter((turn) => turn.appearedAfterSubmit);
  const boundTurn = newTurns.length === 1 ? newTurns[0] : null;
  const extracted = boundTurn ? extractFinalResponseContent(boundTurn) : { found: false, text: "", candidate: null, selector: null, score: null };
  if (boundTurn) {
    boundTurn.finalResponseText = extracted.text;
    boundTurn.finalResponseTextLength = extracted.text.length;
    boundTurn.finalResponseTextHash = extracted.text ? hashText(extracted.text) : null;
    boundTurn.finalResponseBodyFound = extracted.found;
    boundTurn.finalResponseContainer = extracted.candidate;
    boundTurn.finalResponseSelector = extracted.selector;
    boundTurn.finalResponseCandidateCount = extracted.candidateCount;
    boundTurn.qualifiedFinalResponseCandidateCount = extracted.qualifiedCandidateCount;
    boundTurn.finalResponseCandidateDiagnostics = extracted.diagnostics;
    boundTurn.selectedFinalResponseCandidateIdentity = extracted.candidate?.candidateId || null;
  }
  return {
    responseCount: assistantTurns.length,
    assistantTurns,
    newTurns,
    newResponseCount: newTurns.length,
    boundTurn,
    responseText: extracted.text,
    responseNode: boundTurn ? candidateMetadata(boundTurn) : null,
    candidateMetadata: rawCandidates.map(metadataForCandidate),
    stopButtonPresent: rawSnapshot?.stopButtonPresent === true,
    streamingIndicatorPresent: rawSnapshot?.streamingIndicatorPresent === true,
    composerReady: rawSnapshot?.composerReady === true,
    conversationUrl: rawSnapshot?.conversationUrl || null,
    assistantTurnCount: Number.isInteger(rawSnapshot?.assistantTurnCount) ? rawSnapshot.assistantTurnCount : null,
    userTurnCount: Number.isInteger(rawSnapshot?.userTurnCount) ? rawSnapshot.userTurnCount : null,
    approximateMessageNodeCount: Number.isInteger(rawSnapshot?.approximateMessageNodeCount) ? rawSnapshot.approximateMessageNodeCount : null,
    userMessagePresent: rawSnapshot?.userMessagePresent === true,
    conversationMode: rawSnapshot?.conversationMode || null,
    domSnapshotSummary: rawSnapshot?.domSnapshotSummary || null,
  };
}

function isResponseComplete(snapshot, stablePolls, requiredStablePolls = 3) {
  const bound = snapshot?.boundTurn;
  const responseText = bound?.text ?? snapshot?.responseText;
  const finalResponseBodyFound = bound ? bound.finalResponseBodyFound === true : true;
  const stopButtonPresent = bound ? bound.stopButtonPresent === true : snapshot?.stopButtonPresent === true;
  const streamingIndicatorPresent = bound ? bound.streamingIndicatorPresent === true : snapshot?.streamingIndicatorPresent === true;
  const attached = bound ? bound.attached !== false && bound.detached !== true : snapshot?.boundTurnAttached !== false;
  return snapshot?.newResponseCount === 1
    && Boolean(responseText)
    && finalResponseBodyFound
    && stablePolls >= requiredStablePolls
    && stopButtonPresent === false
    && streamingIndicatorPresent === false
    && snapshot.composerReady === true
    && attached;
}

function describeResponseCompletion(snapshot, stablePolls, requiredStablePolls = 3) {
  const bound = snapshot?.boundTurn;
  const responseText = bound?.text ?? snapshot?.responseText;
  const finalResponseBodyFound = bound ? bound.finalResponseBodyFound === true : true;
  const stopButtonPresent = bound ? bound.stopButtonPresent === true : snapshot?.stopButtonPresent === true;
  const streamingIndicatorPresent = bound ? bound.streamingIndicatorPresent === true : snapshot?.streamingIndicatorPresent === true;
  const attached = bound ? bound.attached !== false && bound.detached !== true : snapshot?.boundTurnAttached !== false;
  const predicates = {
    uniqueResponseTurn: snapshot?.newResponseCount === 1,
    responseTextPresent: Boolean(responseText),
    finalResponseBodyFound,
    stablePollsReached: stablePolls >= requiredStablePolls,
    stopButtonAbsent: stopButtonPresent === false,
    streamingIndicatorAbsent: streamingIndicatorPresent === false,
    composerReady: snapshot?.composerReady === true,
    responseAttached: attached,
  };
  return {
    complete: Object.values(predicates).every(Boolean),
    failedPredicates: Object.entries(predicates).filter(([, value]) => !value).map(([name]) => name),
    predicates,
    stablePolls,
    requiredStablePolls,
    responseTextLength: String(responseText || "").length,
    responseTextHash: responseText ? hashText(responseText) : null,
    finalResponseTextLength: Number.isInteger(bound?.finalResponseTextLength) ? bound.finalResponseTextLength : null,
    finalResponseTextHash: bound?.finalResponseTextHash || null,
    candidateCount: Number.isInteger(bound?.finalResponseCandidateCount) ? bound.finalResponseCandidateCount : 0,
    qualifiedCandidateCount: Number.isInteger(bound?.qualifiedFinalResponseCandidateCount) ? bound.qualifiedFinalResponseCandidateCount : 0,
    selectedCandidateIdentity: bound?.selectedFinalResponseCandidateIdentity || null,
  };
}

function canRunFormatRetry(result) {
  const snapshot = result?.command?.snapshot ? result.command.snapshot() : null;
  return result?.ok === false && snapshot?.state === "INVALID_RESPONSE" && Boolean(snapshot.responseCapturedAt && snapshot.rawResponseHash);
}

function isGenerationTerminal(snapshot) {
  const bound = snapshot?.boundTurn;
  return Boolean(bound && bound.stopButtonPresent === false && bound.streamingIndicatorPresent === false && bound.attached !== false && snapshot?.composerReady === true);
}

function buildGeminiBindingDiagnostic({ command, beforeSnapshot, snapshot, timestamp = new Date().toISOString() }) {
  const metadata = command?.snapshot ? command.snapshot() : command || {};
  return {
    evidenceVersion: "gemini-binding-diagnostic-v1",
    timestamp,
    commandId: metadata.commandId,
    sessionId: metadata.sessionId,
    purpose: metadata.purpose,
    promptHash: metadata.promptHash,
    candidateCount: Array.isArray(snapshot?.newTurns) ? snapshot.newTurns.length : 0,
    candidateMetadata: Array.isArray(snapshot?.candidateMetadata) ? snapshot.candidateMetadata : [],
    preSubmitTurnCount: Array.isArray(beforeSnapshot?.assistantTurns) ? beforeSnapshot.assistantTurns.length : 0,
    postSubmitTurnCount: Array.isArray(snapshot?.assistantTurns) ? snapshot.assistantTurns.length : 0,
    domSnapshotSummary: snapshot?.domSnapshotSummary || null,
  };
}

function buildGeminiResponseContentDiagnostic({ command, beforeSnapshot, snapshot, reason, timestamp = new Date().toISOString() }) {
  const metadata = command?.snapshot ? command.snapshot() : command || {};
  const bound = snapshot?.boundTurn || null;
  return {
    evidenceVersion: "gemini-response-content-diagnostic-v1",
    timestamp,
    commandId: metadata.commandId,
    sessionId: metadata.sessionId,
    purpose: metadata.purpose,
    promptHash: metadata.promptHash,
    reason,
    preSubmitTurnCount: Array.isArray(beforeSnapshot?.assistantTurns) ? beforeSnapshot.assistantTurns.length : 0,
    postSubmitTurnCount: Array.isArray(snapshot?.assistantTurns) ? snapshot.assistantTurns.length : 0,
    responseTurnId: bound?.turnId || null,
    statusText: bound?.statusText || "",
    turnText: bound?.turnText || "",
    finalResponseText: bound?.finalResponseText || "",
    finalResponseBodyFound: bound?.finalResponseBodyFound === true,
    finalResponseSelector: bound?.finalResponseSelector || null,
    candidateCount: Number.isInteger(bound?.finalResponseCandidateCount) ? bound.finalResponseCandidateCount : 0,
    qualifiedCandidateCount: Number.isInteger(bound?.qualifiedFinalResponseCandidateCount) ? bound.qualifiedFinalResponseCandidateCount : 0,
    candidateDiagnostics: Array.isArray(bound?.finalResponseCandidateDiagnostics) ? bound.finalResponseCandidateDiagnostics : [],
    selectedCandidateIdentity: bound?.selectedFinalResponseCandidateIdentity || null,
    responseNode: snapshot?.responseNode || null,
    domSnapshotSummary: snapshot?.domSnapshotSummary || null,
  };
}

function assertParentTerminal(parentCommand) {
  if (parentCommand && !parentCommand.isTerminal()) throw new Error(`GEMINI_COMMAND_PARENT_NOT_TERMINAL: ${parentCommand.snapshot().commandId}`);
}

function isoNow(now) {
  return new Date(now()).toISOString();
}

class GeminiCommandLifecycle {
  constructor({ sessionId, purpose, prompt, parentCommandId = null, commandId = crypto.randomUUID(), now = Date.now, persist = () => {} }) {
    this.now = now;
    this.persist = persist;
    const queuedAt = isoNow(now);
    this.command = {
      commandId,
      parentCommandId,
      sessionId,
      purpose,
      promptHash: hashText(prompt),
      state: "QUEUED",
      commandQueuedAt: queuedAt,
      queuedAt,
      submitAttemptAt: null,
      sendRetryAt: null,
      composerClearedAt: null,
      userMessageRenderedAt: null,
      generatingUiStartedAt: null,
      stopButtonAppearedAt: null,
      networkRequestStartedAt: null,
      networkResponseHeadersAt: null,
      networkFirstByteAt: null,
      firstQualifiedResponseDomAt: null,
      firstResponseTextAt: null,
      finalResponseVisibleAt: null,
      responseCapturedAt: null,
      timeoutAt: null,
      lastResponseTextChangeAt: null,
      lastResponseTextLength: null,
      lastResponseTextHash: null,
      submissionConfirmed: false,
      submissionConfirmedAt: null,
      submissionConfirmationSource: null,
      submissionConfirmationSources: [],
      submissionState: "UNCONFIRMED",
      retryConfirmationState: "IDLE",
      retryEligibleAt: null,
      retryConfirmationPendingAt: null,
      retryCancelledAt: null,
      retryCancelledReason: null,
      retryCancelledSource: null,
      actualResendAt: null,
      sendRetryCount: 0,
      resendForbidden: false,
      promptCharacterLength: String(prompt ?? "").length,
      promptByteLength: Buffer.byteLength(String(prompt ?? ""), "utf8"),
    };
    this.latency = {
      submissionObservations: [],
      pageStates: [],
      rendererHeartbeat: { supported: null, samples: [] },
      networkRequests: [],
      networkGenerationRequestIdentified: false,
      conversation: { mode: null, assistantTurnCountBeforeSubmit: null, userTurnCountBeforeSubmit: null, approximateMessageNodeCount: null, url: null },
      responseProgress: [],
      completionEvaluations: [],
      domMutationSummary: { supported: null, mutationCount: 0, contentMutationCount: 0, nonContentMutationCount: 0, lastContentMutationAt: null, lastNonContentMutationAt: null, samples: [] },
    };
    this.emit("QUEUED");
  }

  emit(event) {
    this.persist({ event, ...this.command });
  }

  transition(nextState, patch = {}) {
    const current = this.command.state;
    if (current !== nextState && !TRANSITIONS[current]?.has(nextState)) {
      throw new Error(`GEMINI_COMMAND_INVALID_TRANSITION: ${current}->${nextState}`);
    }
    Object.assign(this.command, patch, { state: nextState });
    this.emit(nextState);
    return this.snapshot();
  }

  markSubmitted() {
    const at = isoNow(this.now);
    return this.transition("SUBMITTED", { commandSentAt: at });
  }

  markSubmitAttempt(at = isoNow(this.now)) {
    if (!this.command.submitAttemptAt) this.command.submitAttemptAt = at;
    this.emit("SUBMIT_ATTEMPT");
    return this.snapshot();
  }

  observeSubmission(snapshot, at = isoNow(this.now)) {
    const firstObservation = this.latency.submissionObservations.length === 0;
    const hadComposerCleared = Boolean(this.command.composerClearedAt);
    const hadUserMessage = Boolean(this.command.userMessageRenderedAt);
    const hadGeneratingUi = Boolean(this.command.generatingUiStartedAt);
    const hadStopButton = Boolean(this.command.stopButtonAppearedAt);
    const observation = {
      at,
      composerHasPrompt: snapshot?.composerReady === false ? true : snapshot?.composerReady === true ? false : null,
      composerCleared: snapshot?.composerReady === true,
      userMessagePresent: snapshot?.userMessagePresent === true,
      generationIndicatorPresent: snapshot?.stopButtonPresent === true || snapshot?.streamingIndicatorPresent === true,
      responseTurnPresent: snapshot?.newResponseCount === 1,
    };
    this.latency.submissionObservations.push(observation);
    if (observation.composerCleared && !this.command.composerClearedAt) this.command.composerClearedAt = at;
    if (observation.userMessagePresent && !this.command.userMessageRenderedAt) this.command.userMessageRenderedAt = at;
    if (observation.generationIndicatorPresent && !this.command.generatingUiStartedAt) this.command.generatingUiStartedAt = at;
    if (snapshot?.stopButtonPresent === true && !this.command.stopButtonAppearedAt) this.command.stopButtonAppearedAt = at;
    const domConfirmationSource = submissionConfirmationSource(snapshot);
    if (domConfirmationSource && !this.command.submissionConfirmationSources.includes(domConfirmationSource)) this.command.submissionConfirmationSources.push(domConfirmationSource);
    if (!this.command.submissionConfirmed && domConfirmationSource) {
      this.command.submissionConfirmed = true;
      this.command.submissionConfirmedAt = at;
      this.command.submissionConfirmationSource = domConfirmationSource;
      this.command.submissionState = "CONFIRMED";
    }
    if (domConfirmationSource && this.command.retryConfirmationState === "RETRY_CONFIRMATION_PENDING") this.cancelRetry("SUBMISSION_CONFIRMED", domConfirmationSource, at);
    if (this.latency.conversation.assistantTurnCountBeforeSubmit === null && Number.isInteger(snapshot?.assistantTurnCount)) {
      this.latency.conversation.assistantTurnCountBeforeSubmit = snapshot.assistantTurnCount;
      this.latency.conversation.userTurnCountBeforeSubmit = Number.isInteger(snapshot.userTurnCount) ? snapshot.userTurnCount : null;
      this.latency.conversation.approximateMessageNodeCount = Number.isInteger(snapshot.approximateMessageNodeCount) ? snapshot.approximateMessageNodeCount : null;
      this.latency.conversation.url = snapshot.conversationUrl || null;
      this.latency.conversation.mode = snapshot.conversationMode || null;
    }
    if (firstObservation || (!hadComposerCleared && this.command.composerClearedAt) || (!hadUserMessage && this.command.userMessageRenderedAt) || (!hadGeneratingUi && this.command.generatingUiStartedAt) || (!hadStopButton && this.command.stopButtonAppearedAt)) this.emit("SUBMISSION_OBSERVED");
    return observation;
  }

  markSendRetry(reason, snapshot, at = isoNow(this.now)) {
    if (this.command.resendForbidden || this.command.submissionConfirmed) {
      this.emit("ACTUAL_RESEND_BLOCKED");
      return this.snapshot();
    }
    this.command.sendRetryAt = at;
    this.command.actualResendAt = at;
    this.command.sendRetryCount += 1;
    this.command.retryConfirmationState = "ACTUAL_RESEND";
    this.command.sendRetryReason = reason || null;
    this.command.sendRetrySnapshot = snapshot || null;
    this.emit("ACTUAL_RESEND");
    return this.snapshot();
  }

  markRetryEligible(at = isoNow(this.now)) {
    if (this.command.submissionConfirmed || this.command.resendForbidden) return this.snapshot();
    this.command.retryEligibleAt = at;
    this.command.retryConfirmationPendingAt = at;
    this.command.retryConfirmationState = "RETRY_CONFIRMATION_PENDING";
    this.command.resendForbidden = false;
    this.emit("RETRY_ELIGIBLE");
    return this.snapshot();
  }

  cancelRetry(reason, source, at = isoNow(this.now)) {
    this.command.retryCancelledAt = at;
    this.command.retryCancelledReason = reason || null;
    this.command.retryCancelledSource = source || null;
    this.command.retryConfirmationState = "RETRY_CANCELLED";
    this.command.resendForbidden = true;
    this.emit("RETRY_CANCELLED");
    return this.snapshot();
  }

  markSubmissionUncertain(reason = "REMOTE_CONTEXT_NOT_READY", at = isoNow(this.now)) {
    this.command.submissionState = "UNCERTAIN";
    this.command.submissionUncertainAt = at;
    this.command.submissionUncertainReason = reason;
    this.emit("SUBMISSION_STATE_UNCERTAIN");
    return this.snapshot();
  }

  confirmSubmissionByNetwork(request) {
    const at = request?.startedAt || isoNow(this.now);
    if (!this.command.submissionConfirmationSources.includes("NETWORK_GENERATION_REQUEST")) this.command.submissionConfirmationSources.push("NETWORK_GENERATION_REQUEST");
    if (!this.command.submissionConfirmed) {
      this.command.submissionConfirmed = true;
      this.command.submissionConfirmedAt = at;
      this.command.submissionConfirmationSource = "NETWORK_GENERATION_REQUEST";
      this.command.submissionState = "CONFIRMED";
    }
    if (this.command.retryConfirmationState === "RETRY_CONFIRMATION_PENDING") this.cancelRetry("SUBMISSION_CONFIRMED", "NETWORK_GENERATION_REQUEST", at);
    this.emit("SUBMISSION_CONFIRMED_BY_NETWORK");
    return this.snapshot();
  }

  recordPageState(milestone, state, at = isoNow(this.now)) {
    this.latency.pageStates.push({ milestone, at, ...state });
    this.emit("PAGE_STATE_OBSERVED");
    return this.snapshot();
  }

  recordConversationState(state = {}) {
    if (this.latency.conversation.url !== null || this.latency.conversation.assistantTurnCountBeforeSubmit !== null || this.latency.conversation.userTurnCountBeforeSubmit !== null || this.latency.conversation.approximateMessageNodeCount !== null) return this.snapshot();
    this.latency.conversation = {
      mode: state.mode || null,
      assistantTurnCountBeforeSubmit: Number.isInteger(state.assistantTurnCount) ? state.assistantTurnCount : null,
      userTurnCountBeforeSubmit: Number.isInteger(state.userTurnCount) ? state.userTurnCount : null,
      approximateMessageNodeCount: Number.isInteger(state.approximateMessageNodeCount) ? state.approximateMessageNodeCount : null,
      url: state.url || null,
    };
    return this.snapshot();
  }

  recordRendererHeartbeat(heartbeat) {
    this.latency.rendererHeartbeat = heartbeat || { supported: null, samples: [] };
    return this.snapshot();
  }

  recordNetworkTimeline({ requests = [], generationRequestIdentified = false } = {}) {
    this.latency.networkRequests = Array.isArray(requests) ? requests : [];
    this.latency.networkGenerationRequestIdentified = generationRequestIdentified === true;
    const generation = this.latency.networkGenerationRequestIdentified ? this.latency.networkRequests.find((request) => request.isGenerationRequest === true) : null;
    this.command.networkRequestStartedAt = generation?.startedAt || null;
    this.command.networkResponseHeadersAt = generation?.responseHeadersAt || null;
    this.command.networkFirstByteAt = generation?.firstDataAt || null;
    this.emit("NETWORK_TIMELINE_OBSERVED");
    return this.snapshot();
  }

  recordResponseProgress(snapshot, stablePolls = 0, at = isoNow(this.now)) {
    const bound = snapshot?.boundTurn;
    const responseText = typeof snapshot?.responseText === "string" ? snapshot.responseText : "";
    const responseTextHash = responseText ? hashText(responseText) : null;
    const previousLength = this.command.lastResponseTextLength;
    const previousHash = this.command.lastResponseTextHash;
    if (responseText && (previousLength !== responseText.length || previousHash !== responseTextHash)) {
      this.command.lastResponseTextChangeAt = at;
      this.command.lastResponseTextLength = responseText.length;
      this.command.lastResponseTextHash = responseTextHash;
    }
    const progress = {
      at,
      responseTextLength: responseText.length,
      responseTextHash,
      turnTextLength: Number.isInteger(bound?.turnTextLength) ? bound.turnTextLength : null,
      turnTextHash: bound?.turnTextHash || null,
      finalResponseTextLength: Number.isInteger(bound?.finalResponseTextLength) ? bound.finalResponseTextLength : null,
      finalResponseTextHash: bound?.finalResponseTextHash || null,
      newResponseCount: Number.isInteger(snapshot?.newResponseCount) ? snapshot.newResponseCount : null,
      candidateCount: Number.isInteger(bound?.finalResponseCandidateCount) ? bound.finalResponseCandidateCount : 0,
      qualifiedCandidateCount: Number.isInteger(bound?.qualifiedFinalResponseCandidateCount) ? bound.qualifiedFinalResponseCandidateCount : 0,
      selectedCandidateIdentity: bound?.selectedFinalResponseCandidateIdentity || null,
      finalResponseBodyFound: bound?.finalResponseBodyFound === true,
      stopButtonPresent: bound ? bound.stopButtonPresent === true : snapshot?.stopButtonPresent === true,
      streamingIndicatorPresent: bound ? bound.streamingIndicatorPresent === true : snapshot?.streamingIndicatorPresent === true,
      composerReady: snapshot?.composerReady === true,
      attached: bound ? bound.attached !== false && bound.detached !== true : snapshot?.boundTurnAttached !== false,
      stablePolls,
    };
    this.latency.responseProgress.push(progress);
    if (this.latency.responseProgress.length > 512) this.latency.responseProgress.shift();
    return this.snapshot();
  }

  recordCompletionEvaluation(snapshot, stablePolls = 0, requiredStablePolls = 3, at = isoNow(this.now)) {
    const evaluation = { at, ...describeResponseCompletion(snapshot, stablePolls, requiredStablePolls) };
    this.latency.completionEvaluations.push(evaluation);
    if (this.latency.completionEvaluations.length > 512) this.latency.completionEvaluations.shift();
    return this.snapshot();
  }

  recordDomMutationSummary(summary) {
    this.latency.domMutationSummary = summary || { supported: null, mutationCount: 0, contentMutationCount: 0, nonContentMutationCount: 0, lastContentMutationAt: null, lastNonContentMutationAt: null, samples: [] };
    return this.snapshot();
  }

  markGenerating() {
    return this.transition("GENERATING");
  }

  markResponseStarted(responseNode) {
    if (!this.command.responseStartedAt) {
      this.command.responseStartedAt = isoNow(this.now);
      this.command.responseNode = responseNode ?? null;
      if (responseNode?.finalResponseBodyFound === true && !this.command.firstQualifiedResponseDomAt) this.command.firstQualifiedResponseDomAt = this.command.responseStartedAt;
      if (Number.isInteger(responseNode?.finalResponseTextLength) && responseNode.finalResponseTextLength > 0 && !this.command.firstResponseTextAt) this.command.firstResponseTextAt = this.command.responseStartedAt;
      this.emit("RESPONSE_STARTED");
    }
    return this.snapshot();
  }

  markResponseComplete(metadata = {}) {
    const at = isoNow(this.now);
    if (!this.command.finalResponseVisibleAt) this.command.finalResponseVisibleAt = at;
    return this.transition("RESPONSE_COMPLETE", { responseCompletedAt: at, responseNode: metadata.responseNode ?? this.command.responseNode ?? null, responseMetadata: metadata });
  }

  captureRawResponse(rawResponse, responseNode) {
    const raw = String(rawResponse ?? "");
    return this.transition("RESPONSE_CAPTURED", {
      responseCapturedAt: isoNow(this.now),
      rawResponseHash: hashText(raw),
      rawResponseLength: raw.length,
      responseNode: responseNode ?? this.command.responseNode ?? null,
    });
  }

  markParseStarted() {
    this.command.parseStartedAt = isoNow(this.now);
    this.emit("PARSE_STARTED");
    return this.snapshot();
  }

  markParsed() {
    this.command.parseFinishedAt = isoNow(this.now);
    return this.transition("PARSED", { parseFinishedAt: this.command.parseFinishedAt });
  }

  markValidated() {
    return this.transition("VALIDATED", { parseFinishedAt: this.command.parseFinishedAt ?? isoNow(this.now) });
  }

  markInvalidResponse(error) {
    this.command.parseFinishedAt = this.command.parseFinishedAt ?? isoNow(this.now);
    return this.transition("INVALID_RESPONSE", { parseError: String(error ?? "INVALID_RESPONSE"), parseFinishedAt: this.command.parseFinishedAt });
  }

  markTimeout(error) {
    return this.transition("TIMEOUT", { timeoutAt: isoNow(this.now), error: String(error ?? "GEMINI_COMMAND_TIMEOUT") });
  }

  markFailed(error) {
    return this.transition("FAILED", { error: String(error ?? "GEMINI_COMMAND_FAILED") });
  }

  markNextCommandSent(at = isoNow(this.now)) {
    this.command.nextCommandSentAt = at;
    this.emit("NEXT_COMMAND_SENT");
    return this.snapshot();
  }

  snapshot() {
    return { ...this.command };
  }

  latencySnapshot() {
    const timeline = this.snapshot();
    return {
      ...timeline,
      submissionObservations: [...this.latency.submissionObservations],
      pageStates: [...this.latency.pageStates],
      rendererHeartbeat: summarizeRendererHeartbeat(this.latency.rendererHeartbeat?.samples || []),
      rendererHeartbeatSupported: this.latency.rendererHeartbeat?.supported ?? null,
      networkGenerationRequestIdentified: this.latency.networkGenerationRequestIdentified,
      networkRequests: [...this.latency.networkRequests],
      conversation: { ...this.latency.conversation },
      responseProgress: [...this.latency.responseProgress],
      completionEvaluations: [...this.latency.completionEvaluations],
      domMutationSummary: { ...this.latency.domMutationSummary, samples: [...(this.latency.domMutationSummary?.samples || [])] },
      derivedLatencyMs: deriveLatencyBuckets(timeline),
    };
  }

  isTerminal() {
    return TERMINAL_STATES.has(this.command.state);
  }
}

module.exports = { GeminiCommandLifecycle, TERMINAL_STATES, FINAL_RESPONSE_SELECTORS, POSITIVE_FINAL_RESPONSE_SIGNALS, LATENCY_PAGE_MILESTONES, STATUS_NODE_SELECTORS, ACCESSIBILITY_CHROME_SELECTORS, hashText, redactNetworkUrl, normalizeNetworkInitiator, normalizeDocumentNavigationRequest, extractGeminiJsonCandidate, isGeminiGenerationRequest, findAttributedGeminiGenerationRequest, submissionConfirmationSource, shouldRetryGeminiSend, authorizeGeminiSendRetry, isGeminiTargetReady, deriveLatencyBuckets, summarizeRendererHeartbeat, isResponseComplete, describeResponseCompletion, canRunFormatRetry, isGenerationTerminal, assertParentTerminal, normalizeGeminiResponseSnapshot, buildGeminiBindingDiagnostic, buildGeminiResponseContentDiagnostic, extractFinalResponseContent, positiveFinalResponseSignals, isStatusOnlyText };
