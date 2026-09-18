import path from "node:path";

// Electron validates and canonicalizes this controlled-launch path before services start.
export function applicationDataDirectory(fallbackRoot: string, legacyDirectory = "ai-content-modeling") {
  const override = process.env.MODELING_AI_USER_DATA_DIR;
  if (override !== undefined) {
    if (!override.trim() || override.includes("\0") || !path.isAbsolute(override)) throw new Error("MODELING_AI_USER_DATA_DIR_INVALID");
    return path.resolve(override);
  }
  return path.join(fallbackRoot, legacyDirectory);
}
