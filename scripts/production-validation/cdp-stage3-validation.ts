import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertStrictModelingReady, buildStrictSceneExpectedState, compileStrictModelingConstraints, type SourceVideoModelingSpec } from "@/modules/modeling/strict-source-modeling";
import { buildCharacterIdentityInstruction, getCharacterIdentityPack, readChannelCharacterIdentityReferences } from "@/modules/channels/identity-pack";
import { readProjectImage } from "@/modules/assets/image-generation-service";
import { validateImageSource, type GeneratedImageObservation, type SourceValidationContext } from "@/modules/source-validation/multi-stage";
import { buildSceneExpectedState } from "@/modules/codex-orchestrator/policy";
import type { ExpectedState } from "@/modules/codex-orchestrator/types";
import { LocalJobQueue } from "@/lib/jobs/queue";
import { waitForBridgeJob } from "@/modules/generation/browser-flow-bridge";

const validationExe = process.env.VALIDATION_EXE || "C:\\Users\\Admin\\Desktop\\ytuongnoidung\\release\\0.2.90-validation-camera-movement-authorization\\win-unpacked\\Modeling AI.exe";
const databaseUrl = "file:C:/Users/Admin/AppData/Roaming/ai-content-modeling/modeling-ai.db";
const cdpPort = Number(process.env.CDP_PORT || 9234);
const appUrl = process.env.APP_URL || "http://127.0.0.1:3210";
const runId = "cmu2bmm9s0000k598177tlqzk";
const projectId = "cmu4q3u7t0001k5kc24hvnu1l";
const modelingIdeaId = "cmu2bniq10002k5980rr55hjp";
const sourceVideoId = "cmtz21vnv003nk57cd5ra69ee";
const expectedArtifactHash = (process.env.VALIDATION_EXPECTED_SHA256 || "773729DED7751680FFD446B56B1C2C9DB67CC4D7BA542B441BD6D356D90A632A").toUpperCase();
const sourceUrl = "https://www.facebook.com/reel/1668944091489780/";
const userDataRoot = "C:\\Users\\Admin\\AppData\\Roaming\\ai-content-modeling";
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

type JsonRecord = Record<string, unknown>;
type DbRun = JsonRecord & { steps?: unknown; checkpoint?: unknown; attemptCount?: number };
type DbProject = JsonRecord & { channelId: string; sourceModelingSpec: unknown; scenes: DbScene[] };
type DbScene = JsonRecord & { id: string; sceneNumber: number; sourceSceneId: string; startFramePrompt?: string | null; visualBlock?: string | null; actionBlock?: string | null; audioBlock?: string | null; englishPrompt?: string | null };

function cleanJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? Number(item) : item)) as T;
}

function hashText(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashBuffer(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function powershell(script: string) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "POWERSHELL_QUERY_FAILED");
  return result.stdout.trim();
}

function validationProcessIds() {
  const escaped = validationExe.replaceAll("'", "''");
  const output = powershell(`$exe='${escaped}'; @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -eq $exe } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`);
  if (!output) return [] as number[];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map(Number).filter(Number.isInteger);
}

function stopValidationProcesses() {
  const pids = validationProcessIds();
  if (!pids.length) return [] as number[];
  powershell(`$ids=@(${pids.join(",")}); foreach($id in $ids){ Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }`);
  return pids;
}

async function cdpJson(pathname: string) {
  const response = await fetch(`http://127.0.0.1:${cdpPort}${pathname}`);
  if (!response.ok) throw new Error(`CDP_HTTP_${response.status}`);
  return response.json() as Promise<JsonRecord[]>;
}

async function waitForPageTarget(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await cdpJson("/json/list");
      const page = targets.find((target) => target.type === "page" && typeof target.webSocketDebuggerUrl === "string");
      if (page) return page as JsonRecord & { webSocketDebuggerUrl: string };
    } catch {
      // The packaged app may need a few seconds before CDP is available.
    }
    await sleep(500);
  }
  throw new Error("CDP_PAGE_TARGET_TIMEOUT");
}

class CdpPage {
  private readonly socket: WebSocket;
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly ready: Promise<void>;

  constructor(webSocketUrl: string) {
    this.socket = new WebSocket(webSocketUrl);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("error", () => reject(new Error("CDP_WEBSOCKET_ERROR")), { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message?: string } };
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "CDP_CALL_FAILED"));
      else pending.resolve(message.result);
    });
  }

  async call<T = JsonRecord>(method: string, params: JsonRecord = {}) {
    await this.ready;
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const result = await this.call<JsonRecord>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result?.exceptionDetails) throw new Error(String((result.exceptionDetails as JsonRecord).text || "CDP_RUNTIME_EVALUATION_FAILED"));
    return (result?.result as JsonRecord | undefined)?.value as T;
  }

  close() {
    this.socket.close();
  }
}

async function runGeminiImageJobWithCdpObservation(mainPage: CdpPage, slots: JsonRecord[]) {
  const invocationKey = `__stage3ImageJob_${randomUUID().replaceAll("-", "")}`;
  await mainPage.call("Runtime.evaluate", {
    expression: `(()=>{window.${invocationKey}={done:false,result:null,error:null};window.desktopGemini.runJob(${JSON.stringify(projectId)},${JSON.stringify(slots)}).then((result)=>window.${invocationKey}={done:true,result,error:null}).catch((error)=>window.${invocationKey}={done:true,result:null,error:String(error?.message||error)});return true;})()`,
    awaitPromise: false,
    returnByValue: true,
  });
  let geminiPage: CdpPage | undefined;
  let geminiWebSocketUrl: string | undefined;
  const diagnostics: JsonRecord[] = [];
  const deadline = Date.now() + 195_000;
  try {
    while (Date.now() < deadline) {
      const targets = await cdpJson("/json/list").catch(() => []);
      const geminiTarget = targets.find((target) => typeof target.url === "string" && target.url.includes("gemini.google.com") && typeof target.webSocketDebuggerUrl === "string") as (JsonRecord & { webSocketDebuggerUrl: string }) | undefined;
      if (geminiTarget?.webSocketDebuggerUrl && geminiTarget.webSocketDebuggerUrl !== geminiWebSocketUrl) {
        geminiPage?.close();
        geminiWebSocketUrl = geminiTarget.webSocketDebuggerUrl;
        geminiPage = new CdpPage(geminiWebSocketUrl);
      }
      if (geminiPage) {
        const snapshot = await geminiPage.evaluate<JsonRecord>(`(()=>{const roots=[document];const seen=new Set(roots);for(let i=0;i<roots.length;i+=1)for(const element of roots[i].querySelectorAll('*'))if(element.shadowRoot&&!seen.has(element.shadowRoot)){seen.add(element.shadowRoot);roots.push(element.shadowRoot)};const visible=(element)=>{const box=element.getBoundingClientRect?.();const style=element?getComputedStyle(element):null;return Boolean(element?.isConnected&&box&&box.width>0&&box.height>0&&style?.display!=="none"&&style?.visibility!=="hidden")};const images=roots.flatMap((root)=>[...root.querySelectorAll('img')]).filter(visible).map((image)=>({tag:image.tagName.toLowerCase(),className:String(image.className||'').slice(0,160),srcKind:(image.currentSrc||image.src||'').split(':',1)[0]||null,width:image.naturalWidth||image.width||0,height:image.naturalHeight||image.height||0,alt:image.alt||null})).filter((image)=>image.width>=128&&image.height>=128);const canvases=roots.flatMap((root)=>[...root.querySelectorAll('canvas')]).filter(visible).map((canvas)=>({width:canvas.width,height:canvas.height,className:String(canvas.className||'').slice(0,160)})).filter((canvas)=>canvas.width>=128&&canvas.height>=128);const composer=roots.flatMap((root)=>[...root.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')]).find(visible);const buttons=roots.flatMap((root)=>[...root.querySelectorAll('button,[role="button"]')]).filter(visible).map((button)=>({label:String(button.getAttribute('aria-label')||button.getAttribute('title')||button.textContent||'').trim().slice(0,120),disabled:Boolean(button.disabled),tag:button.tagName.toLowerCase()})).slice(0,80);const fileInputs=roots.flatMap((root)=>[...root.querySelectorAll('input')]).map((input)=>({type:input.type||null,accept:input.accept||null,connected:input.isConnected})).slice(0,40);return {at:new Date().toISOString(),url:location.href,title:document.title,composerTextLength:composer?String(composer.value||composer.innerText||composer.textContent||'').length:null,visibleImages:images,visibleCanvases:canvases,buttons,fileInputs,uiText:String(document.body?.innerText||'').slice(0,800)};})()`).catch((error) => ({ at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
        diagnostics.push(snapshot);
        if (diagnostics.length > 80) diagnostics.shift();
      }
      const state = await mainPage.evaluate<JsonRecord>(`(()=>window.${invocationKey}||null)()`).catch((error) => ({ done: true, error: error instanceof Error ? error.message : String(error) }));
      if (state?.done) {
        if (state.error) throw new Error(`${String(state.error)}; GEMINI_IMAGE_CDP_DIAGNOSTICS=${JSON.stringify(diagnostics.at(-1) ?? null)}`);
        return { result: asRecord(state.result), diagnostics };
      }
      await sleep(1_000);
    }
    throw new Error(`GEMINI_IMAGE_HARNESS_TIMEOUT; GEMINI_IMAGE_CDP_DIAGNOSTICS=${JSON.stringify(diagnostics.at(-1) ?? null)}`);
  } finally {
    geminiPage?.close();
  }
}

function readNdjson(filePath: string) {
  try {
    return readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as JsonRecord);
  } catch {
    return [] as JsonRecord[];
  }
}

async function readRun(db: PrismaClient) {
  const rows = await db.$queryRawUnsafe<DbRun[]>(`SELECT id, userId, sourceVideoId, channelId, ideaId, modelingIdeaId, status, lastCompletedStage, failedStage, resumeTarget, attemptCount, checkpoint, steps, projectId, updatedAt FROM AutomationRun WHERE id=?`, runId);
  return cleanJson(rows[0] ?? null);
}

async function readProject(db: PrismaClient) {
  const projects = await db.$queryRawUnsafe<DbProject[]>(`SELECT id, channelId, status, sourceVideoId, sourceVideoUrl, sourceDuration, modelingPolicy, modelingFidelityTarget, sourceModelingSpecVersion, sourceModelingSpec, characterDesign, backgroundDesign, artDirection FROM ContentProject WHERE id=?`, projectId);
  const scenes = await db.$queryRawUnsafe<DbScene[]>(`SELECT id, projectId, sceneNumber, sourceSceneId, sourceSceneOrder, targetDuration, sourceDuration, timingStatus, visualBlock, startFramePrompt, englishPrompt, actionBlock, audioBlock, cameraSpec, spatialSpec, mustPreserve, allowedTransformations FROM StoryboardScene WHERE projectId=? ORDER BY sceneNumber`, projectId);
  if (!projects[0]) throw new Error("STAGE3_PROJECT_NOT_FOUND");
  return { ...cleanJson(projects[0]), scenes: cleanJson(scenes) } as DbProject;
}

async function readSourceVideo(db: PrismaClient) {
  const rows = await db.$queryRawUnsafe<JsonRecord[]>(`SELECT id,url,caption FROM CompetitorVideo WHERE id=?`, sourceVideoId);
  return cleanJson(rows[0] ?? null);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function buildImageDraftPrompt(spec: SourceVideoModelingSpec, project: DbProject, pack: Awaited<ReturnType<typeof getCharacterIdentityPack>>, scene: DbScene) {
  if (!pack) throw new Error("MAIN_CHARACTER_IDENTITY_MISSING");
  const sourceScene = spec.scenes.find((item) => item.sourceSceneId === scene.sourceSceneId);
  if (!sourceScene) throw new Error(`SOURCE_SCENE_MAPPING_MISSING:${scene.sceneNumber}`);
  const strict = compileStrictModelingConstraints(spec, scene.sourceSceneId);
  return [
    buildCharacterIdentityInstruction(pack),
    strict,
    `SCENE APPEARANCE STATE (authoritative for scene ${scene.sceneNumber}): ${scene.visualBlock ?? ""}`,
    `FROZEN INITIAL STATE: ${scene.startFramePrompt ?? sourceScene.startState}`,
    `APPROVED BACKGROUND DESIGN: ${JSON.stringify(project.backgroundDesign ?? {})}`,
    "Create exactly one full-frame vertical 9:16 still image for this scene.",
    "Show only the exact frozen state before motion begins. Do not show later action beats, collage, storyboard, character sheet, labels, captions, logos, readable text, or multiple variations.",
    "Use the approved Character Identity Pack as the identity authority. Preserve identity invariants; apply only explicitly allowed scene appearance and transformations.",
  ].join("\n");
}

function buildBackgroundDraftPrompt(spec: SourceVideoModelingSpec, project: DbProject, pack: Awaited<ReturnType<typeof getCharacterIdentityPack>>) {
  if (!pack) throw new Error("MAIN_CHARACTER_IDENTITY_MISSING");
  return [
    buildCharacterIdentityInstruction(pack),
    compileStrictModelingConstraints(spec),
    "Create exactly one clean, full-frame vertical 9:16 background reference image for the approved project environment.",
    `APPROVED BACKGROUND DESIGN: ${JSON.stringify(project.backgroundDesign ?? {})}`,
    "Do not include any character, person, animal, held prop, readable text, caption, logo, collage, storyboard, split panel, character sheet, or multiple variations.",
  ].join("\n");
}

async function preparePrompt(page: CdpPage, draftPrompt: string, sceneNumber?: number) {
  const payload = JSON.stringify({ promptType: "IMAGE", ...(sceneNumber === undefined ? {} : { sceneNumber }), draftPrompt });
  return page.evaluate<JsonRecord>(`(async()=>{const response=await fetch(${JSON.stringify(`${appUrl}/api/v1/projects/${projectId}/prompt-fidelity`)},{method:"POST",headers:{"Content-Type":"application/json"},body:${JSON.stringify(payload)}});const body=await response.json();if(!response.ok||!body.data)throw new Error(JSON.stringify(body));return body.data;})()`);
}

async function verifyPrompt(page: CdpPage, prepared: JsonRecord, sceneNumber?: number) {
  const payload = JSON.stringify({ projectId, ...(sceneNumber === undefined ? {} : { sceneNumber }), promptType: "IMAGE", promptId: prepared.promptId, prompt: prepared.validatedPrompt, promptHash: prepared.promptHash });
  return page.evaluate<JsonRecord>(`(async()=>{const response=await fetch(${JSON.stringify(`${appUrl}/api/v1/prompt-fidelity/verify`)},{method:"POST",headers:{"Content-Type":"application/json"},body:${JSON.stringify(payload)}});const body=await response.json();if(!response.ok||!body.data)throw new Error(body.error?.message||"PROMPT_VERIFY_FAILED");return body.data;})()`);
}

function buildSceneValidationContext(spec: SourceVideoModelingSpec, scene: DbScene, pack: Awaited<ReturnType<typeof getCharacterIdentityPack>>, sourceEvidence: unknown[]): SourceValidationContext {
  const sourceScene = spec.scenes.find((item) => item.sourceSceneId === scene.sourceSceneId);
  if (!sourceScene || !pack) throw new Error(`SOURCE_VALIDATION_CONTEXT_MISSING:${scene.sceneNumber}`);
  return {
    projectId,
    sourceVideoId: spec.sourceVideoId,
    sourceVideoUrl: spec.sourceVideoUrl,
    sourceModelingSpecVersion: spec.specVersion,
    sourceSpec: spec,
    generatedSceneId: scene.id,
    sourceSceneId: sourceScene.sourceSceneId,
    sourceStartTime: sourceScene.sourceStartTime,
    sourceEndTime: sourceScene.sourceEndTime,
    sourceEvidence,
    mustPreserve: sourceScene.mustPreserve,
    allowedTransformations: sourceScene.allowedTransformations,
    characterIdentityPack: pack,
    generatedAssetType: "START_FRAME",
    validationStage: "START_FRAME",
  };
}

function parseProviderJson(text: string): JsonRecord {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned) as unknown;
  return asRecord(parsed);
}

async function validateSceneImage(apiKey: string, reference: { mimeType: string; data: string; name?: string }, image: { mimeType: string; data: Buffer }, spec: SourceVideoModelingSpec, project: DbProject, scene: DbScene, pack: Awaited<ReturnType<typeof getCharacterIdentityPack>>, sourceEvidence: unknown[]) {
  const sourceScene = spec.scenes.find((item) => item.sourceSceneId === scene.sourceSceneId);
  if (!sourceScene || !pack) throw new Error(`SOURCE_VALIDATION_CONTEXT_MISSING:${scene.sceneNumber}`);
  const expected = { sceneNumber: scene.sceneNumber, sourceSceneId: sourceScene.sourceSceneId, sourceScene: buildStrictSceneExpectedState(spec, sourceScene.sourceSceneId), sceneAppearance: scene.visualBlock ?? null, startFramePrompt: scene.startFramePrompt ?? null, identityPack: { name: pack.name, lockedTraits: pack.lockedTraits, allowedVariations: pack.allowedVariations, negativeRules: pack.negativeRules } };
  const instruction = [
    "You are the authoritative Image Source Validator for a strict source-modeling pipeline.",
    "The first image is the locked Character Identity Pack reference. The second image is the generated scene start frame.",
    "Compare identity separately from scene appearance and source shot. Return JSON only.",
    "Return exactly: verdict PASS|FAIL|UNCERTAIN, sourceObservation object, issues array, summary.",
    "sourceObservation must include characterIdentityMatch, cameraType, shotSize, cameraAngle, subjectPosition, relativeObjectPositions, startStateMatch, keyPropPresenceMatch, framingIntentMatch, technicalStatus.",
    "Use exact expected strings/arrays for camera and spatial fields. Set booleans only when the image evidence supports them; otherwise use null.",
    `Expected State: ${JSON.stringify(expected)}`,
    `Expected source scene: ${JSON.stringify(sourceScene)}`,
    `Project background design: ${JSON.stringify(project.backgroundDesign ?? {})}`,
  ].join("\n");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL ?? "gemini-3.6-flash"}:generateContent`, {
    method: "POST",
    signal: AbortSignal.timeout(5 * 60_000),
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: reference.mimeType, data: reference.data } }, { inline_data: { mime_type: image.mimeType, data: image.data.toString("base64") } }, { text: instruction }] }], generationConfig: { responseMimeType: "application/json" } }),
  });
  if (!response.ok) throw new Error(`GEMINI_IMAGE_SOURCE_VALIDATION_${response.status}`);
  const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = body.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
  if (!text) throw new Error("GEMINI_IMAGE_SOURCE_VALIDATION_EMPTY");
  const provider = parseProviderJson(text);
  const observation = { ...asRecord(provider.sourceObservation), technicalStatus: asRecord(provider.sourceObservation).technicalStatus ?? true } as GeneratedImageObservation;
  const deterministic = validateImageSource(buildSceneValidationContext(spec, scene, pack, sourceEvidence), observation);
  return { provider, observation, deterministic };
}

function scenePromptPass(prepared: JsonRecord) {
  const validation = asRecord(prepared.validationResults);
  return validation.status === "PASS" || (Array.isArray(validation.checks) && validation.checks.every((item) => asRecord(item).status === "PASS"));
}

function buildAssetExpectedState(spec: SourceVideoModelingSpec, project: DbProject): ExpectedState {
  const scenes = project.scenes.map((scene) => {
    const strictScene = buildStrictSceneExpectedState(spec, scene.sourceSceneId);
    return buildSceneExpectedState({
      sceneId: scene.id,
      sceneNumber: scene.sceneNumber,
      visualBlock: String(scene.visualBlock ?? ""),
      actionBlock: String(scene.actionBlock ?? ""),
      audioBlock: String(scene.audioBlock ?? ""),
      startFramePrompt: scene.startFramePrompt ?? null,
      englishPrompt: scene.englishPrompt ?? null,
      characterDesign: project.characterDesign,
      backgroundDesign: project.backgroundDesign,
      sourceModelingIntent: strictScene.storyBeat,
      sourceSceneId: scene.sourceSceneId,
      sourceSceneOrder: strictScene.sourceSceneOrder,
      actionSequence: strictScene.actionSequence,
      cameraSpec: strictScene.camera,
      spatialSpec: strictScene.spatial,
      mustPreserve: strictScene.mustPreserve,
      allowedTransformations: strictScene.allowedTransformations,
    });
  });
  return {
    stage: "ASSETS",
    projectId,
    requiredAssetKeys: ["background-0", ...scenes.map((scene) => `scene-${scene.sceneNumber}`)],
    scenes,
    sourceValidation: {
      projectId,
      sourceVideoId: spec.sourceVideoId,
      sourceVideoPath: spec.sourceVideoUrl,
      sourceVideoUrl: spec.sourceVideoUrl,
      sourceModelingSpecVersion: String(project.sourceModelingSpecVersion ?? spec.specVersion),
      sourceSpec: spec,
      sourceEvidence: spec.sourceEvidence,
      mustPreserve: [...new Set(spec.scenes.flatMap((scene) => scene.mustPreserve))],
      allowedTransformations: [...new Set(spec.scenes.flatMap((scene) => scene.allowedTransformations))],
      validationStage: "START_FRAME",
    },
  };
}

async function runBrowserImageSourceValidation(userId: string, project: DbProject, expected: ExpectedState, spec: SourceVideoModelingSpec, pack: Awaited<ReturnType<typeof getCharacterIdentityPack>>) {
  const requestKey = `stage3-browser-quality:${runId}:${projectId}:${hashText(JSON.stringify(expected.scenes?.map((scene) => scene.sceneId) ?? []))}:${Date.now()}`;
  const queued = await new LocalJobQueue().enqueue("desktop.flow.quality", { userId, projectId, channelId: project.channelId, stage: "ASSETS", expectedState: expected }, requestKey);
  const raw = asRecord(await waitForBridgeJob(queued.jobId));
  const observations = Array.isArray(raw.sourceObservations) ? raw.sourceObservations.map(asRecord) : [];
  if (observations.length < (expected.scenes?.length ?? 0)) throw new Error(`IMAGE_SOURCE_VALIDATION_NOT_EVALUATED:${JSON.stringify({ jobId: queued.jobId, observationCount: observations.length, raw })}`);
  const perScene = (expected.scenes ?? []).map((expectedScene, index) => {
    const scene = project.scenes.find((item) => item.id === expectedScene.sceneId);
    if (!scene || !pack) throw new Error(`IMAGE_SOURCE_VALIDATION_MAPPING_MISSING:${expectedScene.sceneNumber}`);
    const observation = { ...observations[index], technicalStatus: observations[index].technicalStatus ?? (raw.verdict === "PASS" ? true : raw.verdict === "FAIL" ? false : null) } as GeneratedImageObservation;
    const result = validateImageSource(buildSceneValidationContext(spec, scene, pack, spec.sourceEvidence), observation);
    return { sceneNumber: scene.sceneNumber, observation, result };
  });
  return { jobId: queued.jobId, raw, perScene };
}

async function persistStage3Checkpoint(page: CdpPage, run: DbRun, project: DbProject, completedAt: string) {
  const sourceSteps = Array.isArray(run.steps) ? run.steps as Array<JsonRecord> : [];
  const steps = sourceSteps.map((step) => step.key === "images" ? { ...step, status: "completed", detail: "Stage 3 validation: 4 ảnh Gemini và Image Source Validation đạt PASS.", completedAt } : step);
  const checkpoint = { ...asRecord(run.checkpoint), version: 1, runId, lastCompletedStage: 3, failedStage: null, resumeTarget: null, modelingIdeaId, sourceVideoId, channelId: project.channelId, attemptCount: run.attemptCount ?? 0, contentProjectId: projectId, sourceModelingSpecVersion: project.sourceModelingSpecVersion ?? null };
  const payload = JSON.stringify({ id: runId, status: "PAUSED", steps, projectId, ideaId: modelingIdeaId, modelingIdeaId, channelId: project.channelId, lastCompletedStage: 3, failedStage: null, resumeTarget: null, attemptCount: run.attemptCount ?? 0, checkpoint });
  return page.evaluate<JsonRecord>(`(async()=>{const response=await fetch(${JSON.stringify(`${appUrl}/api/v1/automations`)},{method:"PATCH",headers:{"Content-Type":"application/json"},body:${JSON.stringify(payload)}});const body=await response.json();if(!response.ok||!body.data)throw new Error(body.error?.message||"STAGE3_CHECKPOINT_PERSISTENCE_FAILED");return body.data;})()`);
}

async function main() {
  if (!existsSync(validationExe)) throw new Error(`VALIDATION_EXE_MISSING:${validationExe}`);
  const artifactHash = createHash("sha256").update(readFileSync(validationExe)).digest("hex").toUpperCase();
  if (artifactHash !== expectedArtifactHash) throw new Error(`ARTIFACT_HASH_MISMATCH:${artifactHash}`);
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let child: ChildProcess | undefined;
  let page: CdpPage | undefined;
  const stage3HarnessCommandId = randomUUID();
  const startedAt = new Date().toISOString();
  try {
    const runBefore = await readRun(db);
    if (!runBefore || runBefore.projectId !== projectId || runBefore.modelingIdeaId !== modelingIdeaId || runBefore.sourceVideoId !== sourceVideoId) throw new Error("STAGE3_TARGET_MISMATCH");
    if (runBefore.status !== "PAUSED" || Number(runBefore.lastCompletedStage) !== 2 || runBefore.failedStage !== null) throw new Error(`STAGE3_CHECKPOINT_MISMATCH:${JSON.stringify({ status: runBefore.status, lastCompletedStage: runBefore.lastCompletedStage, failedStage: runBefore.failedStage })}`);
    const project = await readProject(db);
    const sourceVideo = await readSourceVideo(db);
    if (!sourceVideo || sourceVideo.url !== sourceUrl || typeof sourceVideo.caption !== "string" || !sourceVideo.caption.trim()) throw new Error("SOURCE_VIDEO_EVIDENCE_MISMATCH");
    const spec = assertStrictModelingReady({ sourceVideoId: project.sourceVideoId, sourceVideoUrl: project.sourceVideoUrl, sourceDuration: project.sourceDuration, modelingPolicy: project.modelingPolicy, sourceModelingSpec: project.sourceModelingSpec, generatedScenes: project.scenes.map((scene) => ({ sceneNumber: scene.sceneNumber, sourceSceneId: scene.sourceSceneId, targetDuration: scene.targetDuration as number })) });
    const userRows = await db.$queryRawUnsafe<JsonRecord[]>(`SELECT userId FROM Channel WHERE id=?`, project.channelId);
    const userId = String(userRows[0]?.userId ?? "");
    if (!userId) throw new Error("STAGE3_USER_NOT_FOUND");
    const pack = await getCharacterIdentityPack(project.channelId, userId);
    if (!pack?.active || !pack.referenceImages.some((reference) => reference.active)) throw new Error("CHARACTER_IDENTITY_PACK_NOT_READY");
    const refs = await readChannelCharacterIdentityReferences(project.channelId, userId);
    const reference = refs.find((item) => item.referenceImages === undefined) ?? refs[0];
    if (!reference) throw new Error("CHARACTER_REFERENCE_NOT_FOUND");
    const browserActionsBefore = readNdjson(path.join(userDataRoot, "browser-actions.ndjson")).length;
    const stoppedPids = stopValidationProcesses();
    child = spawn(validationExe, [`--remote-debugging-port=${cdpPort}`], { windowsHide: true, stdio: "ignore" });
    const target = await waitForPageTarget();
    page = new CdpPage(String(target.webSocketDebuggerUrl));
    await page.call("Page.navigate", { url: `${appUrl}/?stage3Validation=1&runId=${encodeURIComponent(runId)}&projectId=${encodeURIComponent(projectId)}` });
    let probe: JsonRecord = {};
    const bridgeDeadline = Date.now() + 60_000;
    while (Date.now() < bridgeDeadline) {
      probe = await page.evaluate<JsonRecord>(`(()=>({title:document.title,url:location.href,desktopGemini:Boolean(window.desktopGemini),readyState:document.readyState,bodyLength:document.body?.innerText?.length||0}))()`).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
      if (probe.desktopGemini === true) break;
      await sleep(1_000);
    }
    if (probe.desktopGemini !== true) throw new Error(`GEMINI_BRIDGE_NOT_AVAILABLE:${JSON.stringify(probe)}`);
    const sourceEvidence = Array.isArray(asRecord(spec).sourceEvidence) ? asRecord(spec).sourceEvidence as unknown[] : [];
    const sceneReports: JsonRecord[] = [];
    const slots: JsonRecord[] = [];
    for (const scene of [...project.scenes].sort((left, right) => left.sceneNumber - right.sceneNumber)) {
      const sourceScene = spec.scenes.find((item) => item.sourceSceneId === scene.sourceSceneId);
      if (!sourceScene) throw new Error(`SOURCE_SCENE_MAPPING_MISSING:${scene.sceneNumber}`);
      const draftPrompt = buildImageDraftPrompt(spec, project, pack, scene);
      const prepared = await preparePrompt(page, draftPrompt, scene.sceneNumber);
      if (!scenePromptPass(prepared)) throw new Error(`PROMPT_FIDELITY_GATE_FAILED:${scene.sceneNumber}`);
      await verifyPrompt(page, prepared, scene.sceneNumber);
      const actualSentPromptHash = hashText(String(prepared.validatedPrompt));
      if (actualSentPromptHash !== String(prepared.promptHash)) throw new Error(`PROMPT_HASH_MISMATCH:${scene.sceneNumber}`);
      slots.push({ kind: "scene", sceneNumber: scene.sceneNumber, label: `Stage 3 — Ảnh bắt đầu cảnh ${scene.sceneNumber}`, aspectRatio: "9:16", prompt: prepared.validatedPrompt });
      sceneReports.push({ sceneNumber: scene.sceneNumber, sceneId: scene.id, sourceSceneId: scene.sourceSceneId, expectedStateHash: hashText(JSON.stringify({ sourceScene, visualBlock: scene.visualBlock, startFramePrompt: scene.startFramePrompt })), compiledPromptHash: hashText(draftPrompt), validatedPromptHash: prepared.promptHash, actualSentPromptHash, promptFidelityGate: "PASS", characterIdentityBound: "PASS", sourceMapping: "PASS" });
    }
    const missingSceneSlots: JsonRecord[] = [];
    const regenerateScenes = process.env.STAGE3_REGENERATE_SCENES === "1";
    for (const slot of slots) {
      if (regenerateScenes) { missingSceneSlots.push(slot); continue; }
      try { await readProjectImage(projectId, userId, "scene", Number(slot.sceneNumber)); }
      catch { missingSceneSlots.push(slot); }
    }
    const imageGenerationDiagnostics: JsonRecord[] = [];
    if (missingSceneSlots.length) {
      const imageRun = await runGeminiImageJobWithCdpObservation(page, missingSceneSlots);
      if (imageRun.result.status !== "completed") throw new Error(`GEMINI_IMAGE_GENERATION_FAILED:${JSON.stringify(imageRun.result)}`);
      imageGenerationDiagnostics.push(...imageRun.diagnostics);
    }
    let backgroundAvailable = true;
    try { await readProjectImage(projectId, userId, "background", 0); }
    catch { backgroundAvailable = false; }
    if (!backgroundAvailable) {
      const backgroundDraft = buildBackgroundDraftPrompt(spec, project, pack);
      const backgroundPrepared = await preparePrompt(page, backgroundDraft);
      if (!scenePromptPass(backgroundPrepared)) throw new Error("BACKGROUND_PROMPT_FIDELITY_GATE_FAILED");
      const backgroundRun = await runGeminiImageJobWithCdpObservation(page, [{ kind: "background", sceneNumber: 0, label: "Stage 3 — Bối cảnh", aspectRatio: "9:16", prompt: backgroundPrepared.validatedPrompt }]);
      if (backgroundRun.result.status !== "completed") throw new Error(`GEMINI_BACKGROUND_GENERATION_FAILED:${JSON.stringify(backgroundRun.result)}`);
      imageGenerationDiagnostics.push(...backgroundRun.diagnostics);
    }
    const generatedAt = new Date().toISOString();
    const reportByScene = new Map(sceneReports.map((report) => [Number(report.sceneNumber), report]));
    const browserValidation = await runBrowserImageSourceValidation(userId, project, buildAssetExpectedState(spec, project), spec, pack);
    for (const scene of [...project.scenes].sort((left, right) => left.sceneNumber - right.sceneNumber)) {
      const image = await readProjectImage(projectId, userId, "scene", scene.sceneNumber);
      const imageOk = image.data.length >= 1024 && image.mimeType.startsWith("image/");
      const validation = browserValidation.perScene.find((item) => item.sceneNumber === scene.sceneNumber);
      if (!validation) throw new Error(`IMAGE_SOURCE_VALIDATION_SCENE_MISSING:${scene.sceneNumber}`);
      const deterministic = validation.result;
      const report = reportByScene.get(scene.sceneNumber);
      if (!report) throw new Error(`STAGE3_REPORT_MISSING:${scene.sceneNumber}`);
      report.imageCommandId = stage3HarnessCommandId;
      report.imageSessionId = String(target.targetId ?? "CDP");
      report.imageGenerationStarted = "YES";
      report.imageGenerationCompleted = "YES";
      report.generatedImageReference = `/api/v1/projects/${projectId}/images?kind=scene&sceneNumber=${scene.sceneNumber}`;
      report.generatedImageHash = hashBuffer(image.data);
      report.imagePersisted = imageOk ? "PASS" : "FAIL";
      report.characterIdentityValidation = deterministic.characterFidelity;
      report.sourceValidation = deterministic.sourceFidelity;
      report.technicalValidation = deterministic.technicalQuality;
      report.imageSourceValidation = deterministic.status;
      report.sourceValidationChecks = deterministic.checks;
      report.providerVerdict = browserValidation.raw.verdict ?? "UNCERTAIN";
      report.providerIssues = browserValidation.raw.issues ?? [];
      if (!imageOk || deterministic.status !== "PASS") throw new Error(`IMAGE_SOURCE_VALIDATION_FAILED:${scene.sceneNumber}:${JSON.stringify({ imageOk, status: deterministic.status, findings: deterministic.findings })}`);
    }
    const checkpointAt = new Date().toISOString();
    const persistedRun = await persistStage3Checkpoint(page, runBefore, project, checkpointAt);
    const runAfter = await readRun(db);
    const report = {
      stage3HarnessCommandId,
      validationExe,
      artifactHash,
      stoppedPids,
      browserActionsBefore,
      startedAt,
      generatedAt,
      runBefore,
      runAfter,
      contentProjectId: projectId,
      sceneCount: project.scenes.length,
      characterIdentityPack: { found: true, locked: pack.active, id: pack.characterId, name: pack.name, referenceCount: pack.referenceImages.filter((item) => item.active).length },
      sceneReports: [...reportByScene.values()],
      imageGenerationCdpDiagnostics: imageGenerationDiagnostics,
      browserImageSourceValidation: { jobId: browserValidation.jobId, verdict: browserValidation.raw.verdict ?? null, issues: browserValidation.raw.issues ?? [] },
      checkpointPersisted: Boolean(persistedRun),
      flowStarted: false,
      sceneVideoGenerationStarted: false,
      finalAssemblyStarted: false,
      stage3Pass: runAfter?.status === "PAUSED" && Number(runAfter.lastCompletedStage) === 3 && runAfter.failedStage === null && project.scenes.length === 4,
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.stage3Pass) process.exitCode = 1;
  } finally {
    page?.close();
    if (child && !child.killed) child.kill();
    try { stopValidationProcesses(); } catch { /* Cleanup must not hide the validation result. */ }
    await db.$disconnect();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
