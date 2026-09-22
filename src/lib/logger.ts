import { redactSensitive } from "./redaction";

type LogContext = Record<string, unknown>;
type LogLevel = "debug" | "info" | "warn" | "error";

const levelRank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): LogLevel {
  const value = process.env.LOG_LEVEL;
  return value === "debug" || value === "warn" || value === "error" ? value : "info";
}

function write(level: LogLevel, message: string, context: LogContext = {}) {
  if (levelRank[level] < levelRank[configuredLevel()]) return;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : level === "debug" ? console.debug : console.info;
  sink(JSON.stringify(redactSensitive({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  })));
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};
