import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(process.cwd(), "electron/main.cjs"), "utf8");

describe("ISSUE-023 Flow prompt input contract", () => {
  it("uses native CDP text insertion for the managed Edge contenteditable", () => {
    expect(source).toContain('window.webContents.debugger.sendCommand("Input.insertText", { text: prompt })');
    expect(source).toContain('inputMethod: prepared?.contentEditable && window?.edgeRuntime ? "EDGE_CDP_INPUT_INSERT_TEXT" : "DOM_INPUT"');
  });

  it("verifies that Flow accepted the prompt and enabled generation before clicking", () => {
    expect(source).toContain("FLOW_PROMPT_INPUT_NOT_ACCEPTED");
    expect(source).toContain("FLOW_GENERATE_CONTROL_DISABLED_AFTER_PROMPT");
    expect(source).toContain("await setFlowPrompt(targetWindow, prompt);");
  });

  it("reads rendered innerText for contenteditable prompts instead of losing Flow line separators via textContent", () => {
    expect(source).toContain("input?.tagName === 'TEXTAREA' ? input.value : (input?.innerText || input?.textContent || '')");
    expect(source).not.toContain("text: input?.value || input?.textContent || ''");
  });

  it("does not send a video job through the old synthetic contenteditable insertion", () => {
    const videoJob = source.slice(source.indexOf("async function runFlowVideoJobUnlocked"), source.indexOf("async function runFlowVideoJob(event"));
    expect(videoJob).not.toContain("document.execCommand('insertText', false, prompt)");
    expect(videoJob).toContain("await setFlowPrompt(targetWindow, prompt);");
  });
});

describe("Flow generation blocker contract", () => {
  it("fails fast on Google's unusual-activity block instead of waiting or retrying", () => {
    expect(source).toContain("FLOW_PROVIDER_UNUSUAL_ACTIVITY");
    expect(source).toContain("FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK");
    expect(source).toContain("unusual activity|hoạt động bất thường");
    expect(source).toContain("notCharged: state.notCharged === true");
    expect(source).toContain("autoRetryAllowed: false");
    expect(source).toContain("providerJobCreated: false");
    const waitStart = source.indexOf("async function waitForFlowVideo(");
    const waitEnd = source.indexOf("async function readFlowMediaDataThroughPageOnce", waitStart);
    const waitSource = source.slice(waitStart, waitEnd);
    expect(waitSource).toContain("throw createFlowGenerationFailure");
    expect(waitSource.indexOf("throw createFlowGenerationFailure")).toBeLessThan(waitSource.indexOf("await delay(2_000)"));
  });

  it("keeps the provider block structured while allowing one explicit reload-and-resend recovery", () => {
    const recoveryStart = source.indexOf("async function waitForFlowVideoWithRecovery");
    const recoveryEnd = source.indexOf("function normalizeFlowPromptText", recoveryStart);
    const recoverySource = source.slice(recoveryStart, recoveryEnd);
    expect(recoverySource).toContain("isNonRetryableFlowProviderBlock");
    expect(recoverySource).toContain("MAX_FLOW_PROVIDER_RELOAD_RECOVERY");
    expect(recoverySource).toContain("context.allowProviderReloadRecovery === true");
    expect(recoverySource).toContain("context.resendAfterReload");
    expect(recoverySource).toContain("await reloadFlowProject(window, projectUrl);");
    expect(recoverySource).toContain("if (isNonRetryableFlowProviderBlock(retryError)) throw retryError;");
    expect(source).toContain("boundedReloadRecoveryAllowed");
    expect(source).not.toContain("FLOW_GENERATION_REQUEST_BLOCKED");
  });

  it("rebinds the source image and prompt before the one bounded resend", () => {
    const videoJobStart = source.indexOf("async function runFlowVideoJobUnlocked");
    const videoJobEnd = source.indexOf("async function runFlowVideoJob(event", videoJobStart);
    const videoJob = source.slice(videoJobStart, videoJobEnd);
    expect(videoJob).toContain("const prepareVideoSubmission = async (targetWindow)");
    expect(videoJob).toContain("await uploadFlowAsset(targetWindow, imagePath");
    expect(videoJob).toContain("await addFlowAssetToStart(targetWindow, imagePath);");
    expect(videoJob).toContain("await setFlowPrompt(targetWindow, prompt);");
    expect(videoJob).toContain("resendAfterReload: async");
    expect(videoJob).toContain("await submitPreparedVideo(targetWindow, retryPrepared);");
  });

  it("records safe stage/scene/provider evidence and preserves completed scenes on resume", () => {
    expect(source).toContain("stage: \"STAGE_4_VIDEO_GENERATION\"");
    expect(source).toContain("flowProjectUrl: projectUrl");
    expect(source).toContain("generationStarted: false");
    expect(source).toContain("providerBlockedAt");
    expect(source).toContain("sceneId: typeof slot.sceneId === \"string\" ? slot.sceneId : null");
  });
});

describe("ISSUE-033 Flow Start-frame binding contract", () => {
  it("requires the Frames radio to be selected and Ingredients to be unselected", () => {
    expect(source).toContain("async function ensureFlowFramesMode");
    expect(source).toContain("FLOW_START_FRAME_MODE_NOT_SELECTED");
    expect(source).toContain("flow-frames-mode-verified");
    expect(source).toContain("framesSelected && !ingredientsSelected");
    expect(source).toContain("await ensureFlowFramesMode(window);");
  });

  it("does not accept a generic image/ingredient chip unless Frames mode is active", () => {
    const verifyStart = source.indexOf("async function verifyFlowStartFrameAttachment");
    const verifyEnd = source.indexOf("async function ensureFlowAspectRatio", verifyStart);
    const verifySource = source.slice(verifyStart, verifyEnd);
    expect(verifySource).toContain("const framesSelected");
    expect(verifySource).toContain("if ((frames || ingredients) && (!framesSelected || ingredientsSelected)) return false;");
    expect(verifySource).toContain('button[aria-label="Image ingredient"] img');
    expect(verifySource).not.toContain("img[data-media-id]");
  });
});

describe("ISSUE-029 manual Flow handoff lifecycle", () => {
  it("treats an already persisted checkpoint video as idempotently complete without reopening Flow", () => {
    const handoffStart = source.indexOf("async function resumeAfterManualFlowSubmission");
    const handoffEnd = source.indexOf("async function prepareManualFlowSubmission", handoffStart);
    const handoffSource = source.slice(handoffStart, handoffEnd);
    expect(handoffSource).toContain("const savedVideoAvailable = fs.existsSync(savedPath) && fs.statSync(savedPath).size >= 1024;");
    expect(handoffSource).toContain("if (savedVideoAvailable) {");
    expect(handoffSource.indexOf("if (savedVideoAvailable)")).toBeLessThan(handoffSource.indexOf("createFlowWindow()"));
  });

  it("bounds manual media recovery and always releases the Flow window/operation", () => {
    const handoffStart = source.indexOf("async function resumeAfterManualFlowSubmission");
    const handoffEnd = source.indexOf("async function prepareManualFlowSubmission", handoffStart);
    const handoffSource = source.slice(handoffStart, handoffEnd);
    expect(source).toContain("MANUAL_FLOW_HANDOFF_MEDIA_TIMEOUT_MS = 45_000");
    expect(handoffSource).toContain("withTimeout(getFlowVideoBuffer(window, result)");
    expect(handoffSource).toContain("finally {");
    expect(handoffSource).toContain("await closeFlowWindow(false).catch(() => {});");
  });

  it("requires a bounded Generate acknowledgement and has one same-send DOM fallback", () => {
    expect(source).toContain("async function waitForFlowSubmissionAcknowledgement");
    expect(source).toContain("async function clickFlowGenerateDomFallback");
    const submitStart = source.indexOf("const submitPreparedVideo = async");
    const submitEnd = source.indexOf("const prepared = await prepareVideoSubmission", submitStart);
    const submitSource = source.slice(submitStart, submitEnd);
    expect(submitSource).toContain("waitForFlowSubmissionAcknowledgement");
    expect(submitSource).toContain("clickFlowGenerateDomFallback");
    expect(submitSource).toContain("FLOW_GENERATION_SUBMISSION_NOT_CONFIRMED");
    expect(submitSource).not.toContain("await delay(1_200)");
  });
});
