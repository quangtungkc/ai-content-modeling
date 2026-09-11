import type { CodexActionName, CodexStage } from "./types";

export type HighLevelTool = {
  name: CodexActionName | "getSourceVideo" | "getJobState" | "getProjectState" | "getLogs" | "getFailureContext" | "getExperienceMatches";
  description: string;
  stage?: CodexStage;
  mutating: boolean;
};

// This is the complete allow-list exposed to Codex. It intentionally contains no
// shell, arbitrary filesystem, credential, database-write, deploy, or merge tool.
export const HIGH_LEVEL_TOOLS: HighLevelTool[] = [
  { name: "getSourceVideo", description: "Read the owned source video and latest analysis.", mutating: false },
  { name: "getJobState", description: "Read the persistent orchestration checkpoint and stage states.", mutating: false },
  { name: "getProjectState", description: "Read the current project, scenes, approved assets, and versions.", mutating: false },
  { name: "runAnalysisStage", description: "Run the existing source-video analysis service.", stage: "ANALYSIS", mutating: true },
  { name: "runModelingStage", description: "Run the existing modeling-idea service.", stage: "MODELING", mutating: true },
  { name: "runProjectDevelopmentStage", description: "Approve and develop through the existing project service.", stage: "PROJECT", mutating: true },
  { name: "runAssetStage", description: "Run the existing Flow image stage through the desktop executor.", stage: "ASSETS", mutating: true },
  { name: "validateAssets", description: "Compare generated assets with Expected State.", stage: "ASSETS", mutating: false },
  { name: "runSceneGenerationStage", description: "Run independent scene generation with the provider-safe concurrency limit.", stage: "SCENES", mutating: true },
  { name: "validateScenes", description: "Compare generated scenes with Expected State.", stage: "SCENES", mutating: false },
  { name: "regenerateAsset", description: "Regenerate only failed assets.", stage: "ASSETS", mutating: true },
  { name: "regenerateScene", description: "Regenerate only failed scenes.", stage: "SCENES", mutating: true },
  { name: "runFinalAssembly", description: "Run the existing FFmpeg assembly/edit service.", stage: "FINAL_ASSEMBLY", mutating: true },
  { name: "runFinalAudit", description: "Audit technical integrity, order, continuity, source intent, and final gag.", stage: "FINAL_AUDIT", mutating: false },
  { name: "getLogs", description: "Read redacted structured events for this job only.", mutating: false },
  { name: "getFailureContext", description: "Read the failed stage, Expected State, Actual State, and attempts.", mutating: false },
  { name: "getExperienceMatches", description: "Find matching historical errors and successful fixes.", mutating: false },
  { name: "runPostRunReview", description: "Create a post-run review and proposals without modifying production.", stage: "POST_RUN_REVIEW", mutating: true },
  { name: "waitForHuman", description: "Stop safely when retries are exhausted or a decision is too uncertain.", mutating: false },
  { name: "jobComplete", description: "Mark complete only after Final Audit passes.", mutating: true },
];

export const MUTATING_TOOL_NAMES = new Set(HIGH_LEVEL_TOOLS.filter((tool) => tool.mutating).map((tool) => tool.name));

export function isAllowedTool(name: string): name is HighLevelTool["name"] {
  return HIGH_LEVEL_TOOLS.some((tool) => tool.name === name);
}
