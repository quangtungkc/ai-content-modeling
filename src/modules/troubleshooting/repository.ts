import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { TROUBLESHOOTING_KNOWLEDGE_BASE_KEY, TROUBLESHOOTING_KNOWLEDGE_BASE_VERSION, VERIFIED_TROUBLESHOOTING_RULES } from "./seed";
import { troubleshootingRuleSchema, type TroubleshootingRule, validateTroubleshootingRules } from "./schema";
import { ensureTroubleshootingStorage } from "./storage";

const DESCRIPTION = "Kho giải quyết sự cố: rule PROVISIONAL chỉ để review; auto-repair cần provenance production độc lập và safety gates.";

export type TroubleshootingPersistence = {
  upsertKnowledgeBase(input: { key: string; version: string; description: string; updatedAt: Date }): Promise<unknown>;
  upsertRule(input: { rule: TroubleshootingRule; knowledgeBaseKey: string; updatedAt: Date }): Promise<unknown>;
  findRules(input: { knowledgeBaseKey: string; verificationStatus?: string }): Promise<Array<{ document: unknown }>>;
};

export function prismaTroubleshootingPersistence(): TroubleshootingPersistence {
  return {
    upsertKnowledgeBase: ({ key, version, description, updatedAt }) => db.troubleshootingKnowledgeBase.upsert({
      where: { key }, update: { version, description, updatedAt }, create: { key, version, description, updatedAt },
    }),
    upsertRule: ({ rule, knowledgeBaseKey, updatedAt }) => db.troubleshootingRule.upsert({
      where: { issueId: rule.issueId },
      update: { knowledgeBaseKey, title: rule.title, stage: rule.stage, firstDivergence: rule.firstDivergence, repairScope: rule.repairScope, autoRepairAllowed: rule.autoRepairAllowed, severity: rule.severity, version: rule.version, verificationStatus: rule.verificationStatus, automationClass: rule.automationClass, tags: rule.tags as Prisma.InputJsonValue, document: rule as unknown as Prisma.InputJsonValue, updatedAt },
      create: { issueId: rule.issueId, knowledgeBaseKey, title: rule.title, stage: rule.stage, firstDivergence: rule.firstDivergence, repairScope: rule.repairScope, autoRepairAllowed: rule.autoRepairAllowed, severity: rule.severity, version: rule.version, verificationStatus: rule.verificationStatus, automationClass: rule.automationClass, tags: rule.tags as Prisma.InputJsonValue, document: rule as unknown as Prisma.InputJsonValue, updatedAt },
    }),
    findRules: ({ knowledgeBaseKey, verificationStatus }) => db.troubleshootingRule.findMany({ where: { knowledgeBaseKey, ...(verificationStatus ? { verificationStatus } : {}) }, select: { document: true }, orderBy: { issueId: "asc" } }),
  };
}

export class TroubleshootingKnowledgeBaseRepository {
  constructor(private readonly persistence: TroubleshootingPersistence = prismaTroubleshootingPersistence(), private readonly ensureStorage: () => Promise<void> = ensureTroubleshootingStorage) {}

  async seedVerifiedRules() {
    const rules = validateTroubleshootingRules(VERIFIED_TROUBLESHOOTING_RULES);
    await this.ensureStorage();
    const updatedAt = new Date();
    await this.persistence.upsertKnowledgeBase({ key: TROUBLESHOOTING_KNOWLEDGE_BASE_KEY, version: TROUBLESHOOTING_KNOWLEDGE_BASE_VERSION, description: DESCRIPTION, updatedAt });
    for (const rule of rules) await this.persistence.upsertRule({ rule, knowledgeBaseKey: TROUBLESHOOTING_KNOWLEDGE_BASE_KEY, updatedAt });
    return { key: TROUBLESHOOTING_KNOWLEDGE_BASE_KEY, version: TROUBLESHOOTING_KNOWLEDGE_BASE_VERSION, ruleCount: rules.length };
  }

  async loadVerifiedRules() {
    await this.ensureStorage();
    const stored = await this.persistence.findRules({ knowledgeBaseKey: TROUBLESHOOTING_KNOWLEDGE_BASE_KEY, verificationStatus: "VERIFIED" });
    return validateTroubleshootingRules(stored.map((row) => troubleshootingRuleSchema.parse(row.document))).filter(rule => rule.verificationStatus === "VERIFIED");
  }
}
