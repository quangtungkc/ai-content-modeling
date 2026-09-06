import { AppError } from "@/lib/errors";

export class AIProviderNotConfiguredError extends AppError {
  constructor(provider: string) { super("AI_PROVIDER_NOT_CONFIGURED", `${provider} chưa được cấu hình API key.`, 503); }
}

export class AIStructuredOutputError extends AppError {
  constructor(provider: string, details?: unknown) { super("AI_STRUCTURED_OUTPUT_INVALID", `${provider} trả về structured output không hợp lệ.`, 502, details); }
}
