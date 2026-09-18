import { describe, expect, it } from "vitest";
import { VERIFIED_TROUBLESHOOTING_RULES, AUTO_REPAIR_PROVENANCE_REVIEWS, hasProductionRepairProvenance } from "./seed";
import { assertUniqueRuleIds, retryPolicySchema, troubleshootingRuleSchema, validateTroubleshootingRules } from "./schema";

describe("troubleshooting knowledge base schema", () => {
  it("validates every verified seed rule", () => {
    const rules = validateTroubleshootingRules(VERIFIED_TROUBLESHOOTING_RULES);
    expect(rules).toHaveLength(33);
    expect(rules.filter(rule => rule.verificationStatus === "PROVISIONAL")).toHaveLength(9);
    expect(rules.filter(rule => rule.autoRepairAllowed)).toHaveLength(0);
    expect(AUTO_REPAIR_PROVENANCE_REVIEWS).toHaveLength(9);
    for (const review of AUTO_REPAIR_PROVENANCE_REVIEWS) {
      const rule = rules.find(rule => rule.issueId === review.ruleId)!;
      expect(rule).toMatchObject({ verificationStatus: "PROVISIONAL", autoRepairAllowed: false, lastVerifiedAt: null });
      expect(hasProductionRepairProvenance(rule)).toBe(false);
    }
  });

  it("rejects duplicate issueId", () => {
    expect(() => assertUniqueRuleIds([VERIFIED_TROUBLESHOOTING_RULES[0], VERIFIED_TROUBLESHOOTING_RULES[0]])).toThrow("DUPLICATE_TROUBLESHOOTING_ISSUE_ID");
  });

  it("rejects invalid repairScope", () => {
    expect(() => troubleshootingRuleSchema.parse({ ...VERIFIED_TROUBLESHOOTING_RULES[0], repairScope: "EVERYTHING" })).toThrow();
  });

  it("rejects unbounded retry configuration", () => {
    expect(() => retryPolicySchema.parse({ maxAttempts: 11, backoff: { strategy: "EXPONENTIAL", baseDelayMs: 1, maxDelayMs: 2 }, stopConditions: ["Dừng khi hết attempts."] })).toThrow();
  });
});
