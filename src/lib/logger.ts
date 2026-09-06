type LogContext = Record<string, unknown>;

function write(level: string, message: string, context: LogContext = {}) {
  console[level as "info" | "warn" | "error"](JSON.stringify({
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  }));
}

export const logger = {
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};
