import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { characterIdentityPackSchema, identityGenerationGate, validateCharacterIdentity } from "@/modules/assets/character-identity";
import { buildSourceVideoModelingSpec, validateGeneratedSceneMapping, validateStrictModelingSetup } from "@/modules/modeling/strict-source-modeling";
import { compileStrictPrompt, promptFidelityGate, validatePromptFidelity, type PromptExpectedState } from "@/modules/prompt-fidelity/validator";
import { sourceFidelityValidator } from "@/modules/post-assembly-qa/validators";
import { PostAssemblyQaOrchestrator } from "@/modules/post-assembly-qa/orchestrator";
import type { QaContext } from "@/modules/post-assembly-qa/types";
import { finalSourceApproval, traceFirstDivergence, validateFinalVideoSource, validateImageSource, validateSceneVideoSource, validateStoryboardSource, type SourceValidationContext } from "@/modules/source-validation/multi-stage";

const sourceSpec = buildSourceVideoModelingSpec({ specVersion: "audit-source-v1", sourceVideoId: "source-audit-1", sourceVideoUrl: "https://example.test/audit-source.mp4", sourceVideoMetadata: { audit: true }, sourceDuration: 4, sourcePlatform: "fixture", scenes: [{ sourceSceneId: "source-scene-audit-1", order: 1, sourceStartTime: 0, sourceEndTime: 4, duration: 4, storyBeat: "Nhân vật nhìn hộp rồi gõ bàn phím", cameraType: "static", shotSize: "medium", cameraAngle: "eye-level", cameraMovement: "none", framing: "subject left, keyboard right", subjectPosition: "left", relativeObjectPositions: ["keyboard right"], characterAction: "look and type", actionSequence: ["look at box", "turn toward keyboard", "type"], propAction: "keyboard interaction", startState: "seated looking at box", endState: "typing", transitionIn: "cut", transitionOut: "hold", timingNotes: "type at 3s", rhythmNotes: "quick payoff", mustPreserve: ["look before typing", "keyboard remains right"], allowedTransformations: ["background", "2D style", "outfit"], punchlineRole: "payoff", gagRole: "payoff", dialogueRole: null, textRole: null }] });
const pack = characterIdentityPackSchema.parse({ characterId: "character-audit-1", channelId: "channel-audit-1", name: "Audit Main Character", styleType: "3D", active: true, referenceImages: [{ assetId: "asset-character-audit-1", storageKey: "character.png", viewRole: "front", active: true }], lockedTraits: { faceIdentity: "round face", facialStructure: "small nose", skinTone: "warm", baseHairstyle: "short black hair", bodyProportions: "compact", bodyBuild: "slim", ageAppearance: "adult", distinctiveTraits: "cheek mark", coreCharacterDesignLanguage: "stylized", styleType: "3D" }, allowedVariations: ["outfit", "background", "2D style"], negativeRules: ["Never replace the main character."] });
const sourceContext = (stage: SourceValidationContext["validationStage"] = "STORYBOARD"): SourceValidationContext => ({ projectId: "project-audit-1", sourceVideoId: sourceSpec.sourceVideoId, sourceVideoUrl: sourceSpec.sourceVideoUrl, sourceModelingSpecVersion: sourceSpec.specVersion, sourceSpec, sourceEvidence: [{ reference: "source-frame-audit-1" }], mustPreserve: sourceSpec.scenes[0].mustPreserve, allowedTransformations: sourceSpec.scenes[0].allowedTransformations, characterIdentityPack: pack, validationStage: stage });
const expectedPrompt = (): PromptExpectedState => ({ projectId: "project-audit-1", sceneId: "generated-scene-audit-1", sourceSceneId: sourceSpec.scenes[0].sourceSceneId, sourceSpecVersion: sourceSpec.specVersion, expectedStateVersion: "audit-expected-v1", characterIdentityPackVersion: pack.characterId, timingTolerance: sourceSpec.timingTolerance, sourceScene: sourceSpec.scenes[0], identityPack: { name: pack.name, lockedTraits: pack.lockedTraits, allowedVariations: pack.allowedVariations, negativeRules: pack.negativeRules }, sceneAppearance: "blue shirt, seated", textPolicy: { mode: "NO_READABLE_TEXT" }, allowedTransformations: sourceSpec.scenes[0].allowedTransformations, promptType: "VIDEO" });
const storyboard = [{ sceneNumber: 1, generatedSceneId: "generated-scene-audit-1", sourceSceneId: sourceSpec.scenes[0].sourceSceneId, storyBeat: sourceSpec.scenes[0].storyBeat, actionSequence: sourceSpec.scenes[0].actionSequence, camera: { cameraType: "static", shotSize: "medium", cameraAngle: "eye-level", cameraMovement: "none", framing: sourceSpec.scenes[0].framing, subjectPosition: "left" }, subjectPosition: "left", relativeObjectPositions: ["keyboard right"], targetDuration: 4, startState: sourceSpec.scenes[0].startState, endState: sourceSpec.scenes[0].endState }];
const imageObservation = { characterIdentityMatch: true as const, cameraType: "static", shotSize: "medium", cameraAngle: "eye-level", cameraMovement: "none", subjectPosition: "left", relativeObjectPositions: ["keyboard right"], startStateMatch: true as const, keyPropPresenceMatch: true as const, framingIntentMatch: true as const, technicalStatus: true as const };
const videoObservation = { characterIdentityMatch: true as const, actionMatch: true as const, actionSequence: sourceSpec.scenes[0].actionSequence, actionOrderMatch: true as const, cameraMatch: true as const, propInteractionMatch: true as const, spatialMatch: true as const, timingMatch: true as const, startStateMatch: true as const, endStateMatch: true as const, beatMatch: true as const, temporalContinuity: true as const, technicalStatus: true as const };
const finalObservation = { sceneOrder: [1], generatedDuration: 4, structureMatch: true as const, beatMatch: true as const, timingMatch: true as const, rhythmMatch: true as const, transitionMatch: true as const, punchlineMatch: true as const, cameraPatternMatch: true as const, actionPatternMatch: true as const, technicalStatus: true as const };

describe("STEP 5 final strict modeling integration audit", () => {
  it("AUDIT 1 links source video, spec, mapping, identity, prompt, image, video and final output", async () => {
    const mapping = validateGeneratedSceneMapping(sourceSpec, [{ sceneNumber: 1 }]);
    const identity = validateCharacterIdentity({ lockedTraits: pack.lockedTraits, actualIdentity: pack.lockedTraits, actualStyleType: pack.styleType });
    expect(identityGenerationGate(identity)).toBe("ALLOW");
    const prompt = compileStrictPrompt(expectedPrompt(), "Use the approved source-faithful scene wording.");
    const promptResult = validatePromptFidelity(prompt, expectedPrompt());
    expect(promptFidelityGate(promptResult).generationAllowed).toBe(true);
    const promptHash = createHash("sha256").update(prompt).digest("hex");
    const trace = { sourceVideoId: sourceSpec.sourceVideoId, sourceSceneId: mapping[0].sourceSceneId, sourceSpecVersion: sourceSpec.specVersion, expectedStateVersion: expectedPrompt().expectedStateVersion, characterIdentityPackId: pack.characterId, geminiDraftPrompt: "Use the approved source-faithful scene wording.", validatedPrompt: prompt, validatedPromptHash: promptHash, actualSentPromptHash: createHash("sha256").update(prompt).digest("hex"), imageValidation: validateImageSource({ ...sourceContext("START_FRAME"), sourceSceneId: mapping[0].sourceSceneId, generatedSceneId: "generated-scene-audit-1" }, imageObservation), videoValidation: validateSceneVideoSource({ ...sourceContext("SCENE_VIDEO"), sourceSceneId: mapping[0].sourceSceneId, generatedSceneId: "generated-scene-audit-1" }, videoObservation), finalValidation: validateFinalVideoSource(sourceContext("FINAL_VIDEO"), finalObservation) };
    expect(trace.actualSentPromptHash).toBe(trace.validatedPromptHash);
    expect(trace.imageValidation.status).toBe("PASS");
    expect(trace.videoValidation.status).toBe("PASS");
    expect(trace.finalValidation.status).toBe("PASS");
  });

  it("AUDIT 2 preserves one identity through prompt and image/video chain while allowing outfit/style/background changes", () => {
    const prompt = compileStrictPrompt(expectedPrompt(), "Apply only the allowed outfit, background and 2D style transformation.");
    expect(prompt).toContain(pack.name);
    expect(prompt).toContain("PRESERVE IDENTITY");
    expect(validatePromptFidelity(prompt, expectedPrompt()).status).toBe("PASS");
    expect(validateImageSource({ ...sourceContext("START_FRAME"), sourceSceneId: sourceSpec.scenes[0].sourceSceneId, generatedSceneId: "generated-scene-audit-1" }, imageObservation).characterFidelity).toBe("PASS");
    expect(validateSceneVideoSource({ ...sourceContext("SCENE_VIDEO"), sourceSceneId: sourceSpec.scenes[0].sourceSceneId, generatedSceneId: "generated-scene-audit-1" }, videoObservation).characterFidelity).toBe("PASS");
  });

  it("AUDIT 3 keeps source beat/action/camera/spatial/timing/state through storyboard, image, video and final", () => {
    const storyboardResult = validateStoryboardSource(sourceContext(), storyboard);
    expect(storyboardResult.status).toBe("PASS");
    expect(validateImageSource({ ...sourceContext("START_FRAME"), sourceSceneId: sourceSpec.scenes[0].sourceSceneId }, imageObservation).sourceFidelity).toBe("PASS");
    expect(validateSceneVideoSource({ ...sourceContext("SCENE_VIDEO"), sourceSceneId: sourceSpec.scenes[0].sourceSceneId }, videoObservation).sourceFidelity).toBe("PASS");
    expect(finalSourceApproval(validateFinalVideoSource(sourceContext("FINAL_VIDEO"), finalObservation))).toBe("APPROVED");
  });

  it("AUDIT 4 fails early on identity drift", () => {
    const identity = validateCharacterIdentity({ lockedTraits: pack.lockedTraits, actualIdentity: { ...pack.lockedTraits, faceIdentity: "different face" }, actualStyleType: pack.styleType });
    expect(identityGenerationGate(identity)).toBe("BLOCK");
  });

  it("AUDIT 5 fails prompt action drift before generation", () => {
    const result = validatePromptFidelity(`${compileStrictPrompt(expectedPrompt(), "Use source constraints.")}\nThen jump and dance.`, expectedPrompt());
    expect(promptFidelityGate(result)).toMatchObject({ status: "FAIL", generationAllowed: false });
  });

  it("AUDIT 6 fails prompt camera drift before generation", () => {
    const result = validatePromptFidelity(`${compileStrictPrompt(expectedPrompt(), "Use source constraints.")}\nThe camera dynamically orbits around the character.`, expectedPrompt());
    expect(result.checks.find((check) => check.validatorId === "PROMPT_CAMERA_MATCH")?.status).toBe("FAIL");
    expect(promptFidelityGate(result).generationAllowed).toBe(false);
  });

  it("AUDIT 7 fails wrong start-frame source shot and blocks scene video", () => {
    const result = validateImageSource({ ...sourceContext("START_FRAME"), sourceSceneId: sourceSpec.scenes[0].sourceSceneId }, { ...imageObservation, shotSize: "close-up" });
    expect(result.sourceFidelity).toBe("FAIL");
  });

  it("AUDIT 8 fails wrong scene-video action and does not approve the scene", () => {
    const result = validateSceneVideoSource({ ...sourceContext("SCENE_VIDEO"), sourceSceneId: sourceSpec.scenes[0].sourceSceneId }, { ...videoObservation, actionMatch: false, actionSequence: ["type"] });
    expect(result.status).toBe("FAIL");
    expect(result.findings.some((finding) => finding.validatorId === "SOURCE_ACTION_MATCH")).toBe(true);
  });

  it("AUDIT 9 fails final scene order but preserves SUCCESS and outputReady through Post-Assembly QA", async () => {
    const qaContext: QaContext = { projectId: "project-audit-1", finalVideoPath: "final.mp4", finalVideoVersion: "final-v1", approvedManifest: null, expectedSceneStates: {}, approvedSources: [], checkpoint: { generationStatus: "SUCCESS", outputReady: true }, sourceValidation: { ...sourceContext("FINAL_VIDEO"), finalObservation: { ...finalObservation, sceneOrder: [2] } } };
    const run = await new PostAssemblyQaOrchestrator([sourceFidelityValidator]).run(qaContext);
    expect(run.qualityStatusAfter).toBe("NEEDS_REVIEW");
    expect(qaContext.checkpoint).toMatchObject({ generationStatus: "SUCCESS", outputReady: true });
    expect(run.incidentsCreated.length).toBeGreaterThan(0);
  });

  it("AUDIT 10 distinguishes first divergence at source spec, prompt, image, scene video and final assembly", () => {
    const sourceSpecFailure = validateStrictModelingSetup({ sourceVideoId: "source-audit-1", sourceVideoUrl: sourceSpec.sourceVideoUrl, sourceDuration: 4, sourceModelingSpec: null });
    expect(sourceSpecFailure.errors).toContain("SOURCE_MODELING_SPEC_MISSING");
    expect(validatePromptFidelity("bad prompt", expectedPrompt()).checks.some((check) => check.status === "FAIL")).toBe(true);
    expect(traceFirstDivergence([validateImageSource({ ...sourceContext("START_FRAME"), sourceSceneId: sourceSpec.scenes[0].sourceSceneId }, { ...imageObservation, shotSize: "close-up" })])).toMatchObject({ firstDivergence: "START_FRAME_OUTPUT" });
    expect(traceFirstDivergence([validateSceneVideoSource({ ...sourceContext("SCENE_VIDEO"), sourceSceneId: sourceSpec.scenes[0].sourceSceneId }, { ...videoObservation, cameraMatch: false })])).toMatchObject({ firstDivergence: "SCENE_VIDEO_OUTPUT" });
    expect(traceFirstDivergence([validateFinalVideoSource(sourceContext("FINAL_VIDEO"), { ...finalObservation, sceneOrder: [2] })])).toMatchObject({ firstDivergence: "FINAL_ASSEMBLY_OUTPUT" });
  });

  it("AUDIT 11 rejects unauthorized creative drift while accepting allowed transformations", () => {
    const allowed = validatePromptFidelity(`${compileStrictPrompt(expectedPrompt(), "Apply the allowed background and outfit transformation.")}\nUse the allowed 2D style.`, expectedPrompt());
    const drift = validatePromptFidelity(`${compileStrictPrompt(expectedPrompt(), "Apply the allowed background transformation.")}\nAdd a new joke, reaction and ending.`, expectedPrompt());
    expect(allowed.status).toBe("PASS");
    expect(drift.checks.find((check) => check.validatorId === "PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION")?.status).toBe("FAIL");
  });

  it("AUDIT 12 persists and verifies the exact validated/sent prompt identity", () => {
    const validatedPrompt = compileStrictPrompt(expectedPrompt(), "same draft");
    const validatedHash = createHash("sha256").update(validatedPrompt).digest("hex");
    const actualSentHash = createHash("sha256").update(validatedPrompt).digest("hex");
    const mutatedHash = createHash("sha256").update(`${validatedPrompt} `).digest("hex");
    expect(actualSentHash).toBe(validatedHash);
    expect(mutatedHash).not.toBe(validatedHash);
  });

  it("AUDIT 13 keeps unknown/failure handling on the existing QA incident path without an unbounded retry", async () => {
    let reports = 0;
    const qaContext: QaContext = { projectId: "project-audit-1", finalVideoPath: "final.mp4", finalVideoVersion: "final-v2", approvedManifest: null, expectedSceneStates: {}, approvedSources: [], checkpoint: { generationStatus: "SUCCESS", outputReady: true }, sourceValidation: { ...sourceContext("FINAL_VIDEO"), finalObservation: { ...finalObservation, punchlineMatch: false } } };
    const run = await new PostAssemblyQaOrchestrator([sourceFidelityValidator], undefined, async () => "audit-hash", async () => { reports += 1; }).run(qaContext);
    expect(run.qualityStatusAfter).toBe("NEEDS_REVIEW");
    expect(reports).toBeGreaterThan(0);
    expect(reports).toBeLessThan(10);
  });

  it("AUDIT 14 confirms STEP 3 validators remain active and do not collapse character/source/technical domains", () => {
    const result = validateImageSource({ ...sourceContext("START_FRAME"), sourceSceneId: sourceSpec.scenes[0].sourceSceneId }, imageObservation);
    expect(result.characterFidelity).toBe("PASS");
    expect(result.sourceFidelity).toBe("PASS");
    expect(result.technicalQuality).toBe("PASS");
  });
});
