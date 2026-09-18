import { z } from "zod";

export const TROUBLESHOOTING_STAGES = [
  "ANALYSIS", "MODELING", "PROJECT", "ASSETS", "SCENES", "FINAL_ASSEMBLY", "FINAL_AUDIT",
  "FLOW_RUNTIME", "COMPOSER", "PROMPT", "REFERENCE", "DOWNLOAD", "POST_PROCESSING", "GLOBAL",
] as const;

export const REPAIR_SCOPES = [
  "FRAME_REGION", "SCENE", "PROMPT", "REFERENCE", "DOWNLOAD", "FLOW_RUNTIME", "CHECKPOINT", "ASSEMBLY", "GLOBAL",
] as const;

export const VERIFICATION_STATUSES = ["VERIFIED", "PROVISIONAL", "DEPRECATED"] as const;
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const AUTOMATION_CLASSES = ["AUTO_SAFE", "AUTO_GUARDED", "MANUAL_ONLY", "NO_HANDLER_YET"] as const;

export const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(0).max(10),
  backoff: z.object({
    strategy: z.enum(["NONE", "FIXED", "EXPONENTIAL"]),
    baseDelayMs: z.number().int().min(0).max(300_000),
    maxDelayMs: z.number().int().min(0).max(900_000),
  }).superRefine((value, ctx) => {
    if (value.maxDelayMs < value.baseDelayMs) ctx.addIssue({ code: "custom", message: "maxDelayMs phải lớn hơn hoặc bằng baseDelayMs." });
    if (value.strategy === "NONE" && (value.baseDelayMs !== 0 || value.maxDelayMs !== 0)) ctx.addIssue({ code: "custom", message: "Backoff NONE phải có delay bằng 0." });
  }),
  stopConditions: z.array(z.string().trim().min(3).max(300)).min(1).max(12),
}).superRefine((value, ctx) => {
  if (value.maxAttempts === 0 && !value.stopConditions.some((condition) => /manual|không retry|no retry/i.test(condition))) {
    ctx.addIssue({ code: "custom", message: "Rule không retry phải ghi rõ điều kiện dừng thủ công." });
  }
});

export const troubleshootingRuleSchema = z.object({
  issueId: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,119}$/),
  title: z.string().trim().min(5).max(240),
  description: z.string().trim().min(10).max(4_000),
  stage: z.enum(TROUBLESHOOTING_STAGES),
  symptoms: z.array(z.string().trim().min(3).max(500)).min(1).max(20),
  errorSignatures: z.array(z.string().trim().min(3).max(500)).min(1).max(20),
  firstDivergence: z.string().trim().min(3).max(160).nullable(),
  rootCause: z.string().trim().min(5).max(2_000),
  preconditions: z.array(z.string().trim().min(3).max(500)).min(1).max(20),
  optimalFix: z.string().trim().min(5).max(4_000),
  doNotDo: z.array(z.string().trim().min(3).max(800)).min(1).max(20),
  retryPolicy: retryPolicySchema,
  validationAfterFix: z.array(z.string().trim().min(3).max(800)).min(1).max(20),
  fallback: z.string().trim().min(3).max(2_000),
  repairScope: z.enum(REPAIR_SCOPES),
  autoRepairAllowed: z.boolean(),
  severity: z.enum(SEVERITIES),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  tags: z.array(z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,48}$/)).min(1).max(20),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  automationClass: z.enum(AUTOMATION_CLASSES),
  evidenceRequired: z.array(z.string().trim().min(3).max(800)).min(1).max(20),
  confidenceThreshold: z.number().min(0.5).max(1),
  affectedComponents: z.array(z.string().trim().min(3).max(200)).min(1).max(20),
  preserveRequirements: z.array(z.string().trim().min(3).max(800)).min(1).max(20),
  createdFromIncident: z.string().trim().min(3).max(240),
  lastVerifiedAt: z.string().date().nullable(),
});

export type TroubleshootingRule = z.infer<typeof troubleshootingRuleSchema>;

export function assertUniqueRuleIds(rules: readonly TroubleshootingRule[]) {
  const duplicates = rules.map((rule) => rule.issueId).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicates.length) throw new Error(`DUPLICATE_TROUBLESHOOTING_ISSUE_ID: ${[...new Set(duplicates)].join(", ")}`);
}

export function validateTroubleshootingRules(rules: readonly unknown[]) {
  const parsed = rules.map((rule) => troubleshootingRuleSchema.parse(rule));
  assertUniqueRuleIds(parsed);
  return parsed;
}
