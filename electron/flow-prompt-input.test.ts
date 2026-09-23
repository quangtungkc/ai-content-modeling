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

  it("uses the same native CDP prompt insertion for Flow image jobs", () => {
    const imageJob = source.slice(source.indexOf("async function runFlowImageJobUnlocked"), source.indexOf("async function runFlowImageJob(event"));
    expect(imageJob).not.toContain("document.execCommand('insertText', false, prompt)");
    expect(imageJob).toContain("await setFlowPrompt(window, compiledPrompt);");
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

  it("settles the Flow page before a bounded resend and ignores stale provider banners during that window", () => {
    expect(source).toContain("const FLOW_PROVIDER_RELOAD_SETTLE_MS = 10_000;");
    expect(source).toContain("async function reloadFlowProject(window, projectUrl, settleMs = 1_500)");
    expect(source).toContain("await reloadFlowProject(window, projectUrl, FLOW_PROVIDER_RELOAD_SETTLE_MS);");
    expect(source).toContain("providerDetectionNotBefore: Date.now() + FLOW_PROVIDER_RELOAD_SETTLE_MS");
    expect(source).toContain("state?.unusualActivity && (!Number.isFinite(context.providerDetectionNotBefore) || Date.now() >= context.providerDetectionNotBefore)");
    expect(source).toContain('throw createFlowGenerationFailure("FLOW_PROVIDER_UNUSUAL_ACTIVITY"');
  });

  it("records safe stage/scene/provider evidence and preserves completed scenes on resume", () => {
    expect(source).toContain("stage: \"STAGE_4_VIDEO_GENERATION\"");
    expect(source).toContain("flowProjectUrl: projectUrl");
    expect(source).toContain("generationStarted: false");
    expect(source).toContain("providerBlockedAt");
    expect(source).toContain("sceneId: typeof slot.sceneId === \"string\" ? slot.sceneId : null");
  });
});

describe("Flow human-paced interaction contract", () => {
  it("paces controls, upload, prompt entry and the final Generate action without changing retry policy", () => {
    expect(source).toContain("const FLOW_HUMAN_PACE = Object.freeze");
    expect(source).toContain("control: 900");
    expect(source).toContain("prompt: 1_200");
    expect(source).toContain("upload: 1_500");
    expect(source).toContain("beforeGenerate: 2_500");
    expect(source).toContain('await flowHumanPause("control")');
    expect(source).toContain('await flowHumanPause("upload")');
    expect(source).toContain('await flowHumanPause("prompt")');
    expect(source).toContain('await flowHumanPause("beforeGenerate")');
    expect(source).toContain("const MAX_FLOW_PROVIDER_RELOAD_RECOVERY = 1;");
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

describe("ISSUE-038 Flow asset picker compatibility", () => {
  it("recognizes current Flow overlay containers and role=option asset tiles", () => {
    expect(source).toContain('flow-add-menu-popover-content, [role="dialog"], .cdk-overlay-pane');
    expect(source).toContain('flow-grid-tile-container, flow-tile-container, [role="option"]');
    expect(source).toContain("element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent");
  });
});

describe("ISSUE-039 Flow image response retrieval", () => {
  it("uses authenticated Edge CDP response capture before CORS-limited page fetch", () => {
    const start = source.indexOf("async function getFlowImageBuffer");
    const end = source.indexOf("async function waitForFlowImageWithRecovery", start);
    const imageBufferSource = source.slice(start, end);
    expect(imageBufferSource).toContain("const liveCdpSources = [...new Set([...(await listFlowImageSources(window)), result.imageSource])];");
    expect(imageBufferSource).toContain('readFlowMediaBufferThroughCdp(window, liveSource, "image")');
    expect(imageBufferSource.indexOf("liveCdpSources")).toBeLessThan(imageBufferSource.indexOf("readFlowImageDataFromCandidates"));
  });
});

describe("ISSUE-042 development FFmpeg runtime", () => {
  it("resolves packaged-unpacked and repository-bundled FFmpeg before considering a machine-wide fallback", () => {
    const start = source.indexOf("function findFfmpegPath()");
    const end = source.indexOf("function runFfmpeg", start);
    const ffmpegSource = source.slice(start, end);
    expect(ffmpegSource).toContain('path.join(process.resourcesPath || "", "app.asar.unpacked", "electron", "dist", "ffmpeg", "ffmpeg.exe")');
    expect(ffmpegSource).toContain('path.join(__dirname, "dist", "ffmpeg", "ffmpeg.exe")');
    expect(ffmpegSource.indexOf("packagedUnpacked")).toBeLessThan(ffmpegSource.indexOf("const capCutApps"));
    expect(ffmpegSource.indexOf("developmentBundled")).toBeLessThan(ffmpegSource.indexOf("const capCutApps"));
  });
});

describe("ISSUE-043 Gemini bare new-chat state", () => {
  it("uses an already-ready bare /app composer instead of requiring a sidebar New chat button", () => {
    const start = source.indexOf("async function openNewGeminiConversation");
    const end = source.indexOf("async function waitForGeminiNewChatReady", start);
    const newChatSource = source.slice(start, end);
    expect(newChatSource).toContain("BARE_APP_ALREADY_READY");
    expect(newChatSource).toContain("DIRECT_BARE_APP_NAVIGATION");
    expect(newChatSource).toContain("existingNewChat?.bare && existingNewChat?.inputReady");
    expect(newChatSource.indexOf("DIRECT_BARE_APP_NAVIGATION")).toBeLessThan(newChatSource.indexOf("const clicked"));
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
