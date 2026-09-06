import { AppError } from "@/lib/errors";

export class VideoProviderNotConfiguredError extends AppError {
  constructor(provider: string) { super("VIDEO_PROVIDER_NOT_CONFIGURED", `${provider} chưa được cấu hình API key.`, 503); }
}

export class VideoProviderError extends AppError {
  constructor(provider: string, message: string, details?: unknown) { super("VIDEO_PROVIDER_ERROR", `${provider}: ${message}`, 502, details); }
}
