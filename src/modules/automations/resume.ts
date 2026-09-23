export type ResumeStage = 1 | 2 | 3 | 4 | 5;
export type ResumeTarget = "MODELING_IDEA_CREATION" | "CONTENT_PROJECT_CREATION" | "IMAGES" | "VIDEOS" | "FINAL_VIDEO";

export type AutomationCheckpoint = {
  version: 1;
  runId: string;
  lastCompletedStage: ResumeStage | 0;
  failedStage: ResumeStage | null;
  resumeTarget?: ResumeTarget | null;
  modelingIdeaId: string | null;
  sourceVideoId: string;
  channelId: string | null;
  attemptCount?: number;
  incidentHistory?: unknown[];
  contentProjectId?: string | null;
  sourceModelingSpecVersion?: string | null;
  failureFingerprint?: string | null;
  executionLease?: ExecutionLease | null;
  geminiConversationId?: string | null;
  geminiConversationUrl?: string | null;
  geminiConversationOwnerRunId?: string | null;
  geminiConversationState?: "UNBOUND" | "ACTIVE" | "CLEANUP_PENDING" | "DELETED";
  geminiConversationCreatedAt?: string | null;
  geminiConversationDeletedAt?: string | null;
  lastGeminiStage?: string | null;
  lastGeminiCommandId?: string | null;
};

export type ExecutionLease = {
  executionId: string;
  appSessionId: string;
  startedAt: string;
  heartbeatAt: string;
  activeStage: string;
};

export const EXECUTION_LEASE_TTL_MS = 45_000;

export type ResumableRunInput = {
  id: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "PAUSED";
  sourceVideoId: string;
  channelId?: string | null;
  ideaId?: string | null;
  modelingIdeaId?: string | null;
  projectId?: string | null;
  sourceModelingSpecVersion?: string | null;
  lastCompletedStage?: number | null;
  failedStage?: number | null;
  resumeTarget?: string | null;
  attemptCount?: number | null;
  incidentHistory?: unknown[];
  failureFingerprint?: string | null;
  checkpoint?: Record<string, unknown>;
  steps?: Array<{ key: string; label: string; status: string; detail?: string; error?: string; startedAt?: string; completedAt?: string }>;
  modelingIdea?: unknown;
  updatedAt?: string;
};

export type ResumeDecision =
  | { status: "NONE" }
  | { status: "NEEDS_REVIEW"; reason: string; runId: string }
  | { status: "ACTIVE_RUN_IN_PROGRESS"; runId: string; executionId: string; activeStage: string }
  | { status: "RESUME"; run: ResumableRunInput; checkpoint: AutomationCheckpoint; failedStage: ResumeStage; modelingIdeaId: string; modelingIdea: unknown };

const stageKeys = ["modeling-idea", "content-project", "images", "videos", "final-video"] as const;
const resumeTargets: Record<ResumeStage, ResumeTarget> = {
  1: "MODELING_IDEA_CREATION",
  2: "CONTENT_PROJECT_CREATION",
  3: "IMAGES",
  4: "VIDEOS",
  5: "FINAL_VIDEO",
};

export function resumeTargetForStage(stage: number): ResumeTarget | null {
  return Number.isInteger(stage) && stage >= 1 && stage <= 5 ? resumeTargets[stage as ResumeStage] : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function integerStage(value: unknown): ResumeStage | 0 | null {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 5) return null;
  return Number(value) as ResumeStage | 0;
}

function normalizeString(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function uniqueString(values: unknown[]) {
  const normalized = [...new Set(values.map(normalizeString).filter((value): value is string => Boolean(value)))];
  return normalized.length <= 1 ? { value: normalized[0] ?? null, conflict: false } : { value: null, conflict: true };
}

function normalizeResumeTarget(value: unknown): ResumeTarget | null {
  return typeof value === "string" && Object.values(resumeTargets).includes(value as ResumeTarget) ? value as ResumeTarget : value == null || value === "" ? null : null;
}

type DerivedStageState = {
  status: "OK";
  lastCompletedStage: ResumeStage | 0;
  failedStage: ResumeStage | null;
  resumeTarget: ResumeTarget | null;
  runningStage: ResumeStage | null;
} | { status: "NEEDS_REVIEW"; reason: string };

type CanonicalStageState = {
  status: "OK";
  lastCompletedStage: ResumeStage | 0;
  failedStage: ResumeStage | null;
  resumeTarget: ResumeTarget | null;
  runningStage: ResumeStage | null;
};

export function deriveStageStateFromSteps(stepsValue: unknown): DerivedStageState {
  if (!Array.isArray(stepsValue) || !stepsValue.length) return { status: "NEEDS_REVIEW", reason: "STEPS_MISSING" };
  const byKey = new Map<string, { status?: string }>();
  for (const step of stepsValue) {
    if (!step || typeof step !== "object" || Array.isArray(step)) return { status: "NEEDS_REVIEW", reason: "STEPS_INVALID" };
    const key = (step as { key?: unknown }).key;
    if (typeof key !== "string" || !stageKeys.includes(key as typeof stageKeys[number])) return { status: "NEEDS_REVIEW", reason: "STEPS_UNKNOWN_KEY" };
    if (byKey.has(key)) return { status: "NEEDS_REVIEW", reason: "STEPS_DUPLICATE_KEY" };
    const status = (step as { status?: unknown }).status;
    if (!["pending", "running", "completed", "failed"].includes(String(status))) return { status: "NEEDS_REVIEW", reason: "STEPS_INVALID_STATUS" };
    byKey.set(key, { status: String(status) });
  }

  const statuses = stageKeys.map((key) => byKey.get(key)?.status ?? "pending");
  let lastCompletedStage = 0 as ResumeStage | 0;
  while (lastCompletedStage < stageKeys.length && statuses[lastCompletedStage] === "completed") lastCompletedStage += 1;
  const activeIndex = statuses.findIndex((status, index) => index >= lastCompletedStage && (status === "running" || status === "failed"));
  if (statuses.slice(lastCompletedStage + 1).some((status) => status !== "pending")) return { status: "NEEDS_REVIEW", reason: "STEPS_NON_MONOTONIC" };
  if (activeIndex >= 0 && activeIndex !== lastCompletedStage) return { status: "NEEDS_REVIEW", reason: "STEPS_GAP_BEFORE_ACTIVE_STAGE" };
  if (activeIndex < 0) {
    if (statuses.slice(lastCompletedStage).some((status) => status !== "pending")) return { status: "NEEDS_REVIEW", reason: "STEPS_NON_MONOTONIC" };
    return { status: "OK", lastCompletedStage, failedStage: null, resumeTarget: null, runningStage: null };
  }
  const activeStage = (activeIndex + 1) as ResumeStage;
  if (statuses.slice(activeIndex + 1).some((status) => status !== "pending")) return { status: "NEEDS_REVIEW", reason: "STEPS_NON_MONOTONIC" };
  const failedStage = statuses[activeIndex] === "failed" ? activeStage : null;
  return { status: "OK", lastCompletedStage, failedStage, resumeTarget: failedStage ? resumeTargetForStage(failedStage) : null, runningStage: failedStage ? null : activeStage };
}

export type AuthoritativeResumeState = {
  modelingIdeaId: string | null;
  sourceVideoId: string;
  channelId: string | null;
  lastCompletedStage: ResumeStage | 0;
  failedStage: ResumeStage | null;
  resumeTarget: ResumeTarget | null;
  attemptCount: number;
  incidentHistory: unknown[];
};

export type AutomationPersistenceFields = {
  ideaId?: string | null;
  modelingIdeaId?: string | null;
  channelId?: string | null;
  lastCompletedStage?: number;
  failedStage?: number | null;
  resumeTarget?: string | null;
  failureFingerprint?: string | null;
  attemptCount?: number;
  incidentHistory?: unknown[];
  checkpoint?: Record<string, unknown>;
};

export type AutomationPersistenceResult =
  | { status: "OK"; state: AuthoritativeResumeState; checkpoint: AutomationCheckpoint; patch: Record<string, unknown> }
  | { status: "NEEDS_REVIEW"; reason: string };

function readCheckpoint(run: ResumableRunInput) {
  return asRecord(run.checkpoint) ?? {};
}

function stageCandidate(run: ResumableRunInput, fields: AutomationPersistenceFields, raw: Record<string, unknown>, derived: DerivedStageState): CanonicalStageState | { status: "NEEDS_REVIEW"; reason: string } {
  const persistedLast = integerStage(run.lastCompletedStage) ?? integerStage(raw.lastCompletedStage);
  const persistedFailed = integerStage(run.failedStage) ?? integerStage(raw.failedStage);
  const persistedTarget = normalizeResumeTarget(run.resumeTarget ?? raw.resumeTarget);
  const explicitStage = fields.lastCompletedStage !== undefined || fields.failedStage !== undefined || fields.resumeTarget !== undefined;
  const requestedFailedStage = fields.failedStage === undefined ? persistedFailed : integerStage(fields.failedStage);
  const requestedResumeTarget = fields.resumeTarget === undefined
    ? persistedTarget ?? (requestedFailedStage && requestedFailedStage > 0 ? resumeTargetForStage(requestedFailedStage) : null)
    : normalizeResumeTarget(fields.resumeTarget);
  const requested = {
    lastCompletedStage: integerStage(fields.lastCompletedStage) ?? persistedLast,
    failedStage: requestedFailedStage,
    resumeTarget: requestedResumeTarget,
  };
  if (fields.lastCompletedStage !== undefined && requested.lastCompletedStage === null) return { status: "NEEDS_REVIEW" as const, reason: "RESUME_STATE_INCONSISTENT" };
  if (fields.failedStage !== undefined && fields.failedStage !== null && requested.failedStage === null) return { status: "NEEDS_REVIEW" as const, reason: "RESUME_STATE_INCONSISTENT" };
  if (fields.resumeTarget !== undefined && fields.resumeTarget !== null && requested.resumeTarget === null) return { status: "NEEDS_REVIEW" as const, reason: "RESUME_STATE_INCONSISTENT" };
  const canonicalRequested: CanonicalStageState = { status: "OK", lastCompletedStage: requested.lastCompletedStage ?? 0, failedStage: requested.failedStage && requested.failedStage > 0 ? requested.failedStage : null, resumeTarget: requested.resumeTarget, runningStage: null };
  if (derived.status === "NEEDS_REVIEW") return explicitStage || Array.isArray(run.steps) ? derived : canonicalRequested;
  if (!explicitStage) {
    if (derived.runningStage !== null && canonicalRequested.lastCompletedStage === derived.runningStage - 1 && canonicalRequested.failedStage === derived.runningStage && canonicalRequested.resumeTarget === resumeTargetForStage(derived.runningStage)) return { ...canonicalRequested, runningStage: derived.runningStage };
    if (derived.runningStage === 2 && canonicalRequested.lastCompletedStage === 1 && canonicalRequested.failedStage === null && canonicalRequested.resumeTarget === null) return { ...canonicalRequested, runningStage: 2 };
    return derived;
  }
  const resumeInProgress = derived.runningStage !== null && canonicalRequested.lastCompletedStage === derived.runningStage - 1 && canonicalRequested.failedStage === derived.runningStage && canonicalRequested.resumeTarget === resumeTargetForStage(derived.runningStage);
  const matchesDerived = canonicalRequested.lastCompletedStage === derived.lastCompletedStage && canonicalRequested.failedStage === derived.failedStage && canonicalRequested.resumeTarget === derived.resumeTarget;
  if (!matchesDerived && !resumeInProgress) return { status: "NEEDS_REVIEW" as const, reason: "RESUME_STATE_INCONSISTENT" };
  return { ...canonicalRequested, runningStage: derived.runningStage };
}

function validAttemptCount(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100 ? Number(value) : null;
}

function validExecutionLease(value: unknown): ExecutionLease | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const executionId = normalizeString(raw.executionId);
  const appSessionId = normalizeString(raw.appSessionId);
  const startedAt = normalizeString(raw.startedAt);
  const heartbeatAt = normalizeString(raw.heartbeatAt);
  const activeStage = normalizeString(raw.activeStage);
  if (!executionId || !appSessionId || !startedAt || !heartbeatAt || !activeStage || Number.isNaN(Date.parse(heartbeatAt))) return null;
  return { executionId, appSessionId, startedAt, heartbeatAt, activeStage };
}

export function isExecutionLive(lease: ExecutionLease | null, now = Date.now()) {
  return Boolean(lease && now - Date.parse(lease.heartbeatAt) >= 0 && now - Date.parse(lease.heartbeatAt) <= EXECUTION_LEASE_TTL_MS);
}

export type StaleRunningReconciliation =
  | { status: "UNCHANGED" }
  | { status: "ACTIVE_RUN_IN_PROGRESS"; lease: ExecutionLease }
  | { status: "NEEDS_REVIEW"; reason: string }
  | { status: "RECOVERED"; patch: Record<string, unknown>; checkpoint: AutomationCheckpoint };

export function reconcileStaleRunningRun(run: ResumableRunInput, now = new Date()): StaleRunningReconciliation {
  if (run.status !== "RUNNING") return { status: "UNCHANGED" };
  const raw = readCheckpoint(run);
  const lease = validExecutionLease(raw.executionLease);
  if (isExecutionLive(lease, now.getTime())) return { status: "ACTIVE_RUN_IN_PROGRESS", lease: lease! };
  const persisted = buildAuthoritativePersistencePatch({ existing: run, steps: run.steps });
  if (persisted.status !== "OK") return { status: "NEEDS_REVIEW", reason: persisted.reason };
  const state = persisted.state;
  if (state.lastCompletedStage !== 1 || state.failedStage !== 2 || state.resumeTarget !== "CONTENT_PROJECT_CREATION" || !state.modelingIdeaId || !state.sourceVideoId || !state.channelId) {
    return { status: "NEEDS_REVIEW", reason: "STALE_RUNNING_CHECKPOINT_AMBIGUOUS" };
  }
  const timestamp = now.toISOString();
  const steps = (run.steps ?? []).map((step) => step.key === "content-project" && step.status === "running"
    ? { ...step, status: "failed", detail: "Execution bị gián đoạn; có thể tiếp tục từ Content Project.", error: "RUN_INTERRUPTED", completedAt: timestamp }
    : step);
  const checkpoint: AutomationCheckpoint = { ...persisted.checkpoint, executionLease: null };
  return { status: "RECOVERED", checkpoint, patch: { ...persisted.patch, status: "PAUSED", steps, checkpoint } };
}

export function buildAuthoritativePersistencePatch(input: { existing: ResumableRunInput; steps?: ResumableRunInput["steps"]; fields?: AutomationPersistenceFields }): AutomationPersistenceResult {
  const { existing, fields = {} } = input;
  const raw = { ...readCheckpoint(existing), ...(asRecord(fields.checkpoint) ?? {}) };
  const effectiveSteps = input.steps ?? existing.steps;
  const derived = deriveStageStateFromSteps(effectiveSteps);
  const stage = stageCandidate(existing, fields, raw, derived);
  if (stage.status === "NEEDS_REVIEW") return stage;

  const modelingIdea = uniqueString([fields.modelingIdeaId, existing.modelingIdeaId, fields.ideaId, existing.ideaId, raw.modelingIdeaId]);
  const sourceVideo = uniqueString([existing.sourceVideoId, raw.sourceVideoId]);
  const channel = uniqueString([fields.channelId, existing.channelId, raw.channelId]);
  if (modelingIdea.conflict || sourceVideo.conflict || channel.conflict || !sourceVideo.value) return { status: "NEEDS_REVIEW", reason: "RESUME_STATE_AMBIGUOUS" };
  const attemptCount = validAttemptCount(fields.attemptCount) ?? validAttemptCount(existing.attemptCount) ?? validAttemptCount(raw.attemptCount) ?? 0;
  const incidentHistoryValue = fields.incidentHistory !== undefined ? fields.incidentHistory : existing.incidentHistory !== undefined ? existing.incidentHistory : raw.incidentHistory ?? [];
  if (!Array.isArray(incidentHistoryValue)) return { status: "NEEDS_REVIEW", reason: "INCIDENT_HISTORY_INVALID" };
  const state: AuthoritativeResumeState = {
    modelingIdeaId: modelingIdea.value,
    sourceVideoId: sourceVideo.value,
    channelId: channel.value,
    lastCompletedStage: stage.lastCompletedStage,
    failedStage: stage.failedStage,
    resumeTarget: stage.resumeTarget,
    attemptCount,
    incidentHistory: incidentHistoryValue,
  };
  const checkpoint: AutomationCheckpoint = {
    ...raw,
    version: 1,
    runId: existing.id,
    modelingIdeaId: state.modelingIdeaId,
    sourceVideoId: state.sourceVideoId,
    channelId: state.channelId,
    lastCompletedStage: state.lastCompletedStage,
    failedStage: state.failedStage,
    resumeTarget: state.resumeTarget,
    attemptCount: state.attemptCount,
    incidentHistory: state.incidentHistory,
  };
  const patch: Record<string, unknown> = {
    ideaId: state.modelingIdeaId ?? existing.ideaId ?? null,
    modelingIdeaId: state.modelingIdeaId,
    channelId: state.channelId,
    lastCompletedStage: state.lastCompletedStage,
    failedStage: state.failedStage,
    resumeTarget: state.resumeTarget,
    attemptCount: state.attemptCount,
    incidentHistory: state.incidentHistory,
    checkpoint,
  };
  if (fields.failureFingerprint !== undefined) patch.failureFingerprint = fields.failureFingerprint;
  else if (existing.failureFingerprint !== undefined) patch.failureFingerprint = existing.failureFingerprint;
  return { status: "OK", state, checkpoint, patch };
}

function checkpointForRun(run: ResumableRunInput, expected: { channelId: string; modelingIdeaId?: string }): AutomationCheckpoint | null {
  const raw = asRecord(run.checkpoint);
  const derived = deriveStageStateFromSteps(run.steps);
  if (derived.status !== "OK") return null;
  const resumeStage = derived.failedStage ?? (derived.lastCompletedStage < 5 ? (derived.lastCompletedStage + 1) as ResumeStage : null);
  if (!resumeStage) return null;
  const modelingIdea = uniqueString([run.modelingIdeaId, run.ideaId, raw?.modelingIdeaId]);
  const sourceVideoId = uniqueString([run.sourceVideoId, raw?.sourceVideoId]);
  const channelId = uniqueString([run.channelId, raw?.channelId, expected.channelId]);
  if (modelingIdea.conflict || sourceVideoId.conflict || channelId.conflict || !modelingIdea.value || !sourceVideoId.value || !channelId.value) return null;
  if (expected.modelingIdeaId && modelingIdea.value !== expected.modelingIdeaId) return null;
  if (sourceVideoId.value !== String(run.sourceVideoId).trim() || channelId.value !== expected.channelId) return null;
  if (raw?.resumeTarget !== undefined && raw.resumeTarget !== null && normalizeResumeTarget(raw.resumeTarget) !== resumeTargetForStage(resumeStage)) return null;
  const incidentHistory = run.incidentHistory !== undefined ? run.incidentHistory : raw?.incidentHistory ?? [];
  if (!Array.isArray(incidentHistory)) return null;
  const contentProjectId = run.projectId ?? (typeof raw?.contentProjectId === "string" ? raw.contentProjectId : null);
  if (resumeStage >= 3 && !contentProjectId) return null;
  return {
    ...raw,
    version: 1,
    runId: run.id,
    lastCompletedStage: derived.lastCompletedStage,
    failedStage: derived.failedStage,
    resumeTarget: resumeTargetForStage(resumeStage),
    modelingIdeaId: modelingIdea.value,
    sourceVideoId: sourceVideoId.value,
    channelId: channelId.value,
    attemptCount: validAttemptCount(run.attemptCount) ?? validAttemptCount(raw?.attemptCount) ?? 0,
    incidentHistory,
    contentProjectId,
    sourceModelingSpecVersion: run.sourceModelingSpecVersion ?? (typeof raw?.sourceModelingSpecVersion === "string" ? raw.sourceModelingSpecVersion : null),
    failureFingerprint: run.failureFingerprint ?? (typeof raw?.failureFingerprint === "string" ? raw.failureFingerprint : null),
  };
}

export function resolveResumableRun(runs: ResumableRunInput[], expected: { sourceVideoId: string; channelId: string; runId?: string; modelingIdeaId?: string }, now = Date.now()): ResumeDecision {
  const runningCandidates = runs.filter((run) => run.status === "RUNNING" && run.sourceVideoId === expected.sourceVideoId && (!expected.runId || run.id === expected.runId));
  for (const run of runningCandidates) {
    const lease = validExecutionLease(readCheckpoint(run).executionLease);
    if (isExecutionLive(lease, now)) return { status: "ACTIVE_RUN_IN_PROGRESS", runId: run.id, executionId: lease!.executionId, activeStage: lease!.activeStage };
    if (expected.runId || expected.modelingIdeaId) return { status: "NEEDS_REVIEW", reason: "STALE_RUNNING_RECONCILIATION_REQUIRED", runId: run.id };
  }
  const sourceCandidates = runs.filter((run) => (run.status === "FAILED" || run.status === "PAUSED") && run.sourceVideoId === expected.sourceVideoId);
  const candidates = sourceCandidates.filter((run) => {
    if (expected.runId && run.id !== expected.runId) return false;
    if (expected.modelingIdeaId) {
      const raw = asRecord(run.checkpoint);
      const modelingIdea = uniqueString([run.modelingIdeaId, run.ideaId, raw?.modelingIdeaId]);
      return !modelingIdea.conflict && modelingIdea.value === expected.modelingIdeaId;
    }
    return true;
  }).filter((run) => {
    const raw = readCheckpoint(run);
    const failedStage = run.failedStage ?? raw.failedStage;
    const hasModelingIdea = Boolean(run.modelingIdea) || Boolean(run.modelingIdeaId) || Boolean(run.ideaId) || Boolean(raw.modelingIdeaId);
    return !(failedStage === 1 && !hasModelingIdea);
  });
  if ((expected.runId || expected.modelingIdeaId) && !candidates.length) return { status: "NEEDS_REVIEW", reason: "TARGET_RUN_NOT_FOUND", runId: expected.runId ?? sourceCandidates[0]?.id ?? "unknown" };
  if (!candidates.length) return { status: "NONE" };
  if (candidates.length > 1) return { status: "NEEDS_REVIEW", reason: "MULTIPLE_RESUMABLE_RUNS", runId: candidates[0].id };
  const run = candidates[0];
  const checkpoint = checkpointForRun(run, expected);
  if (!checkpoint) return { status: "NEEDS_REVIEW", reason: "CHECKPOINT_AMBIGUOUS_OR_CONTEXT_MISMATCH", runId: run.id };
  const resumeStage = checkpoint.failedStage ?? (checkpoint.lastCompletedStage < 5 ? (checkpoint.lastCompletedStage + 1) as ResumeStage : null);
  // A Stage 1 failure can happen before Gemini returns a Modeling Idea. It is
  // a failed attempt, not a resumable downstream checkpoint; allow the UI to
  // start a fresh run while preserving the failed run in history.
  const modelingIdea = run.modelingIdea;
  if (resumeStage === 1 && !modelingIdea) return { status: "NONE" };
  if (!modelingIdea || String((modelingIdea as { id?: unknown }).id ?? "") !== checkpoint.modelingIdeaId) return { status: "NEEDS_REVIEW", reason: "MODELING_IDEA_MISSING_OR_MISMATCH", runId: run.id };
  if (!resumeStage) return { status: "NEEDS_REVIEW", reason: "CHECKPOINT_COMPLETE_WITHOUT_TARGET", runId: run.id };
  return { status: "RESUME", run, checkpoint, failedStage: resumeStage, modelingIdeaId: checkpoint.modelingIdeaId, modelingIdea };
}

export function assertNoWrongStageRestart(state: Pick<AuthoritativeResumeState, "lastCompletedStage" | "failedStage"> & { resumeTarget?: ResumeTarget | null }, targetStage: number) {
  if (targetStage === 1 && state.lastCompletedStage === 1 && state.failedStage === 2 && state.resumeTarget === "CONTENT_PROJECT_CREATION") throw new Error("RESUME_STATE_INCONSISTENT");
}

export function prepareResumeSteps(steps: Array<{ key: string; label: string; status: string; detail?: string; error?: string; startedAt?: string; completedAt?: string }>): Array<{ key: string; label: string; status: "pending" | "running" | "completed" | "failed"; detail?: string; error?: string; startedAt?: string; completedAt?: string }> {
  const derived = deriveStageStateFromSteps(steps);
  if (derived.status !== "OK") throw new Error("RESUME_STATE_INCONSISTENT");
  const targetStage = derived.failedStage ?? (derived.lastCompletedStage < 5 ? (derived.lastCompletedStage + 1) as ResumeStage : null);
  if (!targetStage) throw new Error("RESUME_STATE_INCONSISTENT");
  return stageKeys.map((key, index) => {
    const source = steps.find((step) => step.key === key);
    const preserved = source ? { ...source } : { key, label: key, status: "pending" };
    if (index < targetStage - 1) return { ...preserved, status: "completed" as const, error: undefined };
    if (index === targetStage - 1) return { ...preserved, status: "running" as const, error: undefined, startedAt: new Date().toISOString(), completedAt: undefined };
    return { ...preserved, status: "pending" as const, error: undefined, startedAt: undefined, completedAt: undefined };
  });
}

export function checkpointPatch(checkpoint: AutomationCheckpoint, overrides: Partial<AutomationCheckpoint> = {}) {
  return { ...checkpoint, ...overrides, version: 1 };
}
