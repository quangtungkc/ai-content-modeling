import os from "node:os";
import { APP_METADATA, getRuntimeMetadata } from "./app-metadata";

export function getDiagnostics() {
  const runtime = getRuntimeMetadata();
  return {
    app: { name: APP_METADATA.name, displayName: APP_METADATA.displayName, version: APP_METADATA.version },
    environment: runtime.environment,
    mode: runtime.mode,
    build: runtime.build,
    runtime: {
      node: process.version,
      electron: process.versions.electron ?? null,
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
    },
    services: {
      backend: "available",
      browser: process.env.EDGE_GEMINI_DEBUG_PORT ? "configured" : "managed-by-desktop",
    },
    // Deliberately boolean-only; this endpoint never returns credentials or URLs.
    configuration: {
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      aiProviderConfigured: Boolean(process.env.AI_PROVIDER && process.env.AI_PROVIDER !== "unconfigured"),
    },
  } as const;
}
