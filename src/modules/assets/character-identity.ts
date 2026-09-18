import { z } from "zod";

export const characterIdentityPackSchema = z.object({
  characterId: z.string().min(1),
  channelId: z.string().min(1),
  name: z.string().min(1),
  referenceImages: z.array(z.object({ assetId: z.string().min(1), storageKey: z.string().min(1), viewRole: z.string().min(1), active: z.boolean(), referenceId: z.string().nullable().optional() })).min(1),
  lockedTraits: z.record(z.string(), z.unknown()),
  allowedVariations: z.array(z.string()),
  negativeRules: z.array(z.string()),
  styleType: z.string().min(1),
  active: z.boolean(),
});

export type CharacterIdentityPack = z.infer<typeof characterIdentityPackSchema>;
export type CharacterIdentityValidationStatus = "PASS" | "FAIL" | "NOT_EVALUATED";
export type CharacterIdentityValidation = {
  validatorId: "CHARACTER_IDENTITY_MATCH";
  status: CharacterIdentityValidationStatus;
  checks: Record<string, boolean | null>;
  issues: string[];
};

const IDENTITY_KEYS = ["faceIdentity", "facialStructure", "skinTone", "baseHairstyle", "bodyProportions", "bodyBuild", "ageAppearance", "distinctiveTraits", "coreCharacterDesignLanguage"] as const;

function comparable(value: unknown) {
  if (typeof value === "string") return value.trim().toLowerCase();
  return JSON.stringify(value);
}

export function validateCharacterIdentity(input: { lockedTraits: Record<string, unknown>; actualIdentity?: Record<string, unknown> | null; actualStyleType?: string | null; sceneAppearance?: Record<string, unknown> | null }): CharacterIdentityValidation {
  if (!input.actualIdentity || !input.actualStyleType) {
    return { validatorId: "CHARACTER_IDENTITY_MATCH", status: "NOT_EVALUATED", checks: Object.fromEntries(IDENTITY_KEYS.map(key => [key, null])), issues: ["Identity output evidence is missing; visual identity was not inferred."] };
  }
  const checks = Object.fromEntries(IDENTITY_KEYS.map(key => [key, input.lockedTraits[key] !== undefined && input.actualIdentity?.[key] !== undefined ? comparable(input.lockedTraits[key]) === comparable(input.actualIdentity[key]) : null])) as Record<string, boolean | null>;
  checks.CORE_STYLE_MATCH = comparable(input.lockedTraits.coreCharacterDesignLanguage) === comparable(input.actualIdentity.coreCharacterDesignLanguage) && comparable(input.actualStyleType) === comparable(input.lockedTraits.styleType ?? input.actualStyleType);
  const issues = Object.entries(checks).filter(([, value]) => value === false).map(([key]) => `${key}_FAIL`);
  const missing = Object.entries(checks).filter(([, value]) => value === null).map(([key]) => `${key}_NOT_EVALUATED`);
  return { validatorId: "CHARACTER_IDENTITY_MATCH", status: issues.length ? "FAIL" : missing.length ? "NOT_EVALUATED" : "PASS", checks, issues: [...issues, ...missing] };
}

export type IdentityGenerationGate = "ALLOW" | "BLOCK" | "NEEDS_REVIEW";
export function identityGenerationGate(validation: CharacterIdentityValidation): IdentityGenerationGate {
  if (validation.status === "FAIL") return "BLOCK";
  if (validation.status === "NOT_EVALUATED") return "NEEDS_REVIEW";
  return "ALLOW";
}

export function assertCharacterIdentityPackReady<T extends { active: boolean; referenceImages: Array<{ active: boolean }> }>(pack: T | null | undefined): T {
  if (!pack?.active || !pack.referenceImages.some(reference => reference.active)) throw new Error("MAIN_CHARACTER_IDENTITY_MISSING");
  return pack;
}
