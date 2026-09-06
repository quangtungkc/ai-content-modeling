import { getEnv } from "@/lib/env";
import { GeminiProvider } from "./gemini";
import { OpenAIProvider } from "./openai";
import { UnconfiguredAIProvider } from "./provider";
import type { AIProvider } from "./types";

export function getAIProvider(): AIProvider {
  const provider = getEnv().AI_PROVIDER.toLowerCase();
  if (provider === "openai") return new OpenAIProvider();
  if (provider === "gemini") return new GeminiProvider();
  return new UnconfiguredAIProvider();
}

export * from "./types";
export * from "./schemas";
export * from "./video-schemas";
export * from "./review-schemas";
export * from "./asset-schemas";
export * from "./errors";
export { GeminiProvider } from "./gemini";
export { OpenAIProvider } from "./openai";
