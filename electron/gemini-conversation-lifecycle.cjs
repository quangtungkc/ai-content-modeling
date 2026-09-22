const CONVERSATION_STATES = new Set(["UNBOUND", "ACTIVE", "CLEANUP_PENDING", "DELETED"]);

function extractGeminiConversationId(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (parsed.origin.toLowerCase() !== "https://gemini.google.com") return null;
    const match = parsed.pathname.match(/^\/app\/([^/]+)\/?$/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function conversationIdFromUrl(value) {
  return extractGeminiConversationId(value);
}

function conversationNavigationDisposition(requestedUrl, observedUrl) {
  const expectedId = conversationIdFromUrl(requestedUrl);
  if (!expectedId) return "NOT_CONVERSATION";
  const observedId = conversationIdFromUrl(observedUrl);
  if (observedId === expectedId) return "MATCH";
  try {
    const observed = new URL(String(observedUrl || ""));
    if (observed.origin.toLowerCase() === "https://accounts.google.com") return "AUTH_REQUIRED";
    if (observed.origin.toLowerCase() === "https://gemini.google.com" && /^\/app\/?$/i.test(observed.pathname)) return "RETRY";
  } catch {
    // The identity check below remains fail-closed for malformed URLs.
  }
  return "MISMATCH";
}

function conversationUrl(value) {
  if (typeof value !== "string") return null;
  return extractGeminiConversationId(value) ? value : null;
}

function isBareGeminiAppUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.origin.toLowerCase() === "https://gemini.google.com" && /^\/app\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function normalizeConversationBinding(value, runId) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const id = typeof raw.geminiConversationId === "string" && raw.geminiConversationId.trim() ? raw.geminiConversationId.trim() : null;
  const url = conversationUrl(raw.geminiConversationUrl);
  const owner = typeof raw.geminiConversationOwnerRunId === "string" && raw.geminiConversationOwnerRunId.trim() ? raw.geminiConversationOwnerRunId.trim() : null;
  const state = CONVERSATION_STATES.has(raw.geminiConversationState) ? raw.geminiConversationState : id && url ? "ACTIVE" : "UNBOUND";
  if ((id || url) && (!id || !url || conversationIdFromUrl(url) !== id)) throw new Error("GEMINI_CONVERSATION_BINDING_INVALID");
  if (owner && owner !== runId) throw new Error("GEMINI_CONVERSATION_OWNER_MISMATCH");
  return {
    geminiConversationId: id,
    geminiConversationUrl: url,
    geminiConversationOwnerRunId: owner || runId || null,
    geminiConversationState: state,
    geminiConversationCreatedAt: typeof raw.geminiConversationCreatedAt === "string" ? raw.geminiConversationCreatedAt : null,
    geminiConversationDeletedAt: typeof raw.geminiConversationDeletedAt === "string" ? raw.geminiConversationDeletedAt : null,
    lastGeminiStage: typeof raw.lastGeminiStage === "string" ? raw.lastGeminiStage : null,
    lastGeminiCommandId: typeof raw.lastGeminiCommandId === "string" ? raw.lastGeminiCommandId : null,
  };
}

function bindConversationFromUrl(existing, runId, url, stage, commandId, at = new Date().toISOString()) {
  const current = normalizeConversationBinding(existing, runId);
  const id = conversationIdFromUrl(url);
  const normalizedUrl = conversationUrl(url);
  if (!id || !normalizedUrl) throw new Error("GEMINI_CONVERSATION_URL_NOT_RESOLVED");
  if (current.geminiConversationId && (current.geminiConversationId !== id || current.geminiConversationUrl !== normalizedUrl)) throw new Error("GEMINI_CONVERSATION_REBIND_FORBIDDEN");
  return {
    ...current,
    geminiConversationId: id,
    geminiConversationUrl: normalizedUrl,
    geminiConversationOwnerRunId: runId,
    geminiConversationState: "ACTIVE",
    geminiConversationCreatedAt: current.geminiConversationCreatedAt || at,
    geminiConversationDeletedAt: null,
    lastGeminiStage: stage || current.lastGeminiStage,
    lastGeminiCommandId: commandId || current.lastGeminiCommandId,
  };
}

function markConversationStep(existing, runId, stage, commandId, at = new Date().toISOString()) {
  const current = normalizeConversationBinding(existing, runId);
  return { ...current, geminiConversationOwnerRunId: runId, lastGeminiStage: stage || current.lastGeminiStage, lastGeminiCommandId: commandId || current.lastGeminiCommandId, updatedAt: at };
}

function markConversationStale(existing, runId, stage, at = new Date().toISOString()) {
  const current = normalizeConversationBinding(existing, runId);
  if (!current.geminiConversationId || !current.geminiConversationUrl) throw new Error("GEMINI_CONVERSATION_STALE_BINDING_MISSING");
  return {
    ...current,
    geminiConversationOwnerRunId: runId,
    geminiConversationState: "DELETED",
    geminiConversationDeletedAt: at,
    lastGeminiStage: stage || current.lastGeminiStage,
  };
}

function assertConversationReady(binding, runId, currentUrl) {
  const normalized = normalizeConversationBinding(binding, runId);
  if (normalized.geminiConversationState !== "ACTIVE" || !normalized.geminiConversationId || !normalized.geminiConversationUrl) throw new Error("GEMINI_CONVERSATION_NOT_ACTIVE");
  if (normalized.geminiConversationOwnerRunId !== runId) throw new Error("GEMINI_CONVERSATION_OWNER_MISMATCH");
  if (extractGeminiConversationId(currentUrl) !== normalized.geminiConversationId) throw new Error("GEMINI_CONVERSATION_URL_MISMATCH");
  return normalized;
}

module.exports = { CONVERSATION_STATES, extractGeminiConversationId, conversationIdFromUrl, conversationNavigationDisposition, conversationUrl, isBareGeminiAppUrl, normalizeConversationBinding, bindConversationFromUrl, markConversationStep, markConversationStale, assertConversationReady };
