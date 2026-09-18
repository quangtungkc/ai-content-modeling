import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const validationExe = process.env.VALIDATION_EXE || "C:\\Users\\Admin\\Desktop\\ytuongnoidung\\release\\0.2.90-validation\\win-unpacked\\Modeling AI.exe";
const databaseUrl = "file:C:/Users/Admin/AppData/Roaming/ai-content-modeling/modeling-ai.db";
const cdpPort = Number(process.env.CDP_PORT || 9222);
const runId = process.env.VALIDATION_RUN_ID || "cmu2bmm9s0000k598177tlqzk";
const modelingIdeaId = process.env.VALIDATION_MODELING_IDEA_ID || "cmu2bniq10002k5980rr55hjp";
const sourceVideoId = process.env.VALIDATION_SOURCE_VIDEO_ID || "cmtz21vnv003nk57cd5ra69ee";
const sourceUrl = "https://www.facebook.com/reel/1668944091489780/";
const userDataRoot = "C:\\Users\\Admin\\AppData\\Roaming\\ai-content-modeling";
export const HARNESS_GLOBAL_TIMEOUT_MS = Number(process.env.HARNESS_GLOBAL_TIMEOUT_MS || 600_000);
export const HARNESS_POLL_INTERVAL_MS = Number(process.env.HARNESS_POLL_INTERVAL_MS || 2_000);
const ACTIVE_GEMINI_COMMAND_STATES = new Set(["QUEUED", "SUBMITTED", "GENERATING"]);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function powershell(script) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "POWERSHELL_QUERY_FAILED");
  return result.stdout.trim();
}

function validationProcessIds() {
  const escaped = validationExe.replaceAll("'", "''");
  const output = powershell(`$exe='${escaped}'; @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -eq $exe } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`);
  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map(Number).filter(Number.isInteger);
}

function stopValidationProcesses() {
  const pids = validationProcessIds();
  if (!pids.length) return [];
  powershell(`$ids=@(${pids.join(",")}); foreach($id in $ids){ Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }`);
  return pids;
}

async function getJson(pathname) {
  const response = await fetch(`http://127.0.0.1:${cdpPort}${pathname}`);
  if (!response.ok) throw new Error(`CDP_HTTP_${response.status}`);
  return response.json();
}

async function waitForPageTarget(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await getJson("/json/list");
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* CDP is not ready yet. */ }
    await sleep(500);
  }
  throw new Error("CDP_PAGE_TARGET_TIMEOUT");
}

class CdpPage {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async call(method, params = {}) {
    await this.ready;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || "CDP_RUNTIME_EVALUATION_FAILED");
    return result?.result?.value;
  }

  close() {
    this.socket.close();
  }
}

async function waitForDom(page, predicate, label, timeoutMs = 60_000) {
  let lastState = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(`(() => { const body = document.body?.innerText || ""; const buttons = [...document.querySelectorAll("button")].map((button) => ({ text: (button.innerText || "").trim(), disabled: button.disabled })); const links = [...document.querySelectorAll("a")].map((link) => ({ text: (link.innerText || "").trim(), href: link.href })); const selects = [...document.querySelectorAll("select")].map((select) => ({ value: select.value, options: [...select.options].map((option) => option.value) })); return { title: document.title, url: location.href, body: body.slice(0, 16000), buttons, links, selects }; })()`);
    lastState = state;
    if (predicate(state)) return state;
    await sleep(500);
  }
  throw new Error(`CDP_DOM_EXPECTATION_TIMEOUT:${label}:${JSON.stringify(lastState)}`);
}

function cleanJson(value) {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? Number(item) : item));
}

async function readRun(db) {
  const rows = await db.$queryRawUnsafe(`SELECT id,sourceVideoId,channelId,ideaId,modelingIdeaId,status,lastCompletedStage,failedStage,resumeTarget,attemptCount,failureFingerprint,checkpoint,incidentHistory,steps,projectId,updatedAt FROM AutomationRun WHERE id=?`, runId);
  return cleanJson(rows[0] ?? null);
}

async function readProjectState(db, projectId) {
  if (!projectId) return { project: null, scenes: [] };
  const project = await db.$queryRawUnsafe(`SELECT id,ideaId,status,sourceVideoId,sourceVideoUrl,modelingPolicy,modelingFidelityTarget,sourceModelingSpecVersion,sourceModelingSpec,characterDesign,createdAt,updatedAt FROM ContentProject WHERE id=?`, projectId);
  const scenes = await db.$queryRawUnsafe(`SELECT id,projectId,sceneNumber,sourceSceneId,sourceSceneOrder,sourceSceneStartTime,sourceSceneEndTime,sourceDuration,targetDuration,durationDelta,durationRatio,timingStatus,cameraSpec,actionSequence,spatialSpec,mustPreserve,allowedTransformations,status FROM StoryboardScene WHERE projectId=? ORDER BY sceneNumber`, projectId);
  return { project: cleanJson(project[0] ?? null), scenes: cleanJson(scenes) };
}

function readNdjson(filePath) {
  try {
    return readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch { return []; }
}

export function readGeminiCommandLifecycle(since = 0) {
  const events = readNdjson(`${userDataRoot}\\browser-actions.ndjson`)
    .filter((entry) => entry?.action === "gemini-command-lifecycle" && Number(entry.sequence || 0) > since);
  const commands = new Map();
  for (const event of events) {
    if (!event.commandId) continue;
    commands.set(event.commandId, { ...commands.get(event.commandId), ...event });
  }
  return [...commands.values()].sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
}

function lifecycleBaseline() {
  const entries = readNdjson(`${userDataRoot}\\browser-actions.ndjson`);
  return Math.max(0, ...entries.map((entry) => Number(entry?.sequence || 0)).filter(Number.isFinite));
}

export function classifyStage2Observation({ run, commands, modelingIdeaId: expectedModelingIdeaId }) {
  if (run?.postClickObserved === false) return { terminal: false, reason: "WAITING_FOR_POST_CLICK_TRANSITION", activeCommand: null };
  const activeCommands = (commands || []).filter((command) => ACTIVE_GEMINI_COMMAND_STATES.has(command?.state));
  const activeCommand = activeCommands.at(-1) || null;
  const contentProjectFailed = run?.steps?.some((step) => step.key === "content-project" && step.status === "failed") === true;
  const stage2Pass = run?.status === "PAUSED" && run.lastCompletedStage === 2 && run.failedStage === null && run.resumeTarget === null && run.modelingIdeaId === expectedModelingIdeaId && Boolean(run.projectId);
  if (stage2Pass) return { terminal: true, reason: "STAGE_2_PASS", activeCommand: null };
  if (run?.status === "NEEDS_REVIEW" || run?.status === "PAUSED") return { terminal: true, reason: "RUN_PAUSED_OR_NEEDS_REVIEW", activeCommand };
  if (contentProjectFailed || (run?.status === "FAILED" && run?.failedStage === 2)) return { terminal: true, reason: "STAGE_2_FAIL", activeCommand };
  if (activeCommand) return { terminal: false, reason: "ACTIVE_GEMINI_COMMAND", activeCommand };
  const terminalFailure = (commands || []).filter((command) => ["TIMEOUT", "FAILED"].includes(command?.state)).at(-1) || null;
  if (terminalFailure) return { terminal: true, reason: "GEMINI_COMMAND_TERMINAL_FAILURE", activeCommand: terminalFailure };
  return { terminal: false, reason: "RUNNING_OR_PROCESSING", activeCommand: null };
}

export async function waitForStage2Terminal({ readState, timeoutMs = HARNESS_GLOBAL_TIMEOUT_MS, pollMs = HARNESS_POLL_INTERVAL_MS, now = Date.now, wait = sleep }) {
  const startedAt = now();
  let lastObservation = null;
  while (now() - startedAt < timeoutMs) {
    lastObservation = await readState();
    const classification = classifyStage2Observation(lastObservation);
    if (classification.terminal) return { ...classification, timedOut: false, elapsedMs: now() - startedAt, observation: lastObservation };
    await wait(pollMs);
  }
  lastObservation = await readState();
  const classification = classifyStage2Observation(lastObservation);
  return { ...classification, timedOut: true, reason: "HARNESS_GLOBAL_TIMEOUT", elapsedMs: now() - startedAt, observation: lastObservation };
}

async function main() {
  if (!existsSync(validationExe)) throw new Error(`VALIDATION_EXE_MISSING: ${validationExe}`);
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let child;
  let page;
  try {
    const stoppedPids = stopValidationProcesses();
    child = spawn(validationExe, [`--remote-debugging-port=${cdpPort}`], { windowsHide: true, stdio: "ignore" });
    const target = await waitForPageTarget();
    page = new CdpPage(target.webSocketDebuggerUrl);
    const validationUrl = `http://127.0.0.1:3210/?runId=${encodeURIComponent(runId)}&modelingIdeaId=${encodeURIComponent(modelingIdeaId)}&validationStopAfterStage=2`;
    await page.call("Page.navigate", { url: validationUrl });
    await waitForDom(page, (state) => state.body.includes("AI Content Modeling") && state.selects.some((select) => select.options.includes("168")) && state.buttons.some((button) => button.text === "Áp dụng"), "dashboard-filters");

    const before = await readRun(db);
    const sourceSnapshot = await db.$queryRawUnsafe(`SELECT id,url,caption FROM CompetitorVideo WHERE id=?`, sourceVideoId);
    if (!before || before.sourceVideoId !== sourceVideoId || before.ideaId !== modelingIdeaId) throw new Error("VALIDATION_TARGET_RUN_MISMATCH");
    if (!sourceSnapshot[0]?.caption || sourceSnapshot[0].url !== sourceUrl) throw new Error("SOURCE_VIDEO_EVIDENCE_MISMATCH");

    const filterResult = await page.evaluate(`(() => { const select = [...document.querySelectorAll("select")].find((item) => [...item.options].some((option) => option.value === "168")); if (!select) return { ok: false, reason: "PERIOD_SELECT_NOT_FOUND" }; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set; setter?.call(select, "168"); select.dispatchEvent(new Event("input", { bubbles: true })); select.dispatchEvent(new Event("change", { bubbles: true })); const apply = [...document.querySelectorAll("button")].find((button) => (button.innerText || "").trim() === "Áp dụng"); if (!apply) return { ok: false, reason: "APPLY_BUTTON_NOT_FOUND", value: select.value }; apply.click(); return { ok: true, value: select.value }; })()`);
    if (!filterResult?.ok) throw new Error(`PERIOD_FILTER_SETUP_FAILED:${JSON.stringify(filterResult)}`);
    await waitForDom(page, (state) => state.selects[0]?.value === "168" && state.links.some((link) => link.href.includes("1668944091489780")), "source-video");
    const analysisClick = await page.evaluate(`(() => { const link = [...document.querySelectorAll("a")].find((item) => item.href.includes("1668944091489780")); const row = link?.closest("tr"); const button = [...(row?.querySelectorAll("button") || [])].find((item) => (item.innerText || "").trim() === "Xem phân tích"); if (!button) return { ok: false, reason: "SOURCE_ANALYSIS_BUTTON_NOT_FOUND" }; button.click(); return { ok: true }; })()`);
    if (!analysisClick?.ok) throw new Error(analysisClick?.reason || "SOURCE_ANALYSIS_CLICK_FAILED");
    const ready = await waitForDom(page, (state) => state.buttons.some((button) => button.text === "Tiếp tục phiên chạy"), "resume-button");
    const automatic = ready.buttons.find((button) => button.text === "Tiếp tục phiên chạy");
    if (!automatic || automatic.disabled || automatic.text !== "Tiếp tục phiên chạy") throw new Error(`RESUME_TARGET_NOT_READY: ${JSON.stringify(ready.buttons)}`);
    const beforeClick = await readRun(db);
    const clickAt = new Date().toISOString();
    const browserActionSequenceBeforeClick = lifecycleBaseline();
    const clickResult = await page.evaluate(`(() => { const button = [...document.querySelectorAll("button")].find((item) => (item.innerText || "").trim() === "Tiếp tục phiên chạy"); if (!button || button.disabled) return { ok: false, reason: "RESUME_BUTTON_DISABLED_OR_MISSING" }; button.click(); return { ok: true }; })()`);
    if (!clickResult?.ok) throw new Error(clickResult?.reason || "RESUME_BUTTON_CLICK_FAILED");

    const waitResult = await waitForStage2Terminal({
      readState: async () => {
        const run = await readRun(db);
        const postClickObserved = Boolean(run?.updatedAt && beforeClick?.updatedAt && new Date(run.updatedAt).getTime() > new Date(beforeClick.updatedAt).getTime());
        return { run: run ? { ...run, postClickObserved } : run, commands: readGeminiCommandLifecycle(browserActionSequenceBeforeClick), modelingIdeaId };
      },
    });
    const after = waitResult.observation?.run ?? null;
    const postClickObserved = Boolean(after?.updatedAt && before?.updatedAt && new Date(after.updatedAt).getTime() > new Date(before.updatedAt).getTime());
    const projectState = await readProjectState(db, after?.projectId);
    const report = {
      validationExe,
      cdpPort,
      stoppedPids,
      clickAt,
      clickCount: 1,
      before,
      beforeClick,
      after,
      postClickObserved,
      harnessGlobalTimeoutMs: HARNESS_GLOBAL_TIMEOUT_MS,
      harnessWait: {
        reason: waitResult.reason,
        elapsedMs: waitResult.elapsedMs,
        timedOut: waitResult.timedOut,
        activeCommand: waitResult.activeCommand ? {
          commandId: waitResult.activeCommand.commandId,
          parentCommandId: waitResult.activeCommand.parentCommandId || null,
          state: waitResult.activeCommand.state,
          commandSentAt: waitResult.activeCommand.commandSentAt || null,
          responseCompletedAt: waitResult.activeCommand.responseCompletedAt || null,
          responseCapturedAt: waitResult.activeCommand.responseCapturedAt || null,
        } : null,
        lastCheckpoint: after?.checkpoint ?? null,
      },
      sourceVideo: cleanJson(sourceSnapshot[0]),
      project: projectState.project,
      scenes: projectState.scenes,
      stage2Pass: Boolean(waitResult.reason === "STAGE_2_PASS" && after?.status === "PAUSED" && after.lastCompletedStage === 2 && after.failedStage === null && after.modelingIdeaId === modelingIdeaId && after.projectId && projectState.scenes.length > 0),
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.stage2Pass) process.exitCode = 1;
  } finally {
    page?.close();
    if (child && !child.killed) child.kill();
    try { stopValidationProcesses(); } catch { /* Cleanup must not hide the validation result. */ }
    await db.$disconnect();
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}`) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
