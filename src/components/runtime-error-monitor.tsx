"use client";

import { useEffect } from "react";

type RuntimeFailurePayload = {
  source: string;
  code?: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
};

const pendingKey = "viral-content-modeling:runtime-failures";
const secretText = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b|\b(?:sk|sess|pat|ghp|AIza)[-_A-Za-z0-9]{12,}\b|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|client[_-]?secret|encryption[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi;
const secretName = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|client[_-]?secret|encryption[_-]?key|credential|credentials)$/i;
function redactClient(value: unknown): unknown {
  if (typeof value === "string") return value.replace(secretText, "[REDACTED]");
  if (Array.isArray(value)) return value.map(redactClient);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretName.test(key) ? "[REDACTED]" : redactClient(item)]));
  return value;
}
const pathOf = (input: RequestInfo | URL) => {
  try { return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin).pathname; } catch { return "unknown"; }
};

function errorPayload(error: unknown, source: string, context: Record<string, unknown> = {}): RuntimeFailurePayload {
  if (error instanceof Error) return { source, message: error.message || "Unknown client error.", stack: error.stack, context };
  return { source, message: typeof error === "string" ? error : "Unknown client error.", context };
}

export function RuntimeErrorMonitor() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let flushing = false;

    const readPending = (): RuntimeFailurePayload[] => {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(pendingKey) ?? "[]");
        return Array.isArray(parsed) ? parsed.slice(-30) as RuntimeFailurePayload[] : [];
      } catch { return []; }
    };
    const writePending = (items: RuntimeFailurePayload[]) => {
      try { window.localStorage.setItem(pendingKey, JSON.stringify(items.slice(-30))); } catch { /* Storage can be unavailable in private contexts. */ }
    };
    const flush = async () => {
      if (flushing || !navigator.onLine) return;
      flushing = true;
      try {
        const pending = readPending();
        const remaining: RuntimeFailurePayload[] = [];
        for (const item of pending) {
          try {
            const response = await originalFetch("/api/v1/runtime-failures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item), keepalive: true });
            if (!response.ok) remaining.push(item);
          } catch { remaining.push(item); }
        }
        writePending(remaining);
      } finally { flushing = false; }
    };
    const report = (item: RuntimeFailurePayload) => {
      const safe = redactClient(item) as RuntimeFailurePayload;
      const normalized = { ...safe, message: safe.message.slice(0, 4_000), stack: safe.stack?.slice(0, 12_000), context: { pathname: window.location.pathname, online: navigator.onLine, ...safe.context } };
      writePending([...readPending(), normalized]);
      void flush();
    };
    const onError = (event: ErrorEvent) => report(errorPayload(event.error ?? event.message, "renderer:window-error", { filename: event.filename, line: event.lineno, column: event.colno }));
    const onRejection = (event: PromiseRejectionEvent) => report(errorPayload(event.reason, "renderer:unhandled-rejection"));
    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent<RuntimeFailurePayload>).detail;
      if (detail?.message) report(detail);
    };
    const onOnline = () => void flush();
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("app-runtime-failure", onCustom);
    window.addEventListener("online", onOnline);
    window.fetch = async (input, init) => {
      const path = pathOf(input);
      try {
        const response = await originalFetch(input, init);
        if (response.status >= 500 && !path.endsWith("/runtime-failures")) report({ source: "renderer:api-5xx", code: `HTTP_${response.status}`, message: `API trả về HTTP ${response.status}.`, context: { path, method: init?.method ?? (input instanceof Request ? input.method : "GET") } });
        return response;
      } catch (error) {
        if (!path.endsWith("/runtime-failures")) report(errorPayload(error, "renderer:network", { path }));
        throw error;
      }
    };
    void flush();
    return () => {
      window.fetch = originalFetch;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("app-runtime-failure", onCustom);
      window.removeEventListener("online", onOnline);
    };
  }, []);
  return null;
}

export function notifyRuntimeFailure(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const payload = errorPayload(error, "renderer:handled-error", context);
  window.dispatchEvent(new CustomEvent("app-runtime-failure", { detail: payload }));
}
