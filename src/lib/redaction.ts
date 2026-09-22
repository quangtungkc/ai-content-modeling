const SENSITIVE_KEY = /(?:password|passphrase|token|secret|authorization|cookie|api[-_]?key|credential|private[-_]?key|client[-_]?secret|encryption[-_]?key)/i;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi;
const KNOWN_TOKEN = /\b(?:sk|sess|pat|ghp|AIza)[-_A-Za-z0-9]{12,}\b/g;
const INLINE_SECRET = /\b(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret|authorization|cookie|credential)\b\s*[:=]\s*[^\s,;]+/gi;

function redactText(value: string) {
  return value.replace(BEARER_TOKEN, "[REDACTED]").replace(KNOWN_TOKEN, "[REDACTED]").replace(INLINE_SECRET, (match) => `${match.split(/[:=]/, 1)[0]}=[REDACTED]`);
}

/** Redact secrets before a value is written to logs or sent to diagnostics. */
export function redactSensitive<T>(value: T): T {
  const seen = new WeakSet<object>();

  const visit = (current: unknown): unknown => {
    if (typeof current === "string") return redactText(current);
    if (current === null || typeof current !== "object") return current;
    if (seen.has(current)) return "[Circular]";
    seen.add(current);
    if (current instanceof Error) {
      return {
        name: current.name,
        message: redactText(current.message),
        stack: current.stack ? redactText(current.stack) : undefined,
      };
    }
    if (Array.isArray(current)) return current.map(visit);
    return Object.fromEntries(Object.entries(current).map(([key, child]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : visit(child)]));
  };

  return visit(value) as T;
}

export function safeErrorContext(error: unknown) {
  return redactSensitive(error instanceof Error ? error : { error: String(error) });
}
