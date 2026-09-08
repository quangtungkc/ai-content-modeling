import { AppError } from "@/lib/errors";

export class AIProviderNotConfiguredError extends AppError {
  constructor(provider: string) { super("AI_PROVIDER_NOT_CONFIGURED", `${provider} chưa được cấu hình API key.`, 503); }
}

export class AIStructuredOutputError extends AppError {
  constructor(provider: string, details?: unknown) {
    const status = details && typeof details === "object" && "status" in details ? Number((details as { status?: unknown }).status) : 0;
    const apiMessage = typeof details === "string" ? details : details && typeof details === "object" && "message" in details && typeof (details as { message?: unknown }).message === "string"
      ? (details as { message: string }).message
      : "";
    const message = status === 401 || status === 403
      ? `${provider} API key không hợp lệ hoặc chưa được cấp quyền.`
      : status === 429
        ? `${provider} đã vượt hạn mức miễn phí. Hãy thử lại sau hoặc bật Billing.`
        : apiMessage
          ? `${provider}: ${apiMessage}`
          : `${provider} trả về structured output không hợp lệ.`;
    super("AI_STRUCTURED_OUTPUT_INVALID", message, 502, details);
  }
}
