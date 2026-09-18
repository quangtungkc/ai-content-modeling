import { randomUUID } from "node:crypto";
import { z } from "zod";

const nullableRecord = z.record(z.string(), z.unknown()).nullable().default(null);

export const incidentEvidenceSchema = z.object({
  kind: z.string().trim().min(2).max(80),
  source: z.string().trim().min(2).max(200),
  value: z.unknown(),
  observedAt: z.string().datetime().optional(),
});

export const incidentSchema = z.object({
  incidentId: z.string().uuid().default(() => randomUUID()),
  timestamp: z.string().datetime().default(() => new Date().toISOString()),
  projectId: z.string().trim().min(1).max(160).nullable().default(null),
  sceneNumber: z.number().int().positive().nullable().default(null),
  stage: z.string().trim().min(2).max(120),
  component: z.string().trim().min(2).max(200),
  symptoms: z.array(z.string().trim().min(2).max(800)).default([]),
  errorMessages: z.array(z.string().trim().min(2).max(4_000)).default([]),
  errorCodes: z.array(z.string().trim().min(2).max(200)).default([]),
  firstDivergence: z.string().trim().min(2).max(200).nullable().default(null),
  expectedState: nullableRecord,
  actualState: nullableRecord,
  evidence: z.array(incidentEvidenceSchema).default([]),
  runtimeState: z.record(z.string(), z.unknown()).default({}),
  checkpoint: z.record(z.string(), z.unknown()).default({}),
  attemptCount: z.number().int().nonnegative().default(0),
  previousRepairAttempts: z.array(z.object({ ruleId: z.string().min(2), status: z.string().min(2), at: z.string().datetime() })).default([]),
  affectedFiles: z.array(z.string().trim().min(1).max(1_000)).default([]),
  preserveRequirements: z.array(z.string().trim().min(2).max(1_000)).default([]),
});

export type TroubleshootingIncident = z.infer<typeof incidentSchema>;
