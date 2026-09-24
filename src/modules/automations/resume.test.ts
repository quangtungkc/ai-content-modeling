import { describe, expect, it } from "vitest";
import { assertNoWrongStageRestart, buildAuthoritativePersistencePatch, checkpointPatch, isExecutionLive, prepareResumeSteps, reconcileStaleRunningRun, resolveResumableRun, type ResumableRunInput } from "./resume";

const baseRun = (overrides: Partial<ResumableRunInput> = {}): ResumableRunInput => ({
  id: "run-1",
  status: "FAILED",
  sourceVideoId: "video-1",
  channelId: "channel-1",
  ideaId: "idea-1",
  modelingIdeaId: "idea-1",
  lastCompletedStage: 1,
  failedStage: 2,
  resumeTarget: "CONTENT_PROJECT_CREATION",
  attemptCount: 2,
  incidentHistory: [{ incidentId: "incident-1", status: "PENDING" }],
  failureFingerprint: "content_project_scene_creation_failed_after_modeling_idea_success",
  checkpoint: { version: 1, runId: "run-1", lastCompletedStage: 1, failedStage: 2, modelingIdeaId: "idea-1", sourceVideoId: "video-1", channelId: "channel-1", failureFingerprint: "content_project_scene_creation_failed_after_modeling_idea_success" },
  modelingIdea: { id: "idea-1", title: "Existing idea" },
  steps: [
    { key: "modeling-idea", label: "Modeling Idea", status: "completed" },
    { key: "content-project", label: "Content Project", status: "failed" },
    { key: "images", label: "Images", status: "pending" },
    { key: "videos", label: "Videos", status: "pending" },
    { key: "final-video", label: "Final", status: "pending" },
  ],
  ...overrides,
});

const stage1CompletedSteps = baseRun().steps!.map((step) => step.key === "modeling-idea" ? { ...step, status: "completed" } : { ...step, status: "pending" });
const stage2CompletedSteps = baseRun().steps!.map((step) => step.key === "modeling-idea" || step.key === "content-project" ? { ...step, status: "completed" } : { ...step, status: "pending" });

describe("automatic run checkpoint resume", () => {
  it("creates a new run decision when no resumable run exists", () => {
    expect(resolveResumableRun([], { sourceVideoId: "video-1", channelId: "channel-1" })).toEqual({ status: "NONE" });
  });

  it("allows a fresh run after Stage 1 failed before a Modeling Idea was created", () => {
    const decision = resolveResumableRun([baseRun({
      id: "stage-1-failed",
      ideaId: null,
      modelingIdeaId: null,
      modelingIdea: null,
      lastCompletedStage: 0,
      failedStage: 1,
      resumeTarget: "MODELING_IDEA_CREATION",
      checkpoint: { version: 1, runId: "stage-1-failed", lastCompletedStage: 0, failedStage: 1, modelingIdeaId: null, sourceVideoId: "video-1", channelId: "channel-1" },
    })], { sourceVideoId: "video-1", channelId: "channel-1" });
    expect(decision).toEqual({ status: "NONE" });
  });

  it("ignores an obsolete no-idea Stage 1 failure when a downstream checkpoint is resumable", () => {
    const stage3 = baseRun({
      id: "stage-3-failed",
      lastCompletedStage: 2,
      failedStage: 3,
      resumeTarget: "IMAGES",
      projectId: "project-1",
      checkpoint: { version: 1, runId: "stage-3-failed", lastCompletedStage: 2, failedStage: 3, resumeTarget: "IMAGES", modelingIdeaId: "idea-1", sourceVideoId: "video-1", channelId: "channel-1", contentProjectId: "project-1" },
      steps: baseRun().steps!.map((step) => step.key === "modeling-idea" || step.key === "content-project" ? { ...step, status: "completed" } : step.key === "images" ? { ...step, status: "failed" } : { ...step, status: "pending" }),
    });
    const stage1 = baseRun({ id: "obsolete-stage-1", ideaId: null, modelingIdeaId: null, modelingIdea: null, lastCompletedStage: 0, failedStage: 1, resumeTarget: "MODELING_IDEA_CREATION", checkpoint: { version: 1, runId: "obsolete-stage-1", lastCompletedStage: 0, failedStage: 1, modelingIdeaId: null, sourceVideoId: "video-1", channelId: "channel-1" } });
    const decision = resolveResumableRun([stage1, stage3], { sourceVideoId: "video-1", channelId: "channel-1" });
    expect(decision).toMatchObject({ status: "RESUME", run: { id: "stage-3-failed" }, failedStage: 3 });
  });

  it("resumes the same run at Content Project stage", () => {
    const decision = resolveResumableRun([baseRun()], { sourceVideoId: "video-1", channelId: "channel-1" });
    expect(decision.status).toBe("RESUME");
    if (decision.status !== "RESUME") return;
    expect(decision.run.id).toBe("run-1");
    expect(decision.modelingIdeaId).toBe("idea-1");
    expect(decision.failedStage).toBe(2);
  });

  it("reuses the existing Modeling Idea and never derives a new id", () => {
    const decision = resolveResumableRun([baseRun({ modelingIdeaId: null })], { sourceVideoId: "video-1", channelId: "channel-1" });
    expect(decision.status).toBe("RESUME");
    if (decision.status === "RESUME") expect(decision.modelingIdeaId).toBe("idea-1");
  });

  it("prepares Stage 1 as completed and Stage 2 as the only running target", () => {
    const steps = prepareResumeSteps(baseRun().steps!);
    expect(steps.map((step) => step.status)).toEqual(["completed", "running", "pending", "pending", "pending"]);
  });

  it("resumes a paused Stage 2 checkpoint at Stage 3 without recreating the project", () => {
    const run = baseRun({
      status: "PAUSED",
      lastCompletedStage: 2,
      failedStage: null,
      resumeTarget: null,
      projectId: "project-1",
      failureFingerprint: null,
      checkpoint: { version: 1, runId: "run-1", lastCompletedStage: 2, failedStage: null, resumeTarget: null, modelingIdeaId: "idea-1", sourceVideoId: "video-1", channelId: "channel-1", contentProjectId: "project-1", failureFingerprint: null },
      steps: stage2CompletedSteps,
    });
    const decision = resolveResumableRun([run], { sourceVideoId: "video-1", channelId: "channel-1" });
    expect(decision).toMatchObject({ status: "RESUME", failedStage: 3, checkpoint: { lastCompletedStage: 2, resumeTarget: "IMAGES", contentProjectId: "project-1" } });
    expect(prepareResumeSteps(run.steps!).map((step) => step.status)).toEqual(["completed", "completed", "running", "pending", "pending"]);
  });

  it("guards multiple failed candidates as NEEDS_REVIEW", () => {
    const decision = resolveResumableRun([baseRun(), baseRun({ id: "run-2" })], { sourceVideoId: "video-1", channelId: "channel-1" });
    expect(decision).toMatchObject({ status: "NEEDS_REVIEW", reason: "MULTIPLE_RESUMABLE_RUNS" });
  });

  it("selects an explicitly requested runId from multiple failed candidates", () => {
    const decision = resolveResumableRun([baseRun(), baseRun({ id: "run-2" })], { sourceVideoId: "video-1", channelId: "channel-1", runId: "run-2", modelingIdeaId: "idea-1" });
    expect(decision).toMatchObject({ status: "RESUME", run: { id: "run-2" }, modelingIdeaId: "idea-1" });
  });

  it("selects an explicitly requested Modeling Idea without guessing", () => {
    const decision = resolveResumableRun([baseRun(), baseRun({ id: "run-2", ideaId: "idea-2", modelingIdeaId: "idea-2", modelingIdea: { id: "idea-2" }, checkpoint: { version: 1, runId: "run-2", lastCompletedStage: 1, failedStage: 2, resumeTarget: "CONTENT_PROJECT_CREATION", modelingIdeaId: "idea-2", sourceVideoId: "video-1", channelId: "channel-1" } })], { sourceVideoId: "video-1", channelId: "channel-1", modelingIdeaId: "idea-2" });
    expect(decision).toMatchObject({ status: "RESUME", run: { id: "run-2" }, modelingIdeaId: "idea-2" });
  });

  it("does not silently create a new run when the requested target is missing", () => {
    const decision = resolveResumableRun([baseRun()], { sourceVideoId: "video-1", channelId: "channel-1", runId: "missing-run", modelingIdeaId: "idea-1" });
    expect(decision).toMatchObject({ status: "NEEDS_REVIEW", reason: "TARGET_RUN_NOT_FOUND", runId: "missing-run" });
  });

  it("guards a mismatched checkpoint source", () => {
    const decision = resolveResumableRun([baseRun({ checkpoint: { version: 1, runId: "run-1", lastCompletedStage: 1, failedStage: 2, modelingIdeaId: "idea-1", sourceVideoId: "wrong-video", channelId: "channel-1" } })], { sourceVideoId: "video-1", channelId: "channel-1" });
    expect(decision).toMatchObject({ status: "NEEDS_REVIEW", reason: "CHECKPOINT_AMBIGUOUS_OR_CONTEXT_MISMATCH" });
  });

  it("preserves attempt count and incident fingerprint", () => {
    const run = baseRun();
    const decision = resolveResumableRun([run], { sourceVideoId: "video-1", channelId: "channel-1" });
    expect(decision.status).toBe("RESUME");
    if (decision.status !== "RESUME") return;
    expect(decision.run.attemptCount).toBe(2);
    expect(decision.checkpoint.failureFingerprint).toBe("content_project_scene_creation_failed_after_modeling_idea_success");
  });

  it("preserves the one-run Gemini conversation binding through resume", () => {
    const url = "https://gemini.google.com/app/conversation-1";
    const decision = resolveResumableRun([baseRun({ checkpoint: { ...baseRun().checkpoint, geminiConversationId: "conversation-1", geminiConversationUrl: url, geminiConversationOwnerRunId: "run-1", geminiConversationState: "ACTIVE", lastGeminiStage: "MODELING_IDEA", lastGeminiCommandId: "command-1" } })], { sourceVideoId: "video-1", channelId: "channel-1" });
    expect(decision.status).toBe("RESUME");
    if (decision.status !== "RESUME") return;
    expect(decision.checkpoint).toMatchObject({ geminiConversationId: "conversation-1", geminiConversationUrl: url, geminiConversationOwnerRunId: "run-1", geminiConversationState: "ACTIVE", lastGeminiStage: "MODELING_IDEA", lastGeminiCommandId: "command-1" });
  });

  it("preserves checkpoint context while updating only the resume stage", () => {
    const checkpoint = checkpointPatch(baseRun().checkpoint as never, { failedStage: 2, lastCompletedStage: 1 });
    expect(checkpoint).toMatchObject({ version: 1, runId: "run-1", modelingIdeaId: "idea-1", sourceVideoId: "video-1", channelId: "channel-1", lastCompletedStage: 1, failedStage: 2 });
  });

  it("reconciles stale columns from clear Stage 1/2 steps", () => {
    const decision = resolveResumableRun([baseRun({ lastCompletedStage: 0, checkpoint: { version: 1, runId: "run-1", lastCompletedStage: 0, failedStage: 2, modelingIdeaId: "idea-1", sourceVideoId: "video-1", channelId: "channel-1" } })], { sourceVideoId: "video-1", channelId: "channel-1" });
    expect(decision).toMatchObject({ status: "RESUME", failedStage: 2, modelingIdeaId: "idea-1" });
  });

  it("CASE 1: Stage 1 PASS writes the Modeling Idea and completed stage", () => {
    const result = buildAuthoritativePersistencePatch({
      existing: baseRun({ modelingIdeaId: null, ideaId: null, lastCompletedStage: 0, failedStage: null, resumeTarget: null, attemptCount: 0, incidentHistory: [] }),
      steps: stage1CompletedSteps,
      fields: { ideaId: "idea-1", modelingIdeaId: "idea-1", channelId: "channel-1", lastCompletedStage: 1, failedStage: null, resumeTarget: null },
    });
    expect(result).toMatchObject({ status: "OK", state: { lastCompletedStage: 1, failedStage: null, resumeTarget: null, modelingIdeaId: "idea-1" }, patch: { modelingIdeaId: "idea-1", lastCompletedStage: 1, failedStage: null, resumeTarget: null } });
  });

  it("CASE 2: Stage 2 FAIL writes the failed stage and Content Project target", () => {
    const result = buildAuthoritativePersistencePatch({ existing: baseRun(), steps: baseRun().steps, fields: { lastCompletedStage: 1, failedStage: 2 } });
    expect(result).toMatchObject({ status: "OK", state: { lastCompletedStage: 1, failedStage: 2, resumeTarget: "CONTENT_PROJECT_CREATION" }, patch: { failedStage: 2, resumeTarget: "CONTENT_PROJECT_CREATION" } });
  });

  it("CASE 3: rebuilds all authoritative fields when steps and columns disagree", () => {
    const result = buildAuthoritativePersistencePatch({ existing: baseRun({ modelingIdeaId: null, lastCompletedStage: 0, failedStage: null, resumeTarget: null, checkpoint: {} }), steps: baseRun().steps });
    expect(result).toMatchObject({ status: "OK", state: { modelingIdeaId: "idea-1", sourceVideoId: "video-1", channelId: "channel-1", lastCompletedStage: 1, failedStage: 2, resumeTarget: "CONTENT_PROJECT_CREATION", attemptCount: 2 } });
    if (result.status === "OK") expect(result.checkpoint).toMatchObject({ modelingIdeaId: "idea-1", sourceVideoId: "video-1", channelId: "channel-1", lastCompletedStage: 1, failedStage: 2, resumeTarget: "CONTENT_PROJECT_CREATION", attemptCount: 2 });
  });

  it("CASE 4: pauses ambiguous reconciliation for review", () => {
    const ambiguousSteps = baseRun().steps!.map((step) => step.key === "modeling-idea" ? { ...step, status: "pending" } : step.key === "content-project" ? { ...step, status: "failed" } : step);
    const result = buildAuthoritativePersistencePatch({ existing: baseRun(), steps: ambiguousSteps });
    expect(result).toMatchObject({ status: "NEEDS_REVIEW" });
  });

  it("CASE 5/6: the resolver prepares only Stage 2 for the old production run", () => {
    const decision = resolveResumableRun([baseRun({ id: "cmu2bmm9s0000k598177tlqzk", sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", ideaId: "cmu2bniq10002k5980rr55hjp", modelingIdeaId: null, lastCompletedStage: 0, failedStage: null, checkpoint: {}, modelingIdea: { id: "cmu2bniq10002k5980rr55hjp", title: "Production Modeling Idea" } })], { sourceVideoId: "cmtz21vnv003nk57cd5ra69ee", channelId: "channel-1" });
    expect(decision.status).toBe("RESUME");
    if (decision.status !== "RESUME") return;
    expect(decision.failedStage).toBe(2);
    expect(decision.checkpoint.resumeTarget).toBe("CONTENT_PROJECT_CREATION");
    expect(decision.modelingIdeaId).toBe("cmu2bniq10002k5980rr55hjp");
    expect(decision.checkpoint.sourceVideoId).toBe("cmtz21vnv003nk57cd5ra69ee");
    expect(prepareResumeSteps(decision.run.steps!).map((step) => step.status)).toEqual(["completed", "running", "pending", "pending", "pending"]);
  });

  it("CASE 7/8: preserves Modeling Idea, source video, and channel", () => {
    const result = buildAuthoritativePersistencePatch({ existing: baseRun(), steps: baseRun().steps });
    expect(result).toMatchObject({ status: "OK", state: { modelingIdeaId: "idea-1", sourceVideoId: "video-1", channelId: "channel-1" } });
  });

  it("CASE 9: preserves attemptCount", () => {
    const result = buildAuthoritativePersistencePatch({ existing: baseRun({ attemptCount: 4 }), steps: baseRun().steps });
    expect(result).toMatchObject({ status: "OK", state: { attemptCount: 4 }, patch: { attemptCount: 4 } });
  });

  it("CASE 10: preserves incident history", () => {
    const history = [{ incidentId: "incident-1", type: "CONTENT_PROJECT_CREATION_FAILED" }];
    const result = buildAuthoritativePersistencePatch({ existing: baseRun({ incidentHistory: history }), steps: baseRun().steps });
    expect(result).toMatchObject({ status: "OK", state: { incidentHistory: history }, patch: { incidentHistory: history } });
  });

  it("CASE 11: blocks a wrong-stage restart loudly", () => {
    expect(() => assertNoWrongStageRestart({ lastCompletedStage: 1, failedStage: 2, resumeTarget: "CONTENT_PROJECT_CREATION" }, 1)).toThrow("RESUME_STATE_INCONSISTENT");
    expect(() => assertNoWrongStageRestart({ lastCompletedStage: 1, failedStage: 2, resumeTarget: "CONTENT_PROJECT_CREATION" }, 2)).not.toThrow();
  });

  it("STALE CASE 1/11: protects a RUNNING run with a live execution lease", () => {
    const now = new Date("2026-09-16T00:00:30.000Z");
    const run = baseRun({ status: "RUNNING", steps: prepareResumeSteps(baseRun().steps!), checkpoint: { ...baseRun().checkpoint, executionLease: { executionId: "execution-1", appSessionId: "app-1", startedAt: "2026-09-16T00:00:00.000Z", heartbeatAt: "2026-09-16T00:00:20.000Z", activeStage: "content-project" } } });
    expect(reconcileStaleRunningRun(run, now)).toMatchObject({ status: "ACTIVE_RUN_IN_PROGRESS", lease: { executionId: "execution-1" } });
    expect(resolveResumableRun([run], { sourceVideoId: "video-1", channelId: "channel-1", runId: "run-1" }, now.getTime())).toMatchObject({ status: "ACTIVE_RUN_IN_PROGRESS", runId: "run-1" });
  });

  it("STALE CASE 2-7: reconciles an ownerless Stage 2 run without changing authoritative context", () => {
    const history = [{ incidentId: "preserve-me" }];
    const run = baseRun({ status: "RUNNING", steps: prepareResumeSteps(baseRun().steps!), attemptCount: 2, incidentHistory: history, checkpoint: { ...baseRun().checkpoint, executionLease: { executionId: "dead", appSessionId: "old-app", startedAt: "2026-09-15T00:00:00.000Z", heartbeatAt: "2026-09-15T00:00:01.000Z", activeStage: "content-project" } } });
    const reconciliation = reconcileStaleRunningRun(run, new Date("2026-09-16T00:00:00.000Z"));
    expect(reconciliation.status).toBe("RECOVERED");
    if (reconciliation.status !== "RECOVERED") return;
    expect(reconciliation.patch).toMatchObject({ status: "PAUSED", lastCompletedStage: 1, failedStage: 2, resumeTarget: "CONTENT_PROJECT_CREATION", modelingIdeaId: "idea-1", attemptCount: 2, incidentHistory: history });
    expect(reconciliation.checkpoint).toMatchObject({ modelingIdeaId: "idea-1", sourceVideoId: "video-1", attemptCount: 2, incidentHistory: history, executionLease: null });
    expect((reconciliation.patch.steps as Array<{ key: string; status: string }>).map((step) => step.status)).toEqual(["completed", "failed", "pending", "pending", "pending"]);
  });

  it("recovers a killed Stage 2 execution that was persisted as running", () => {
    const run = baseRun({
      status: "RUNNING",
      lastCompletedStage: 1,
      failedStage: null,
      resumeTarget: null,
      steps: baseRun().steps!.map((step) => step.key === "modeling-idea"
        ? { ...step, status: "completed" }
        : step.key === "content-project"
          ? { ...step, status: "running" }
          : { ...step, status: "pending" }),
      checkpoint: { ...baseRun().checkpoint, lastCompletedStage: 1, failedStage: null, resumeTarget: null, executionLease: null },
    });
    const reconciliation = reconcileStaleRunningRun(run, new Date("2026-09-16T00:00:00.000Z"));
    expect(reconciliation).toMatchObject({ status: "RECOVERED", patch: { status: "PAUSED", lastCompletedStage: 1, failedStage: 2, resumeTarget: "CONTENT_PROJECT_CREATION" } });
  });

  it("STALE CASE 8: sends an ambiguous ownerless RUNNING checkpoint to review", () => {
    const run = baseRun({ status: "RUNNING", steps: baseRun().steps!.map((step) => step.key === "modeling-idea" ? { ...step, status: "pending" } : step), checkpoint: { executionLease: null } });
    expect(reconcileStaleRunningRun(run, new Date("2026-09-16T00:00:00.000Z"))).toMatchObject({ status: "NEEDS_REVIEW" });
  });

  it("STALE CASE 9/10: recovers after restart or killed harness because a stale heartbeat is not live", () => {
    const staleLease = { executionId: "dead", appSessionId: "closed-app", startedAt: "2026-09-15T00:00:00.000Z", heartbeatAt: "2026-09-15T00:00:10.000Z", activeStage: "content-project" };
    expect(isExecutionLive(staleLease, new Date("2026-09-16T00:00:00.000Z").getTime())).toBe(false);
    expect(reconcileStaleRunningRun(baseRun({ status: "RUNNING", steps: prepareResumeSteps(baseRun().steps!), checkpoint: { ...baseRun().checkpoint, executionLease: staleLease } }), new Date("2026-09-16T00:00:00.000Z"))).toMatchObject({ status: "RECOVERED" });
  });

  it("STALE CASE 12/13: recovered PAUSED state uses the existing single-button resume path", () => {
    const run = baseRun({ status: "RUNNING", steps: prepareResumeSteps(baseRun().steps!), checkpoint: { ...baseRun().checkpoint, executionLease: null } });
    const reconciliation = reconcileStaleRunningRun(run, new Date("2026-09-16T00:00:00.000Z"));
    expect(reconciliation.status).toBe("RECOVERED");
    if (reconciliation.status !== "RECOVERED") return;
    const resumed = resolveResumableRun([{ ...run, status: "PAUSED", steps: reconciliation.patch.steps as ResumableRunInput["steps"], checkpoint: reconciliation.checkpoint }], { sourceVideoId: "video-1", channelId: "channel-1", runId: "run-1", modelingIdeaId: "idea-1" });
    expect(resumed).toMatchObject({ status: "RESUME", failedStage: 2, modelingIdeaId: "idea-1" });
  });
});
