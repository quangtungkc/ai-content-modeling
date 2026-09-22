import { logger } from "./logger";
import { redactSensitive, safeErrorContext } from "./redaction";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function toErrorResponse(error: unknown, requestId: string) {
  const appError = error instanceof AppError ? error : new AppError("INTERNAL_ERROR", "Đã xảy ra lỗi nội bộ.");
  if (!(error instanceof AppError)) logger.error("Unhandled application error", { requestId, error: safeErrorContext(error) });
  const details = process.env.NODE_ENV === "production" ? undefined : redactSensitive(appError.details);
  return Response.json(
    { error: { code: appError.code, message: appError.message, ...(details === undefined ? {} : { details }) }, requestId },
    { status: appError.status },
  );
}
