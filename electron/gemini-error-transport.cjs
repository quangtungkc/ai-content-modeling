function redactTransportValue(value) {
  if (typeof value === "string") return value.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b|\b(?:sk|sess|pat|ghp|AIza)[-_A-Za-z0-9]{12,}\b|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|client[_-]?secret|encryption[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi, "[REDACTED]");
  if (Array.isArray(value)) return value.map(redactTransportValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|client[_-]?secret|encryption[_-]?key|credential|credentials)$/i.test(key) ? "[REDACTED]" : redactTransportValue(item)]));
  return value;
}

function serializeGeminiError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "GEMINI_BROWSER_FAILED");
  const context = error?.details && typeof error.details === "object"
    ? error.details
    : error?.context && typeof error.context === "object"
      ? error.context
      : {};
  const code = typeof error?.code === "string"
    ? error.code
    : typeof context.code === "string"
      ? context.code
      : null;
  const firstDivergence = typeof error?.firstDivergence === "string"
    ? error.firstDivergence
    : typeof context.firstDivergence === "string"
      ? context.firstDivergence
      : code;
  const cause = typeof error?.cause === "string"
    ? error.cause
    : typeof context.cause === "string"
      ? context.cause
      : null;
  return redactTransportValue({ code, message, firstDivergence, cause, details: context });
}

function reviveStructuredError(payload) {
  const error = new Error(typeof payload?.message === "string" ? payload.message : "Desktop Gemini request failed.");
  error.name = "DesktopStructuredError";
  if (payload && typeof payload === "object") Object.assign(error, payload);
  return error;
}

module.exports = { serializeGeminiError, reviveStructuredError };
