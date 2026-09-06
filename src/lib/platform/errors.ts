import { AppError } from "@/lib/errors";

export class PlatformProviderError extends AppError {
  constructor(message: string, details?: unknown) {
    super("PLATFORM_PROVIDER_ERROR", message, 502, details);
  }
}

export class PlatformProviderNotConfiguredError extends AppError {
  constructor(platform: string) {
    super("PLATFORM_PROVIDER_NOT_CONFIGURED", `${platform} provider chưa được cấu hình API access.`, 503);
  }
}
