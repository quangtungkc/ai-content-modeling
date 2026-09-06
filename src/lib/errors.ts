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
  return Response.json(
    { error: { code: appError.code, message: appError.message, details: appError.details }, requestId },
    { status: appError.status },
  );
}
