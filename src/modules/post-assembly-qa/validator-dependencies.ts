import type { PostAssemblyValidationPlan } from "@/modules/troubleshooting/handlers";

export type PartialRevalidationPlan = { repairScope: string; validatorIds: string[]; requiredValidatorIds: string[]; preserveValidatorIds: string[]; sceneNumbers: number[] | null };

export const validatorDependencies: Record<string, { validatorIds: string[]; preserveValidatorIds: string[] }> = {
  FRAME_REGION: { validatorIds: ["final-container", "scene-boundaries", "approved-sources", "visual-artifacts"], preserveValidatorIds: ["scene-boundaries", "approved-sources"] },
  SCENE: { validatorIds: ["final-container", "scene-boundaries", "approved-sources", "visual-artifacts"], preserveValidatorIds: ["scene-boundaries", "approved-sources"] },
  ASSEMBLY: { validatorIds: ["final-container", "scene-boundaries", "approved-sources"], preserveValidatorIds: ["final-container", "scene-boundaries", "approved-sources"] },
  PROMPT: { validatorIds: [], preserveValidatorIds: [] },
  REFERENCE: { validatorIds: [], preserveValidatorIds: [] },
  FLOW_RUNTIME: { validatorIds: [], preserveValidatorIds: [] },
  GLOBAL: { validatorIds: ["final-container"], preserveValidatorIds: ["final-container"] },
};

export function buildPartialRevalidationPlan(input: { repairScope: string; failingValidatorId: string; affectedScene: number | null; handlerPlan: PostAssemblyValidationPlan; supportedValidatorIds?: string[] }): PartialRevalidationPlan {
  const dependency = validatorDependencies[input.repairScope] ?? { validatorIds: [], preserveValidatorIds: [] };
  const requested = [...dependency.validatorIds, ...(input.handlerPlan.validatorIds ?? []), ...(input.handlerPlan.requiredValidatorIds ?? []), ...(input.handlerPlan.preserveValidatorIds ?? []), ...(input.supportedValidatorIds ?? []), input.failingValidatorId];
  const validatorIds = [...new Set(requested)];
  const requiredValidatorIds = [...new Set([input.failingValidatorId, ...(input.handlerPlan.requiredValidatorIds ?? [])])];
  const preserveValidatorIds = [...new Set([...dependency.preserveValidatorIds, ...(input.handlerPlan.preserveValidatorIds ?? [])])];
  const sceneNumbers = ["FRAME_REGION", "SCENE"].includes(input.repairScope) && input.affectedScene !== null ? [input.affectedScene] : null;
  return { repairScope: input.repairScope, validatorIds, requiredValidatorIds, preserveValidatorIds, sceneNumbers };
}
