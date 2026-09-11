export const CODEX_STAGES = [
  "ANALYSIS",
  "MODELING",
  "PROJECT",
  "ASSETS",
  "SCENES",
  "FINAL_ASSEMBLY",
  "FINAL_AUDIT",
  "POST_RUN_REVIEW",
] as const;

export type CodexStage = (typeof CODEX_STAGES)[number];
export type CodexJobStatus = "PLANNING" | "RUNNING" | "RECOVERING" | "NEEDS_HUMAN" | "NEEDS_ENGINEERING" | "COMPLETED" | "FAILED";
export type CodexStageStatus = "PENDING" | "RUNNING" | "RETRYING" | "COMPLETED" | "FAILED" | "SKIPPED";
export type ValidationVerdict = "PASS" | "FAIL" | "UNCERTAIN";
export type FailureKind = "TECHNICAL_FAILURE" | "SEMANTIC_FAILURE" | "ENGINEERING_FAILURE";

export const CODEX_EVENT_TYPES = [
  "CODEX_JOB_STARTED",
  "PLAN_CREATED",
  "STAGE_STARTED",
  "STAGE_PROGRESS",
  "STAGE_COMPLETED",
  "TOOL_CALLED",
  "TOOL_FAILED",
  "VALIDATION_FAILED",
  "ERROR_DIAGNOSED",
  "RECOVERY_STARTED",
  "RECOVERY_SUCCEEDED",
  "RECOVERY_FAILED",
  "DECISION_REQUIRED",
  "FINAL_ASSEMBLY_COMPLETED",
  "FINAL_AUDIT_STARTED",
  "FINAL_AUDIT_FAILED",
  "FINAL_AUDIT_PASSED",
  "JOB_COMPLETED",
  "POST_RUN_REVIEW_COMPLETED",
  "IMPROVEMENT_CANDIDATE_CREATED",
  "JOB_NEEDS_HUMAN",
  "JOB_NEEDS_ENGINEERING",
  "ENGINEERING_REPAIR_STARTED",
  "ENGINEERING_REPAIR_SUCCEEDED",
  "ENGINEERING_REPAIR_FAILED",
  "PROVIDER_FALLBACK",
] as const;

export type CodexEventType = (typeof CODEX_EVENT_TYPES)[number];

export type CodexActionName =
  | "runAnalysisStage"
  | "runModelingStage"
  | "runProjectDevelopmentStage"
  | "runAssetStage"
  | "validateAssets"
  | "runSceneGenerationStage"
  | "validateScenes"
  | "regenerateAsset"
  | "regenerateScene"
  | "runFinalAssembly"
  | "runFinalAudit"
  | "runPostRunReview"
  | "repairProductionCode"
  | "waitForHuman"
  | "jobComplete";

export type CodexAction = {
  name: CodexActionName;
  stage?: CodexStage;
  targetIds?: string[];
  strategy?: string;
  reason?: string;
};

export type SceneExpectedState = {
  sceneId: string;
  sceneNumber: number;
  expectedCharacter: unknown;
  characterVersion: number | null;
  expectedBackground: unknown;
  requiredProps: string[];
  expectedAction: string;
  expectedCamera: string;
  expectedDuration: number;
  expectedDialogue: string;
  expectedEmotion: string;
  requiredVisualElements: string[];
  forbiddenElements: string[];
  sourceModelingIntent: string;
  startFramePrompt: string;
  videoPrompt: string;
};

export type ExpectedState = {
  stage: CodexStage;
  projectId?: string;
  requiredAssetKeys?: string[];
  expectedSceneNumbers?: number[];
  expectedSceneOrder?: number[];
  expectedAspectRatio?: string;
  expectedDurationPerScene?: number;
  requireAudio?: boolean;
  requireFinalVideo?: boolean;
  scenes?: SceneExpectedState[];
};

export type ValidationIssue = {
  code: string;
  message: string;
  targetId?: string;
  sceneNumber?: number;
  expected?: unknown;
  actual?: unknown;
};

export type ValidationOutput = {
  verdict: ValidationVerdict;
  failureKind?: FailureKind;
  issues: ValidationIssue[];
};

export type CodexStageSnapshot = {
  stage: CodexStage;
  status: CodexStageStatus;
  retryCount: number;
  maxRetries: number;
  expectedState?: ExpectedState;
  actualState?: Record<string, unknown>;
  validationResult?: ValidationVerdict;
  lastStrategy?: string;
};

export type ReportCodexEventInput = {
  type: "STAGE_STARTED" | "STAGE_COMPLETED" | "STAGE_FAILED" | "PROVIDER_FALLBACK";
  stage: CodexStage;
  actualState?: Record<string, unknown>;
  error?: string;
  provider?: string;
  fallbackProvider?: string;
};

export type CodexDecision = {
  selectedTool: CodexActionName;
  targetStage?: CodexStage;
  targetIds?: string[];
  strategy?: string;
  shortReason: string;
  evidence: string[];
  externalReferences?: string[];
  alternativeSolutions?: string[];
  confidence: number;
};
