import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const mainSource = fs.readFileSync(path.resolve(__dirname, "main.cjs"), "utf8");
const lifecycleSource = fs.readFileSync(path.resolve(__dirname, "gemini-browser-lifecycle.cjs"), "utf8");
const preloadSource = fs.readFileSync(path.resolve(__dirname, "preload.cjs"), "utf8");
const transport = require("./gemini-error-transport.cjs") as {
  serializeGeminiError: (error: unknown) => Record<string, unknown>;
  reviveStructuredError: (payload: Record<string, unknown>) => Error & Record<string, unknown>;
};

describe("ISSUE-002 send/response boundary", () => {
  it("uses the canonical renderer database for Stage 3 project lookups", () => {
    expect(mainSource).toContain("const configuredDatabaseUrl = process.env.DESKTOP_DATABASE_URL || process.env.DATABASE_URL;");
    expect(mainSource).toContain("function canonicalDesktopDataRoot()");
    expect(mainSource).toContain('path.join(canonicalDesktopDataRoot(), "channel-characters")');
    expect(mainSource).toContain("function generatedMediaRoot()");
    expect(mainSource).toContain('path.join(generatedMediaRoot(), "generated-images", projectId)');
    expect(mainSource).toContain('path.join(generatedMediaRoot(), "generated-videos", projectId)');
    expect(mainSource).toContain("ContentProject does not exist");
  });

  it("removes composer-cleared as a production submission confirmation", () => {
    expect(mainSource).not.toContain("DOM_COMPOSER_CLEARED");
    expect(lifecycleSource).toContain("DOM_USER_TURN_EXACT");
    expect(mainSource).toContain("setSubmissionBaseline");
  });

  it("detects reset during send and labels cookie rotation when observed", () => {
    expect(mainSource).toContain("GEMINI_CONVERSATION_RESET_DURING_SEND");
    expect(mainSource).toContain("RotateCookies");
    expect(mainSource).toContain("geminiSendResetEvidence");
  });

  it("allows only one exact-conversation recovery resend", () => {
    expect(mainSource).toContain("recoverGeminiConversationForSend");
    expect(mainSource).toContain("if (attempt === 0)");
    expect(mainSource).toContain("attempt = 1");
    expect(mainSource).toContain("RESEND_ALLOWED_ONCE");
  });

  it("does not start response completion until submission and generation are confirmed", () => {
    expect(mainSource).toContain("await waitForGeminiSubmissionConfirmation");
    expect(mainSource).toContain("await waitForGeminiGenerationStart");
    expect(mainSource).toContain("command.markGenerating();");
    expect(mainSource).toContain("GEMINI_SUBMISSION_NOT_CONFIRMED");
  });

  it("hashes Gemini user-query text without the accessibility label or collapsed preview", () => {
    expect(mainSource).toContain("const userPromptTextOf");
    expect(mainSource).toContain("querySelectorAll?.('.query-text-line')");
    expect(mainSource).toContain("const text = userPromptTextOf(turn)");
  });

  it("preserves the first command failure when the finalizer also sees URL mismatch", () => {
    expect(mainSource).toContain("primaryCommandError");
    expect(mainSource).toContain("gemini-conversation-finalizer-secondary-failure");
    expect(mainSource).toContain("primaryFailurePreserved: true");
  });

  it("ISSUE-003 makes the exhausted recovery reset terminal before the generic fallback", () => {
    const resetBranchStart = mainSource.indexOf("if (confirmation.reset?.reset)");
    const genericFallbackStart = mainSource.indexOf("const failureCode = confirmation.confirmationTimeout", resetBranchStart);
    const resetBranch = mainSource.slice(resetBranchStart, genericFallbackStart);
    expect(resetBranch).toContain("createGeminiConversationResetError");
    expect(resetBranch).toContain("recoveryBudget: 1");
    expect(resetBranch).toContain("command.markFailed(resetError)");
    expect(resetBranch).toContain("throw resetError");
    expect(resetBranch.indexOf("throw resetError")).toBeGreaterThan(resetBranch.indexOf("if (attempt === 0)"));
  });

  it("keeps the generic submission error only as a no-specific-failure fallback", () => {
    expect(mainSource).toContain("const failureCode = confirmation.confirmationTimeout ? \"GEMINI_SUBMISSION_NOT_CONFIRMED\" : \"GEMINI_SUBMISSION_FAILED\";");
    expect(mainSource).toContain("primaryFailurePreserved: true");
  });

  it("requires the Gemini video composer to clear after the CDP/DOM send", () => {
    expect(mainSource).toContain("gemini-video-send-pointer-recovery");
    expect(mainSource).toContain("videoComposerStillContainsPromptAfterRecovery");
    expect(mainSource).toContain("GEMINI_SUBMISSION_NOT_CONFIRMED: video composer");
  });

  it("settles Gemini third-party-provider video refusals immediately", () => {
    expect(mainSource).toContain("thirdPartyContentBlocked");
    expect(mainSource).toContain("GEMINI_VIDEO_PROVIDER_THIRD_PARTY_BLOCKED");
    expect(mainSource).toContain("autoRetryAllowed: false");
    expect(mainSource).toContain("gemini-video-provider-error");
  });
});

describe("ISSUE-004 structured Stage-2 error transport", () => {
  it("serializes and revives the exact Gemini failure without secrets", () => {
    const sourceError = new Error("GEMINI_CONVERSATION_RESET_DURING_SEND: reset");
    Object.assign(sourceError, {
      code: "GEMINI_CONVERSATION_RESET_DURING_SEND",
      firstDivergence: "GEMINI_CONVERSATION_RESET_DURING_SEND",
      cause: "AUTH_COOKIE_ROTATION_CONVERSATION_RESET",
      context: {
        expectedConversationUrl: "https://gemini.google.com/app/conversation-1",
        actualUrl: "https://gemini.google.com/app",
        recoveryAttempt: 1,
        recoveryBudget: 1,
        userTurnDelta: 0,
        assistantTurnDelta: 0,
        generationRequestObserved: false,
        token: "must-not-cross",
      },
    });
    const dto = transport.serializeGeminiError(sourceError);
    expect(dto).toMatchObject({ code: "GEMINI_CONVERSATION_RESET_DURING_SEND", firstDivergence: "GEMINI_CONVERSATION_RESET_DURING_SEND", cause: "AUTH_COOKIE_ROTATION_CONVERSATION_RESET", details: { recoveryAttempt: 1, recoveryBudget: 1, userTurnDelta: 0, assistantTurnDelta: 0, generationRequestObserved: false, token: "[REDACTED]" } });
    const revived = transport.reviveStructuredError(dto);
    expect(revived).toMatchObject({ code: dto.code, firstDivergence: dto.firstDivergence, cause: dto.cause, details: dto.details });
    expect(revived.message).toBe(sourceError.message);
  });

  it("uses the DTO only for Content Project IPC and rethrows it in the renderer", () => {
    expect(mainSource).toContain('return { ok: true, data };');
    expect(mainSource).toContain('return { ok: false, error: serializeGeminiError(error) };');
    expect(preloadSource).toContain('invokeStructured("gemini-browser:develop-project"');
    const dashboardSource = fs.readFileSync(path.resolve(__dirname, "../src/components/viral-dashboard.tsx"), "utf8");
    const createStart = dashboardSource.indexOf("async function createContentProject");
    const catchStart = dashboardSource.indexOf("    } catch (caught) {", createStart);
    const finallyStart = dashboardSource.indexOf("    } finally {", catchStart);
    const catchBlock = dashboardSource.slice(catchStart, finallyStart);
    expect(catchBlock).toContain("throw propagatedError;");
    expect(catchBlock).not.toContain("return null;");
    expect(dashboardSource).toContain('if (!project) throw new Error("Không tạo được Content Project và phân cảnh.");');
  });

  it("preserves structured Flow provider blockers through direct video IPC", () => {
    const flowError = new Error("FLOW_PROVIDER_UNUSUAL_ACTIVITY: blocked");
    Object.assign(flowError, {
      code: "FLOW_PROVIDER_UNUSUAL_ACTIVITY",
      firstDivergence: "FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK",
      details: {
        stage: "STAGE_4_VIDEO_GENERATION",
        sceneId: "scene-1",
        generateTriggered: true,
        generationStarted: false,
        providerJobCreated: false,
        autoRetryAllowed: false,
        token: "must-not-cross",
      },
    });
    const dto = transport.serializeGeminiError(flowError);
    expect(dto).toMatchObject({ code: "FLOW_PROVIDER_UNUSUAL_ACTIVITY", firstDivergence: "FLOW_VIDEO_PROVIDER_UNUSUAL_ACTIVITY_BLOCK", details: { stage: "STAGE_4_VIDEO_GENERATION", sceneId: "scene-1", generateTriggered: true, generationStarted: false, providerJobCreated: false, autoRetryAllowed: false, token: "[REDACTED]" } });
    expect(mainSource).toContain('return { ok: true, data: result };');
    expect(mainSource).toContain('return { ok: false, error: serializeGeminiError(error) };');
    expect(preloadSource).toContain('invokeStructured("gemini-browser:run-video-job"');
    expect(preloadSource).toContain('invokeStructured("gemini-browser:run-video-job", { projectId, channelId, slots })');
  });
});

describe("ISSUE-006 app-owned Gemini conversation replacement", () => {
  it("classifies a saved conversation redirect as stale before any send recovery", () => {
    expect(mainSource).toContain('error.code = "GEMINI_CONVERSATION_STALE"');
    expect(mainSource).toContain('error.firstDivergence = "GEMINI_CONVERSATION_STALE"');
    expect(mainSource).toContain('if (binding.geminiConversationState === "DELETED")');
    expect(mainSource).toContain("await openNewGeminiConversation(window, runId, stage);");
    expect(mainSource).not.toContain('GEMINI_CONVERSATION_STALE\";\n      await recoverGeminiConversationForSend');
  });

  it("opens New Chat through a Gemini same-origin UI control and permits a null pre-send ID", () => {
    expect(mainSource).toContain("GEMINI_NEW_CHAT_CONTROL_NOT_FOUND");
    expect(mainSource).toContain("GEMINI_NEW_CHAT_NOT_READY");
    expect(mainSource).toContain('conversationId: null, state: "UNBOUND"');
    expect(mainSource).toContain("getGeminiRuntimeConversationForRun");
  });

  it("requires the saved conversation route to remain stable before send", () => {
    const identityStart = mainSource.indexOf("async function waitForGeminiConversationIdentity");
    const prepareStart = mainSource.indexOf("async function prepareGeminiConversationForCommand", identityStart);
    const identityBlock = mainSource.slice(identityStart, prepareStart);
    expect(identityBlock).toContain("let verifiedBinding = null;");
    expect(identityBlock).toContain("if (isBareGeminiAppUrl(observedUrl))");
    expect(identityBlock).toContain("GEMINI_CONVERSATION_STALE");
    expect(identityBlock).toContain("Date.now() - startedAt >= GEMINI_CONVERSATION_REOPEN_STABILIZATION_MS");
    expect(identityBlock).toContain('stabilizationBoundary: "FINAL_VERIFIED_OBSERVATION"');
  });

  it("does not persist an unconfirmed bare-app replacement", () => {
    const prepareStart = mainSource.indexOf("async function prepareGeminiConversationForCommand");
    const identityStart = mainSource.indexOf("async function waitForGeminiConversationIdentity", prepareStart);
    const prepareBlock = mainSource.slice(prepareStart, identityStart);
    expect(prepareBlock).toContain("await preflightGeminiForRun(window, runId, stage);");
    expect(prepareBlock).toContain("return binding;");
    expect(prepareBlock).not.toContain("return waitForGeminiConversationIdentity(window, binding, runId, binding.geminiConversationUrl);");
    expect(prepareBlock).not.toContain("persistGeminiConversationCheckpoint(runId");
    expect(mainSource).toContain("bindConversationFromUrl(current, runId, actualUrl");
  });

  it("keeps the arbitrary-history fallback forbidden", () => {
    expect(mainSource).toContain("const candidate = candidates.find(isNewChat);");
    expect(mainSource).not.toContain("first conversation in history");
    expect(mainSource).not.toContain("280d4b6fd5590bf8");
  });
});

describe("MODEL-CHARACTER reference binding", () => {
  it("uploads and confirms the channel character reference before Stage-2 modeling prompts", () => {
    expect(mainSource).toContain("async function attachGeminiModelingCharacterReference(window, channelId, stage)");
    expect(mainSource).toContain('error.code = "MODELING_CHARACTER_REFERENCE_MISSING"');
    expect(mainSource).toContain('error.code = "MODELING_CHARACTER_REFERENCE_NOT_CONFIRMED"');
    expect(mainSource).toContain('recordBrowserAction({ action: "gemini-modeling-character-reference-upload"');
    expect(mainSource).toMatch(/attachGeminiModelingCharacterReference\(window,\s*payload\.channelId\s*\|\|[^;]+?,\s*"MODELING_IDEA"\)/);
    expect(mainSource).toMatch(/attachGeminiModelingCharacterReference\(window,\s*payload\.channelId\s*\|\|[^;]+?,\s*"CONTENT_PROJECT"\)/);
    expect(mainSource).toContain("characterReferenceInstruction");
  });

  it("uploads the canonical character reference before every Gemini scene start-frame image", () => {
    expect(mainSource).toContain('if (slots.some((slot) => slot?.kind === "scene") && !characterReferencePath)');
    expect(mainSource).toMatch(/if \(slot\.kind === "scene"\) \{\s*await attachGeminiModelingCharacterReference\(window, channelId, "IMAGE_SCENE_START_FRAME"\);/);
    expect(mainSource).toContain('stage, filename: path.basename(characterReferencePath), preview: evidence');
  });
});

describe("shared Gemini conversation across automation Stages 1-3", () => {
  it("keeps Modeling Idea, Content Project, and Image generation on the same run-bound conversation", () => {
    expect(mainSource).toContain('await preflightGeminiForRun(window, payload.runId, "MODELING_IDEA")');
    expect(mainSource).toContain('await preflightGeminiForRun(window, payload.runId, "CONTENT_PROJECT")');
    expect(mainSource).toContain('const geminiRunId = value?.runId || null;');
    expect(mainSource).toContain('const imageConversationBinding = await preflightGeminiForRun(window, geminiRunId, "IMAGE");');
    expect(mainSource).toContain('await reloadGeminiBeforeNextPrompt(window, imageConversationBinding, geminiRunId, "IMAGE");');
    expect(mainSource).toContain('GEMINI_SHARED_CONVERSATION_MISMATCH');
  });

  it("does not accept a different Gemini conversation after an Image-stage reload", () => {
    const reloadStart = mainSource.indexOf("async function reloadGeminiBeforeNextPrompt");
    const saveStart = mainSource.indexOf("function saveGeminiImage", reloadStart);
    const reloadBlock = mainSource.slice(reloadStart, saveStart);
    expect(reloadBlock).toContain("assertConversationReady(expectedConversationBinding, runId, observedUrl)");
    expect(reloadBlock).toContain('result: "FAIL"');
    expect(reloadBlock).toContain("GEMINI_SHARED_CONVERSATION_MISMATCH");
  });

  it("does not mistake uploaded-image preview controls for the Gemini image-generation tool", () => {
    const start = mainSource.indexOf("async function waitForGeminiToolPoint");
    const end = mainSource.indexOf("function saveGeminiVideo", start);
    const toolSelectionBlock = mainSource.slice(start, end);
    expect(toolSelectionBlock).toContain("isImagePreviewOrUploadControl");
    expect(toolSelectionBlock).toContain("hiển thị hình ảnh đã tải lên");
    expect(toolSelectionBlock).toContain("chia sẻ hình ảnh");
    expect(toolSelectionBlock).toContain("if (candidate.excluded) return false;");
  });
});

describe("ISSUE-015 Flow image download through managed Edge", () => {
  it("retries authenticated page fetch before using the CDP response-body fallback", () => {
    const start = mainSource.indexOf("async function getFlowImageBuffer");
    const end = mainSource.indexOf("async function waitForFlowImageWithRecovery", start);
    const imageDownloadBlock = mainSource.slice(start, end);
    expect(mainSource).toContain("async function readFlowMediaDataThroughPage");
    expect(mainSource).toContain("async function listFlowImageSources");
    expect(mainSource).toContain("async function readFlowMediaDataThroughPageOnce");
    expect(mainSource).toContain("async function readFlowImageDataFromCandidates");
    expect(mainSource).toContain("const observedSources = await listFlowImageSources(window)");
    expect(mainSource).toContain('source.startsWith("https://flow-content.google/image/")');
    expect(mainSource).toContain('source.startsWith("https://flow.google.com/asb/")');
    expect(mainSource).toContain("flow-image-download-candidates");
    expect(mainSource).toContain("flow-image-page-fetch-success");
    expect(mainSource).toContain("for (let attempt = 0; attempt < 8; attempt += 1)");
    expect(mainSource).toContain("AbortController");
    expect(mainSource).toContain('readFlowMediaDataThroughPageOnce(window, candidateSource, "image")');
    expect(imageDownloadBlock).toContain('readFlowMediaBufferThroughCdp(window, candidateSource, "image")');
    expect(imageDownloadBlock).toContain('if (cdpBuffer) return { buffer: cdpBuffer, mimeType: detectFlowImageMimeType(cdpBuffer) };');
    expect(imageDownloadBlock).toContain("postReloadPageMedia");
    expect(imageDownloadBlock).toContain("flow-image-post-cdp-page-fetch-success");
    expect(imageDownloadBlock).toContain('throw new Error("Google Flow không cho phép tải ảnh vừa tạo qua Edge/CDP.")');
    expect(mainSource).toContain('Network.setCacheDisabled", { cacheDisabled: true }');
    expect(mainSource).toContain('Page.reload", { ignoreCache: true }');
    expect(mainSource).toContain('const pattern = `${expectedPath}*`;');
    expect(mainSource).toContain("asb");
  });

  it("targets the explicit Flow Mode toggle and reopens settings before failing", () => {
    expect(mainSource).toContain('flow-toggles[aria-label="Mode"]');
    expect(mainSource).toContain('button[aria-label="Settings trigger"]');
    expect(mainSource).toContain("flow-mode-control-missing");
    expect(mainSource).toContain("reopenAttempts < 2");
  });
});
