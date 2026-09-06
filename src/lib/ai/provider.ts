import { AppError } from "@/lib/errors";
import type { AIProvider } from "./types";

export class UnconfiguredAIProvider implements AIProvider {
  private async unavailable(): Promise<never> {
    throw new AppError("AI_PROVIDER_NOT_CONFIGURED", "AI provider chưa được cấu hình.", 503);
  }

  analyzeSource(input: Record<string, unknown>): Promise<never> { void input; return this.unavailable(); }
  developProject(input: Record<string, unknown>): Promise<never> { void input; return this.unavailable(); }
  review(input: Record<string, unknown>): Promise<never> { void input; return this.unavailable(); }
  validateAsset(input: Record<string, unknown>): Promise<never> { void input; return this.unavailable(); }
}

export const aiProvider: AIProvider = new UnconfiguredAIProvider();
