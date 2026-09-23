import { describe, expect, it } from "vitest";
import { buildSourceVideoModelingSpec } from "@/modules/modeling/strict-source-modeling";
import { boundedPromptRecompile, compileStrictPrompt, compileStrictVideoPrompt, promptFidelityGate, STRICT_GEMINI_PROMPT_COMPILER_SYSTEM_INSTRUCTION, validatePromptFidelity, type PromptExpectedState } from "./validator";

const sourceSpec = buildSourceVideoModelingSpec({ specVersion: "prompt-fixture-1", sourceVideoId: "source-prompt", sourceVideoUrl: "https://example.test/source.mp4", sourceVideoMetadata: { fixture: true }, sourceDuration: 4, sourcePlatform: "fixture", scenes: [{ sourceSceneId: "source-scene-1", order: 1, sourceStartTime: 0, sourceEndTime: 4, duration: 4, storyBeat: "Nhân vật nhìn hộp rồi gõ bàn phím", cameraType: "static", shotSize: "medium", cameraAngle: "eye-level", cameraMovement: "none", framing: "subject left, keyboard right", subjectPosition: "left", relativeObjectPositions: ["keyboard right"], characterAction: "look and type", actionSequence: ["look at box", "turn toward keyboard", "type"], propAction: "keyboard interaction", startState: "seated looking at box", endState: "typing", transitionIn: "cut", transitionOut: "hold", timingNotes: "type at 3s", rhythmNotes: "quick", mustPreserve: ["look before typing", "keyboard remains right"], allowedTransformations: ["background", "2D style", "outfit"], punchlineRole: "payoff", gagRole: "payoff", dialogueRole: null, textRole: null }] });
const expected = (overrides: Partial<PromptExpectedState> = {}): PromptExpectedState => ({ projectId: "project-prompt", sceneId: "scene-1", sourceSceneId: "source-scene-1", sourceSpecVersion: sourceSpec.specVersion, expectedStateVersion: "prompt-fixture-1:source-scene-1", characterIdentityPackVersion: "character-v1", timingTolerance: sourceSpec.timingTolerance, sourceScene: sourceSpec.scenes[0], identityPack: { name: "Main Character Pack", lockedTraits: { faceIdentity: "locked", bodyBuild: "locked" }, allowedVariations: ["outfit"], negativeRules: ["Never replace the main character."] }, sceneAppearance: "blue shirt, seated", textPolicy: { mode: "NO_READABLE_TEXT" }, allowedTransformations: sourceSpec.scenes[0].allowedTransformations, promptType: "VIDEO", ...overrides });
const validDraft = () => compileStrictPrompt(expected(), "Follow the source exactly with the approved scene appearance.");
const cameraExpected = (cameraMovement: string) => expected({ sourceScene: { ...sourceSpec.scenes[0], cameraMovement } });

describe("STEP 4 strict prompt fidelity gate", () => {
  it("CASE 1 passes a prompt that preserves all source constraints", () => expect(validatePromptFidelity(validDraft(), expected()).status).toBe("PASS"));
  it("CASE 2 fails when the source beat is missing", () => expect(validatePromptFidelity(validDraft().replace("Nhân vật nhìn hộp rồi gõ bàn phím", "Nhân vật nhìn hộp"), expected()).checks.find((check) => check.validatorId === "PROMPT_SOURCE_BEAT_MATCH")?.status).toBe("FAIL"));
  it("CASE 3 fails when action order is reversed", () => expect(validatePromptFidelity(validDraft().replace("1. look at box 2. turn toward keyboard 3. type", "1. type 2. look at box 3. turn toward keyboard"), expected()).checks.find((check) => check.validatorId === "PROMPT_ACTION_ORDER_MATCH")?.status).toBe("FAIL"));
  it("CASE 4 fails when Gemini adds a new action", () => expect(validatePromptFidelity(`${validDraft()}\nThen jump and dance.`, expected()).checks.find((check) => check.validatorId === "PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION")?.status).toBe("FAIL"));
  it("CASE 5 fails when static camera becomes orbit", () => expect(validatePromptFidelity(`${validDraft()}\nThe camera dynamically orbits around the character.`, expected()).checks.find((check) => check.validatorId === "PROMPT_CAMERA_MATCH")?.status).toBe("FAIL"));
  it("CASE 6 fails when medium shot becomes close-up", () => expect(validatePromptFidelity(`${validDraft()}\nUse a close-up shot.`, expected()).checks.find((check) => check.validatorId === "PROMPT_CAMERA_MATCH")?.status).toBe("FAIL"));
  it("CASE 7 fails when critical subject position changes", () => expect(validatePromptFidelity(`${validDraft()}\nThe subject is on the right.`, expected()).checks.find((check) => check.validatorId === "PROMPT_SPATIAL_MATCH")?.status).toBe("FAIL"));
  it("CASE 8 fails when start state changes", () => expect(validatePromptFidelity(validDraft().replace("seated looking at box", "standing looking at camera"), expected()).checks.find((check) => check.validatorId === "PROMPT_START_STATE_MATCH")?.status).toBe("FAIL"));
  it("CASE 9 fails when end state changes", () => expect(validatePromptFidelity(validDraft().replace("END STATE: typing", "END STATE: walking away"), expected()).checks.find((check) => check.validatorId === "PROMPT_END_STATE_MATCH")?.status).toBe("FAIL"));
  it("CASE 10 fails when duration exceeds strict tolerance", () => expect(validatePromptFidelity(`${validDraft()}\nTarget duration: 8 seconds.`, expected()).checks.find((check) => check.validatorId === "PROMPT_TIMING_MATCH")?.status).toBe("FAIL"));
  it("CASE 11 permits a background transformation", () => expect(validatePromptFidelity(`${validDraft()}\nApply the allowed background transformation.`, expected()).status).toBe("PASS"));
  it("CASE 12 permits a 3D to 2D style transformation", () => expect(validatePromptFidelity(`${validDraft()}\nUse the allowed 2D style.`, expected()).status).toBe("PASS"));
  it("CASE 13 permits an outfit change while identity remains locked", () => expect(validatePromptFidelity(`${validDraft()}\nChange only the outfit as allowed.`, expected()).status).toBe("PASS"));
  it("CASE 14 fails when prompt describes a different character", () => expect(validatePromptFidelity(`${validDraft()}\nUse a character similar to the main character instead.`, expected()).checks.find((check) => check.validatorId === "PROMPT_CHARACTER_IDENTITY_LOCK")?.status).toBe("FAIL"));
  it("CASE 15 fails REQUIRED_TEXT paraphrase", () => expect(validatePromptFidelity(validDraft().replace("NO_READABLE_TEXT. Do not render readable words, letters, numbers, captions, labels, logos or symbols.", "REQUIRED_TEXT exactly = \"Open\"."), expected({ textPolicy: { mode: "REQUIRED_TEXT", requiredText: "Open now" } })).checks.find((check) => check.validatorId === "PROMPT_TEXT_POLICY_MATCH")?.status).toBe("FAIL"));
  it("CASE 16 fails a readable text instruction under NO_READABLE_TEXT", () => expect(validatePromptFidelity(`${validDraft()}\nDisplay readable UI text.`, expected()).checks.find((check) => check.validatorId === "PROMPT_TEXT_POLICY_MATCH")?.status).toBe("FAIL"));
  it("CASE 17 ignores Gemini self-check and uses the app validator", () => { const result = validatePromptFidelity(`${validDraft()}\nThen jump.`, expected(), { SOURCE_BEATS_PRESERVED: true, ACTION_ORDER_PRESERVED: true }); expect(result.selfCheckAuthoritative).toBe(false); expect(result.status).toBe("FAIL"); });
  it("CASE 18 blocks when the prompt is not evaluated", () => { const result = validatePromptFidelity("", expected()); expect(promptFidelityGate(result)).toMatchObject({ status: "NEEDS_REVIEW", generationAllowed: false }); });
  it("CASE 19 recompiles a failed prompt with bounded attempts", async () => { const result = await boundedPromptRecompile({ initialPrompt: "bad", expected: expected(), maxAttempts: 2, recompile: async () => validDraft() }); expect(result.result.status).toBe("PASS"); expect(result.attempts).toBe(2); });
  it("CASE 20 stops a recompile loop at the configured maximum", async () => { const result = await boundedPromptRecompile({ initialPrompt: "bad", expected: expected(), maxAttempts: 2, recompile: async () => "still bad" }); expect(result.result.status).not.toBe("PASS"); expect(result.attempts).toBe(2); });
  it("CASE 21 allows a passing image prompt", () => expect(promptFidelityGate(validatePromptFidelity(validDraft(), expected({ promptType: "IMAGE" }))).generationAllowed).toBe(true));
  it("CASE 22 blocks a failing video prompt", () => expect(promptFidelityGate(validatePromptFidelity(`${validDraft()} Then jump.`, expected({ promptType: "VIDEO" }))).generationAllowed).toBe(false));
  it("CASE 23 keeps version fields in the compiled prompt trace", () => expect(validDraft()).toContain("SOURCE SPEC VERSION: prompt-fixture-1"));
  it("CASE 24 uses a deterministic validated prompt representation", () => expect(compileStrictPrompt(expected(), "same draft")).toBe(compileStrictPrompt(expected(), "same draft")));
  it("CASE 25 detects a one-character post-validation mutation by different content", () => expect(compileStrictPrompt(expected(), "same draft")).not.toBe(compileStrictPrompt(expected(), "same drafT")));
  it("CASE 26 emits the full source-to-prompt execution trace", () => expect(validDraft()).toMatch(/SOURCE BEAT:[\s\S]*ACTION SEQUENCE[\s\S]*CAMERA:[\s\S]*SPATIAL:[\s\S]*START STATE:[\s\S]*END STATE:/));
  it("CASE 27 exposes failed validator evidence", () => { const result = validatePromptFidelity(`${validDraft()}\nUse a close-up shot.`, expected()); const failed = result.checks.find((check) => check.validatorId === "PROMPT_CAMERA_MATCH"); expect(failed?.evidence).toBeDefined(); });
  it("CASE 28 returns a distinct gate result for a NOT_EVALUATED prompt", () => expect(promptFidelityGate(validatePromptFidelity("", expected())).status).toBe("NEEDS_REVIEW"));
  it("CASE 29 preserves the fixed compiler role", () => expect(STRICT_GEMINI_PROMPT_COMPILER_SYSTEM_INSTRUCTION).toContain("STRICT SOURCE-FAITHFUL PROMPT COMPILER"));
  it("CASE 30 keeps the allowed-transformation block explicit", () => expect(validDraft()).toContain("ALLOWED TRANSFORMATIONS:"));
  it("CASE 30A keeps the canonical three-difference policy authoritative", () => expect(validDraft()).toMatch(/CONTENT AND PROGRESSION LOCK[\s\S]*ALLOWED DIFFERENCE 1[\s\S]*ALLOWED DIFFERENCE 2[\s\S]*ALLOWED DIFFERENCE 3/));
  it("CASE 31 allows the exact authoritative Zoom in camera movement", () => expect(validatePromptFidelity(compileStrictPrompt(cameraExpected("Zoom in"), "Follow the source exactly."), cameraExpected("Zoom in")).checks.find((check) => check.validatorId === "PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION")?.status).toBe("PASS"));
  it("CASE 32 allows case-only normalization of the authoritative camera movement", () => expect(validatePromptFidelity(compileStrictPrompt(cameraExpected("Zoom in"), "zoom in"), cameraExpected("Zoom in")).checks.find((check) => check.validatorId === "PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION")?.status).toBe("PASS"));
  it("CASE 33 still blocks a non-authoritative crash zoom", () => expect(validatePromptFidelity(`${compileStrictPrompt(cameraExpected("Zoom in"), "Follow the source exactly.")}\nUse a slow dramatic crash zoom.`, cameraExpected("Zoom in")).checks.find((check) => check.validatorId === "PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION")?.status).toBe("FAIL"));
  it("CASE 34 still blocks pan left when the authoritative movement is Static", () => expect(validatePromptFidelity(`${compileStrictPrompt(cameraExpected("Static"), "Follow the source exactly.")}\nAdd a pan left.`, cameraExpected("Static")).checks.find((check) => check.validatorId === "PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION")?.status).toBe("FAIL"));
  it("CASE 35 allows an exact Pan right camera movement", () => expect(validatePromptFidelity(compileStrictPrompt(cameraExpected("Pan right"), "Follow the source exactly."), cameraExpected("Pan right")).status).toBe("PASS"));
  it("CASE 36 keeps unrelated creative actions blocked when camera movement is authoritative", () => expect(validatePromptFidelity(`${compileStrictPrompt(cameraExpected("Zoom in"), "Follow the source exactly.")}\nThen jump.`, cameraExpected("Zoom in")).checks.find((check) => check.validatorId === "PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION")?.status).toBe("FAIL"));
  it("CASE 37 allows an exact compound Pan down source movement", () => expect(validatePromptFidelity(compileStrictPrompt(cameraExpected("Pan down"), "Follow the source exactly."), cameraExpected("Pan down")).checks.find((check) => check.validatorId === "PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION")?.status).toBe("PASS"));
  it("CASE 38 still blocks an added pan left beside an authoritative Pan down", () => expect(validatePromptFidelity(`${compileStrictPrompt(cameraExpected("Pan down"), "Follow the source exactly.")}\nAdd a pan left.`, cameraExpected("Pan down")).checks.find((check) => check.validatorId === "PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION")?.status).toBe("FAIL"));
  it("CASE 39 compiles a complete authoritative video contract before the gate", () => {
    const prompt = compileStrictVideoPrompt(expected(), "descriptive scene prose");
    expect(prompt).toMatch(/VIDEO SOURCE BEAT[\s\S]*VIDEO ACTION PROGRESSION[\s\S]*VIDEO CAMERA MOVEMENT[\s\S]*VIDEO TIMING \/ RHYTHM[\s\S]*VIDEO START STATE[\s\S]*VIDEO END STATE[\s\S]*VIDEO CHARACTER IDENTITY LOCK/);
    expect(validatePromptFidelity(prompt, expected()).status).toBe("PASS");
  });
  it("CASE 40 keeps the exact authoritative camera movement in a video prompt", () => {
    const prompt = compileStrictVideoPrompt(cameraExpected("Zoom in"), "Use the approved camera contract.");
    expect(prompt).toContain("VIDEO CAMERA MOVEMENT (authoritative): Zoom in");
    expect(validatePromptFidelity(prompt, cameraExpected("Zoom in")).status).toBe("PASS");
  });
  it("CASE 41 blocks an unauthorized camera movement beside the source movement", () => {
    const prompt = `${compileStrictVideoPrompt(cameraExpected("Zoom in"), "Use the approved camera contract.")}\nAdd a pan left.`;
    expect(validatePromptFidelity(prompt, cameraExpected("Zoom in")).checks.find((check) => check.validatorId === "PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION")?.status).toBe("FAIL");
  });
  it("CASE 42 treats the authoritative source contract as stronger than descriptive prose", () => {
    const prompt = compileStrictVideoPrompt(cameraExpected("Static"), "Use a dramatic pan left and a close-up.");
    expect(validatePromptFidelity(prompt, cameraExpected("Static")).status).toBe("PASS");
  });
  it("CASE 43 produces deterministic video prompt hashes", () => expect(compileStrictVideoPrompt(expected(), "same prose")).toBe(compileStrictVideoPrompt(expected(), "different prose")));
  it("CASE 44 fails when the authoritative end state is removed", () => {
    const prompt = compileStrictVideoPrompt(expected(), "scene").replace("END STATE: typing", "END STATE: ");
    expect(validatePromptFidelity(prompt, expected()).checks.find((check) => check.validatorId === "PROMPT_END_STATE_MATCH")?.status).toBe("FAIL");
  });
  it("CASE 45 fails when the Character Identity lock is removed", () => {
    const prompt = compileStrictVideoPrompt(expected(), "scene").replaceAll("PRESERVE IDENTITY", "PRESERVE STYLE").replaceAll("VIDEO CHARACTER IDENTITY LOCK", "VIDEO STYLE LOCK");
    expect(validatePromptFidelity(prompt, expected()).checks.find((check) => check.validatorId === "PROMPT_CHARACTER_IDENTITY_LOCK")?.status).toBe("FAIL");
  });
  it("CASE 46 does not treat an authoritative medium close-up camera contract as a close-up conflict", () => {
    const camera = { ...sourceSpec.scenes[0], shotSize: "Medium close-up" };
    const prompt = compileStrictPrompt(expected({ sourceScene: camera }), "Use the approved frozen start frame.");
    expect(validatePromptFidelity(prompt, expected({ sourceScene: camera })).checks.find((check) => check.validatorId === "PROMPT_CAMERA_MATCH")?.status).toBe("PASS");
  });
  it("CASE 47 ignores approved scene-appearance prose while still blocking appended creative actions", () => {
    const approved = `${validDraft()}\nSCENE APPEARANCE STATE (authoritative for this scene):\nthe character starts a silly dance.`;
    expect(validatePromptFidelity(approved, expected()).checks.find((check) => check.validatorId === "PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION")?.status).toBe("PASS");
    expect(validatePromptFidelity(`${approved}\nTEXT POLICY: NO_READABLE_TEXT.\nThen jump and dance.`, expected()).checks.find((check) => check.validatorId === "PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION")?.status).toBe("FAIL");
  });
  it("CASE 48 ignores the compiler's VIDEO authoritative blocks", () => {
    const camera = { ...sourceSpec.scenes[0], shotSize: "Medium close-up" };
    const prompt = compileStrictVideoPrompt(expected({ sourceScene: camera, sceneAppearance: "Approved start-frame character does a silly dance." }), "ignored prose");
    expect(validatePromptFidelity(prompt, expected({ sourceScene: camera, sceneAppearance: "Approved start-frame character does a silly dance." })).status).toBe("PASS");
  });
  it("CASE 49 ignores multiline approved VIDEO scene appearance content", () => {
    const prompt = compileStrictVideoPrompt(expected({ sceneAppearance: "Approved composition.\n9:16 aspect ratio. The character performs a silly dance." }), "ignored prose");
    expect(validatePromptFidelity(prompt, expected({ sceneAppearance: "Approved composition.\n9:16 aspect ratio. The character performs a silly dance." })).status).toBe("PASS");
  });
  it("CASE 50 still blocks creative additions appended after the VIDEO contract", () => {
    const prompt = `${compileStrictVideoPrompt(expected(), "ignored prose")}\nThen jump and dance.`;
    expect(validatePromptFidelity(prompt, expected()).checks.find((check) => check.validatorId === "PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION")?.status).toBe("FAIL");
  });
  it("CASE 51 starts every VIDEO prompt with the explicit 9:16 instruction", () => {
    const prompt = compileStrictVideoPrompt(expected(), "ignored prose");
    expect(prompt.startsWith("TẠO VIDEO KÍCH THƯỚC 9:16.\n")).toBe(true);
    expect(prompt).toContain("OUTPUT REQUIREMENT: Create the video in a vertical 9:16 aspect ratio.");
  });
});
