import { describe, expect, it } from "vitest";
import { HARNESS_GLOBAL_TIMEOUT_MS, classifyStage2Observation, waitForStage2Terminal } from "./cdp-resume-validation.mjs";

const modelId = "cmu2bniq10002k5980rr55hjp";
const running = (overrides: Record<string, unknown> = {}) => ({
  status: "RUNNING",
  lastCompletedStage: 1,
  failedStage: 2,
  resumeTarget: "CONTENT_PROJECT_CREATION",
  modelingIdeaId: modelId,
  steps: [{ key: "content-project", status: "running" }],
  checkpoint: { stage: 2 },
  ...overrides,
});
const command = (state: string, commandId = "parent") => ({ commandId, state, commandSentAt: "2026-09-16T00:00:00.000Z" });

function stateReader(states: Array<{ run: Record<string, unknown>; commands: Array<Record<string, unknown>> }>) {
  let index = 0;
  return async () => ({ ...states[Math.min(index++, states.length - 1)], modelingIdeaId: modelId });
}

function clock() {
  let value = 0;
  return { now: () => value, wait: async (milliseconds: number) => { value += milliseconds; } };
}

describe("production validation harness wait lifecycle", () => {
  it("CASE 1 waits past 180 seconds while a Gemini command is still generating", async () => {
    const time = clock();
    const result = await waitForStage2Terminal({
      readState: stateReader([
        { run: running(), commands: [command("GENERATING")] },
        { run: running(), commands: [command("GENERATING")] },
        { run: running({ status: "PAUSED", lastCompletedStage: 2, failedStage: null, resumeTarget: null, projectId: "project-1" }), commands: [command("VALIDATED")] },
      ]),
      timeoutMs: 600_000,
      pollMs: 100_000,
      now: time.now,
      wait: time.wait,
    });
    expect(result.reason).toBe("STAGE_2_PASS");
    expect(result.elapsedMs).toBe(200_000);
  });

  it("CASE 2 follows an active format retry after its parent becomes terminal", async () => {
    const time = clock();
    const result = await waitForStage2Terminal({
      readState: stateReader([
        { run: running(), commands: [command("INVALID_RESPONSE", "parent"), command("GENERATING", "retry")] },
        { run: running(), commands: [command("INVALID_RESPONSE", "parent"), command("GENERATING", "retry")] },
        { run: running({ status: "FAILED", steps: [{ key: "content-project", status: "failed" }] }), commands: [command("INVALID_RESPONSE", "parent"), command("FAILED", "retry")] },
      ]),
      timeoutMs: 600_000,
      pollMs: 180_000,
      now: time.now,
      wait: time.wait,
    });
    expect(result.reason).toBe("STAGE_2_FAIL");
    expect(result.elapsedMs).toBe(360_000);
  });

  it("CASE 3 exits immediately when the app pauses after Stage 2", async () => {
    const time = clock();
    const result = await waitForStage2Terminal({ readState: stateReader([{ run: running({ status: "PAUSED", lastCompletedStage: 2, failedStage: null, resumeTarget: null, projectId: "project-1" }), commands: [] }]), now: time.now, wait: time.wait });
    expect(result).toMatchObject({ reason: "STAGE_2_PASS", timedOut: false, elapsedMs: 0 });
  });

  it("CASE 4 exits and reports a Stage 2 failure", async () => {
    const time = clock();
    const result = await waitForStage2Terminal({ readState: stateReader([{ run: running({ status: "FAILED", steps: [{ key: "content-project", status: "failed" }] }), commands: [] }]), now: time.now, wait: time.wait });
    expect(result.reason).toBe("STAGE_2_FAIL");
  });

  it("CASE 5 reports a terminal production Gemini timeout", () => {
    const result = classifyStage2Observation({ run: running(), commands: [command("TIMEOUT")], modelingIdeaId: modelId });
    expect(result).toMatchObject({ terminal: true, reason: "GEMINI_COMMAND_TERMINAL_FAILURE" });
  });

  it("CASE 6 returns global-timeout evidence after the bounded deadline", async () => {
    const time = clock();
    const result = await waitForStage2Terminal({
      readState: stateReader([{ run: running(), commands: [command("GENERATING")] }]),
      timeoutMs: 10_000,
      pollMs: 5_000,
      now: time.now,
      wait: time.wait,
    });
    expect(result).toMatchObject({ timedOut: true, reason: "HARNESS_GLOBAL_TIMEOUT" });
    expect(result.observation.run.checkpoint).toEqual({ stage: 2 });
    expect(result.observation.commands[0]).toMatchObject({ commandId: "parent", state: "GENERATING" });
  });

  it("CASE 7 defines a bounded global deadline and refuses to treat Stage 3 as success", () => {
    expect(HARNESS_GLOBAL_TIMEOUT_MS).toBe(600_000);
    const result = classifyStage2Observation({ run: running({ status: "PAUSED", lastCompletedStage: 3, failedStage: null, resumeTarget: null, projectId: "project-1" }), commands: [], modelingIdeaId: modelId });
    expect(result.reason).toBe("RUN_PAUSED_OR_NEEDS_REVIEW");
  });

  it("does not treat a pre-click PAUSED reconciliation as a Stage 2 terminal result", () => {
    const result = classifyStage2Observation({ run: running({ status: "PAUSED", postClickObserved: false }), commands: [], modelingIdeaId: modelId });
    expect(result).toMatchObject({ terminal: false, reason: "WAITING_FOR_POST_CLICK_TRANSITION" });
  });
});
