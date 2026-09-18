function isJsonSerializable(value, seen = new Set()) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (typeof value === "undefined" || typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isJsonSerializable(item, seen));
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  return Object.values(value).every((item) => isJsonSerializable(item, seen));
}

function wrapGeminiRemoteExpression(expression, phase) {
  if (typeof expression !== "string" || !expression.trim()) throw new Error("GEMINI_REMOTE_ARGUMENT_SERIALIZATION: expression must be a non-empty string");
  if (typeof phase !== "string" || !phase) throw new Error("GEMINI_REMOTE_ARGUMENT_SERIALIZATION: phase is required");
  return `(async () => { try { return { ok: true, value: await (${expression}) }; } catch (error) { return { ok: false, remoteError: { code: "GEMINI_REMOTE_SCRIPT_EXCEPTION", phase: ${JSON.stringify(phase)}, name: error?.name || "Error", message: error?.message || String(error), stack: error?.stack || null, sourceUrl: location.href, line: error?.lineNumber || null, column: error?.columnNumber || null, timestamp: new Date().toISOString() } }; } })()`;
}

function normalizeRemoteFailure(error, context = {}) {
  const remote = error?.remoteError || {};
  return {
    code: remote.code || context.code || "GEMINI_REMOTE_SCRIPT_EXECUTION_FAILED",
    phase: remote.phase || context.phase || "UNKNOWN",
    name: remote.name || error?.name || "Error",
    message: remote.message || error?.message || String(error),
    stack: remote.stack || error?.stack || null,
    sourceUrl: remote.sourceUrl || context.sourceUrl || null,
    line: remote.line ?? null,
    column: remote.column ?? null,
    selector: context.selector || null,
    targetId: context.targetId ?? null,
    executionContextId: context.executionContextId ?? null,
    commandPurpose: context.commandPurpose || null,
    timestamp: remote.timestamp || new Date().toISOString(),
    pageReady: context.pageReady === true,
    correctGeminiTab: context.correctGeminiTab === true,
  };
}

module.exports = { isJsonSerializable, wrapGeminiRemoteExpression, normalizeRemoteFailure };
