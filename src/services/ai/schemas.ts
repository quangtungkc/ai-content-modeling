import { z } from "zod";

export const videoAnalysisSchema = z.object({
  schemaVersion: z.literal("1.0"), summary: z.string(), hook: z.string(), setup: z.string(), conflict: z.string(), escalation: z.string(), twist: z.string(), payoff: z.string(), theGag: z.string(), cameraPattern: z.string(), editingRhythm: z.string(), characterInteractions: z.array(z.string()), soundPattern: z.string(), retentionMechanism: z.string(), whyItWorks: z.array(z.string()),
});

const modelingDirectionSchema = z.object({ title: z.string(), coreConcept: z.string(), script: z.string(), characterDesign: z.string(), setting: z.string(), artStyle: z.string(), sourceMechanism: z.string(), whatIsPreserved: z.array(z.string()), whatIsChanged: z.array(z.string()), targetMarketAdaptation: z.string(), similarityRisk: z.enum(["low", "medium", "high"]), whyWorthDeveloping: z.string() });
export const modelingIdeasSchema = z.object({ schemaVersion: z.literal("1.0"), modelingDirections: z.array(modelingDirectionSchema).length(1) });
export const developedIdeaSchema = z.object({ schemaVersion: z.literal("1.0"), deconstruction: z.record(z.string(), z.unknown()), artDirection: z.record(z.string(), z.unknown()), characterDesign: z.record(z.string(), z.unknown()), backgroundDesign: z.record(z.string(), z.unknown()), storyboard: z.array(z.object({ sceneNumber: z.number().int().positive(), visualBlock: z.string(), actionBlock: z.string(), audioBlock: z.string(), englishPrompt: z.string() })), safetyReview: z.record(z.string(), z.unknown()) });
