import { describe, expect, it } from "vitest";
import { buildSourceVideoModelingSpec, validateGeneratedSceneMapping } from "@/modules/modeling/strict-source-modeling";
import { PostAssemblyQaOrchestrator } from "@/modules/post-assembly-qa/orchestrator";
import { sourceFidelityValidator } from "@/modules/post-assembly-qa/validators";
import type { QaContext } from "@/modules/post-assembly-qa/types";
import { adaptImageSourceObservationVerdicts, buildAuthoritativeStoryboardValidationPlans, finalSourceApproval, imageGenerationGate, traceFirstDivergence, validateFinalVideoSource, validateImageSource, validateSceneVideoSource, validateStoryboardSource, type GeneratedImageObservation, type GeneratedSceneVideoObservation, type SourceValidationContext } from "./multi-stage";

const spec = () => buildSourceVideoModelingSpec({
  specVersion: "step3-fixture-1",
  sourceVideoId: "source-step3",
  sourceVideoUrl: "https://example.test/source-step3.mp4",
  sourceVideoMetadata: { fixture: true },
  sourceDuration: 8,
  sourcePlatform: "fixture",
  scenes: [
    { sourceSceneId: "source-1", order: 1, sourceStartTime: 0, sourceEndTime: 4, duration: 4, storyBeat: "Nhân vật nhìn hộp", cameraType: "static", shotSize: "medium", cameraAngle: "eye-level", cameraMovement: "none", framing: "center subject", subjectPosition: "left", relativeObjectPositions: ["box right"], characterAction: "look", actionSequence: ["look at box", "turn to keyboard"], propAction: "box remains visible", startState: "standing", endState: "facing keyboard", transitionIn: "cut", transitionOut: "cut", timingNotes: "beat at 2s", rhythmNotes: "quick setup", mustPreserve: ["look before turn"], allowedTransformations: ["channel character", "background", "2D rendering"], punchlineRole: null, gagRole: "setup", dialogueRole: null, textRole: null },
    { sourceSceneId: "source-2", order: 2, sourceStartTime: 4, sourceEndTime: 8, duration: 4, storyBeat: "Nhân vật gõ bàn phím", cameraType: "static", shotSize: "medium", cameraAngle: "eye-level", cameraMovement: "none", framing: "subject and keyboard", subjectPosition: "left", relativeObjectPositions: ["keyboard center"], characterAction: "type", actionSequence: ["place hands on keyboard", "type"], propAction: "keyboard interaction", startState: "facing keyboard", endState: "typing", transitionIn: "cut", transitionOut: "hold", timingNotes: "beat at 6s", rhythmNotes: "short payoff", mustPreserve: ["hands before typing"], allowedTransformations: ["channel character", "background", "3D rendering"], punchlineRole: "payoff", gagRole: "payoff", dialogueRole: null, textRole: null },
  ],
});

const context = (stage: SourceValidationContext["validationStage"] = "STORYBOARD"): SourceValidationContext => {
  const sourceSpec = spec();
  return { projectId: "project-step3", sourceVideoId: sourceSpec.sourceVideoId, sourceVideoUrl: sourceSpec.sourceVideoUrl, sourceModelingSpecVersion: sourceSpec.specVersion, sourceSpec, sourceEvidence: [{ ref: "fixture-frame-1" }], mustPreserve: sourceSpec.scenes.flatMap((scene) => scene.mustPreserve), allowedTransformations: sourceSpec.scenes.flatMap((scene) => scene.allowedTransformations), validationStage: stage };
};

const camera = { cameraType: "static", shotSize: "medium", cameraAngle: "eye-level", cameraMovement: "none", framing: "center subject" };
const validImage = (overrides: Partial<GeneratedImageObservation> = {}): GeneratedImageObservation => ({ characterIdentityMatch: true, ...camera, subjectPosition: "left", relativeObjectPositions: ["box right"], startStateMatch: true, keyPropPresenceMatch: true, framingIntentMatch: true, technicalStatus: true, ...overrides });
const validVideo = (overrides: Partial<GeneratedSceneVideoObservation> = {}): GeneratedSceneVideoObservation => ({ characterIdentityMatch: true, actionMatch: true, actionSequence: ["look at box", "turn to keyboard"], actionOrderMatch: true, cameraMatch: true, propInteractionMatch: true, spatialMatch: true, timingMatch: true, startStateMatch: true, endStateMatch: true, beatMatch: true, temporalContinuity: true, technicalStatus: true, ...overrides });
const validFinal = (overrides: Parameters<typeof validateFinalVideoSource>[1] = {}) => ({ sceneOrder: [1, 2], generatedDuration: 8, structureMatch: true, beatMatch: true, timingMatch: true, rhythmMatch: true, transitionMatch: true, punchlineMatch: true, cameraPatternMatch: true, actionPatternMatch: true, technicalStatus: true, ...overrides });
const storyboard = (overrides: Record<string, unknown>[] = []) => [
  { sceneNumber: 1, generatedSceneId: "generated-1", sourceSceneId: "source-1", storyBeat: "Nhân vật nhìn hộp", actionSequence: ["look at box", "turn to keyboard"], camera, subjectPosition: "left", relativeObjectPositions: ["box right"], targetDuration: 4, startState: "standing", endState: "facing keyboard" },
  { sceneNumber: 2, generatedSceneId: "generated-2", sourceSceneId: "source-2", storyBeat: "Nhân vật gõ bàn phím", actionSequence: ["place hands on keyboard", "type"], camera: { ...camera, framing: "subject and keyboard" }, subjectPosition: "left", relativeObjectPositions: ["keyboard center"], targetDuration: 4, startState: "facing keyboard", endState: "typing" },
].map((scene, index) => ({ ...scene, ...(overrides[index] ?? {}) }));

describe("STEP 3 multi-stage source validation", () => {
  it("application-owned source mapping supplies strict storyboard validation evidence", () => {
    const sourceSpec = spec();
    const mappings = validateGeneratedSceneMapping(sourceSpec, sourceSpec.scenes.map((scene) => ({ sceneNumber: scene.order, targetDuration: scene.duration })));
    const plans = buildAuthoritativeStoryboardValidationPlans(sourceSpec, mappings);
    expect(validateStoryboardSource(context(), plans).status).toBe("PASS");
    expect(plans.map((scene) => scene.sourceSceneId)).toEqual(["source-1", "source-2"]);
    expect(plans.map((scene) => scene.targetDuration)).toEqual([4, 4]);
  });
  it("CASE 1 storyboard order and structure pass", () => expect(validateStoryboardSource(context(), storyboard()).status).toBe("PASS"));
  it("CASE 2 storyboard missing a source scene fails", () => expect(validateStoryboardSource(context(), storyboard().slice(0, 1)).status).toBe("FAIL"));
  it("CASE 3 reversed action sequence fails", () => expect(validateStoryboardSource(context(), storyboard([{ actionSequence: ["turn to keyboard", "look at box"] }])).findings.some((item) => item.validatorId === "SOURCE_ACTION_SEQUENCE_MATCH")).toBe(true));
  it("CASE 4 image with wrong camera fails SOURCE_SHOT_MATCH domain", () => expect(validateImageSource({ ...context("START_FRAME"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validImage({ shotSize: "close-up" })).sourceFidelity).toBe("FAIL"));
  it("CASE 5 image with wrong identity fails independently", () => expect(validateImageSource({ ...context("START_FRAME"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validImage({ characterIdentityMatch: false })).characterFidelity).toBe("FAIL"));
  it("CASE 6 allowed style/background transformation does not fail source checks", () => expect(validateImageSource({ ...context("START_FRAME"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validImage()).sourceFidelity).toBe("PASS"));
  it("CASE 7 semantic subject position mismatch fails spatial check", () => expect(validateImageSource({ ...context("START_FRAME"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validImage({ subjectPosition: "right" })).findings.some((item) => item.validatorId === "SUBJECT_POSITION_MATCH")).toBe(true));
  it("CASE 8 scene video with ordered actions passes", () => expect(validateSceneVideoSource({ ...context("SCENE_VIDEO"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validVideo()).status).toBe("PASS"));
  it("CASE 9 scene video missing an action beat fails", () => expect(validateSceneVideoSource({ ...context("SCENE_VIDEO"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validVideo({ actionSequence: ["look at box"], actionMatch: false })).sourceFidelity).toBe("FAIL"));
  it("CASE 10 scene video camera intent failure is blocking", () => expect(validateSceneVideoSource({ ...context("SCENE_VIDEO"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validVideo({ cameraMatch: false })).findings.some((item) => item.validatorId === "SOURCE_CAMERA_MATCH")).toBe(true));
  it("CASE 11 scene video wrong end state is blocking", () => expect(validateSceneVideoSource({ ...context("SCENE_VIDEO"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validVideo({ endStateMatch: false })).findings.some((item) => item.validatorId === "SOURCE_END_STATE_MATCH")).toBe(true));
  it("CASE 12 scene timing outside tolerance fails", () => expect(validateSceneVideoSource({ ...context("SCENE_VIDEO"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validVideo({ timingMatch: false })).findings.some((item) => item.validatorId === "SOURCE_TIMING_MATCH")).toBe(true));
  it("CASE 13 final scene order mismatch fails", () => expect(validateFinalVideoSource(context("FINAL_VIDEO"), validFinal({ sceneOrder: [2, 1] })).sourceFidelity).toBe("FAIL"));
  it("CASE 14 missing final punchline is a critical finding", () => expect(validateFinalVideoSource(context("FINAL_VIDEO"), validFinal({ punchlineMatch: false })).findings.some((item) => item.validatorId === "SOURCE_PUNCHLINE_MATCH" && item.severity === "CRITICAL")).toBe(true));
  it("CASE 15 critical failure cannot be approved even with a high reported score", () => { const failed = validateFinalVideoSource(context("FINAL_VIDEO"), validFinal({ punchlineMatch: false })); expect(finalSourceApproval({ ...failed, overallModelingFidelityScore: 0.96, criticalFailCount: 1 })).toBe("FAIL"); });
  it("CASE 16 style change is not treated as source structure failure", () => expect(validateImageSource({ ...context("START_FRAME"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validImage()).status).toBe("PASS"));
  it("CASE 17 traces a storyboard first divergence", () => expect(traceFirstDivergence([validateStoryboardSource(context(), storyboard([{ endState: "wrong" }])), validateFinalVideoSource(context("FINAL_VIDEO"), validFinal())])).toMatchObject({ stage: "STORYBOARD", firstDivergence: "SOURCE_STORYBOARD" }));
  it("CASE 18 traces an image first divergence", () => expect(traceFirstDivergence([validateStoryboardSource(context(), storyboard()), validateImageSource({ ...context("START_FRAME"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validImage({ shotSize: "close-up" }))])).toMatchObject({ stage: "START_FRAME", firstDivergence: "START_FRAME_OUTPUT" }));
  it("CASE 19 traces a scene-video first divergence", () => expect(traceFirstDivergence([validateStoryboardSource(context(), storyboard()), validateSceneVideoSource({ ...context("SCENE_VIDEO"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validVideo({ cameraMatch: false }))])).toMatchObject({ stage: "SCENE_VIDEO", firstDivergence: "SCENE_VIDEO_OUTPUT" }));
  it("CASE 20 traces a final assembly/output divergence", () => expect(traceFirstDivergence([validateFinalVideoSource(context("FINAL_VIDEO"), validFinal({ structureMatch: false }))])).toMatchObject({ stage: "FINAL_VIDEO", firstDivergence: "FINAL_ASSEMBLY_OUTPUT" }));
  it("CASE 21 required image evidence that is not evaluated blocks the image gate", () => { const validation = validateImageSource({ ...context("START_FRAME"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validImage({ cameraAngle: null })); expect(validation.status).toBe("NOT_EVALUATED"); expect(imageGenerationGate(validation)).toBe("NEEDS_REVIEW"); });
  it("CASE 22 every failed check carries source/generated/timestamp evidence", () => { const failure = validateImageSource({ ...context("START_FRAME"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validImage({ subjectPosition: "right" })).findings.find((item) => item.validatorId === "SUBJECT_POSITION_MATCH"); expect(failure).toMatchObject({ sourceSceneId: "source-1", generatedSceneId: "generated-1", sourceTimestamp: 0, expected: "left", actual: "right", firstDivergenceCandidate: "START_FRAME_OUTPUT" }); });
  it("CASE 23 final source validation does not change generation success", async () => { const qaContext: QaContext = { projectId: "project-step3", finalVideoPath: "final.mp4", finalVideoVersion: "v1", approvedManifest: null, expectedSceneStates: {}, approvedSources: [], checkpoint: { generationStatus: "SUCCESS", outputReady: true }, sourceValidation: { ...context("FINAL_VIDEO"), finalObservation: validFinal({ structureMatch: false }) } }; const run = await new PostAssemblyQaOrchestrator([sourceFidelityValidator]).run(qaContext); expect(run.qualityStatusAfter).toBe("NEEDS_REVIEW"); expect(qaContext.checkpoint).toMatchObject({ generationStatus: "SUCCESS", outputReady: true }); });
  it("CASE 24 final source review keeps output available", async () => { const qaContext: QaContext = { projectId: "project-step3", finalVideoPath: "final.mp4", finalVideoVersion: "v2", approvedManifest: null, expectedSceneStates: {}, approvedSources: [], checkpoint: { generationStatus: "SUCCESS", outputReady: true }, sourceValidation: { ...context("FINAL_VIDEO"), finalObservation: validFinal({ beatMatch: false }) } }; const run = await new PostAssemblyQaOrchestrator([sourceFidelityValidator]).run(qaContext); expect(run.qualityStatusAfter).toBe("NEEDS_REVIEW"); expect(qaContext.checkpoint.outputReady).toBe(true); });
  it("CASE 25 keeps Character, Source and Technical domains separate", () => { const validation = validateImageSource({ ...context("START_FRAME"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validImage()); expect(validation).toHaveProperty("characterFidelity", "PASS"); expect(validation).toHaveProperty("sourceFidelity", "PASS"); expect(validation).toHaveProperty("technicalQuality", "PASS"); });
  it("CASE 27 adapts PASS/FAIL only for the selected boolean image verdict fields", () => {
    const raw = { startStateMatch: "PASS", keyPropPresenceMatch: "FAIL", framingIntentMatch: "PASS", sourceShotMatch: "FAIL" };
    const adapted = adaptImageSourceObservationVerdicts(raw);
    expect(adapted.observation).toMatchObject({ startStateMatch: true, keyPropPresenceMatch: false, framingIntentMatch: true, sourceShotMatch: "FAIL" });
    expect(raw).toEqual({ startStateMatch: "PASS", keyPropPresenceMatch: "FAIL", framingIntentMatch: "PASS", sourceShotMatch: "FAIL" });
    expect(adapted.diagnostic).toMatchObject({ verdictCanonicalizationApplied: true, canonicalizedVerdictFields: ["sourceObservation.startStateMatch", "sourceObservation.keyPropPresenceMatch", "sourceObservation.framingIntentMatch"] });
  });
  it("CASE 28 preserves booleans and the SOURCE_SHOT_MATCH string contract", () => {
    const raw = { startStateMatch: true, keyPropPresenceMatch: false, framingIntentMatch: true, sourceShotMatch: "FAIL" };
    const adapted = adaptImageSourceObservationVerdicts(raw);
    expect(adapted.observation).toEqual(raw);
    expect(adapted.diagnostic.verdictCanonicalizationApplied).toBe(false);
  });
  it("CASE 29 leaves unsupported verdict tokens unchanged so strict validation rejects them", () => {
    const adapted = adaptImageSourceObservationVerdicts({ startStateMatch: "YES" });
    expect(adapted.observation.startStateMatch).toBe("YES");
    const validation = validateImageSource({ ...context("START_FRAME"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validImage({ startStateMatch: "YES" as never }));
    expect(validation.findings.some((item) => item.validatorId === "START_STATE_MATCH")).toBe(true);
  });
  it("CASE 30 records raw and canonical values separately", () => {
    const raw = { startStateMatch: "PASS", keyPropPresenceMatch: "PASS", framingIntentMatch: "PASS" };
    const adapted = adaptImageSourceObservationVerdicts(raw);
    expect(raw.startStateMatch).toBe("PASS");
    expect(adapted.observation.startStateMatch).toBe(true);
    expect(adapted.diagnostic.changes[0]).toMatchObject({ path: "sourceObservation.startStateMatch", originalValue: "PASS", originalType: "string", canonicalValue: true, canonicalType: "boolean" });
  });
  it("CASE 31 keeps SOURCE_SHOT_MATCH failure behavior outside the boolean adapter", () => {
    const raw = { startStateMatch: "PASS", keyPropPresenceMatch: "PASS", framingIntentMatch: "PASS", sourceShotMatch: "FAIL" };
    const adapted = adaptImageSourceObservationVerdicts(raw);
    const validation = validateImageSource({ ...context("START_FRAME"), sourceSceneId: "source-1", generatedSceneId: "generated-1" }, validImage({ ...adapted.observation, shotSize: "close-up" }));
    expect((adapted.observation as Record<string, unknown>).sourceShotMatch).toBe("FAIL");
    expect(validation.findings.find((item) => item.validatorId === "SOURCE_SHOT_MATCH")?.status).toBe("FAIL");
  });
  it("CASE 26 sends a source-fidelity failure through the existing incident/report path", async () => { let reportCount = 0; const qaContext: QaContext = { projectId: "project-step3", finalVideoPath: "final.mp4", finalVideoVersion: "v3", approvedManifest: null, expectedSceneStates: {}, approvedSources: [], checkpoint: { generationStatus: "SUCCESS", outputReady: true }, sourceValidation: { ...context("FINAL_VIDEO"), finalObservation: validFinal({ structureMatch: false }) } }; const run = await new PostAssemblyQaOrchestrator([sourceFidelityValidator], undefined, async () => "source-failure-hash", async () => { reportCount += 1; }).run(qaContext); expect(run.incidentsCreated.length).toBeGreaterThan(0); expect(reportCount).toBeGreaterThan(0); });
});
