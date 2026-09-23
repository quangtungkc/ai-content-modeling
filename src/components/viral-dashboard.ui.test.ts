import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(process.cwd(), "src/components/viral-dashboard.tsx"), "utf8");

describe("Video Modeling automatic-only UI", () => {
  it("CASE 1: exposes one automatic generation button", () => {
    expect(source).toContain("Chạy tự động đến khi video hoàn chỉnh");
    expect(source.match(/onClick=\{\(\) => void runAutomaticPipeline\(\)\}/g)?.length).toBe(1);
  });

  it("CASE 2: removes the manual run button", () => {
    expect(source).not.toContain("onClick={() => { setExecutionMode(\"manual\")");
    expect(source).not.toContain(">Chạy thủ công</button>");
  });

  it("CASE 3: removes Run with Codex from the modeling controls", () => {
    expect(source).not.toContain("onClick={() => void runWithCodex()}");
    expect(source).not.toContain(">Run with Codex</button>");
  });

  it("CASE 4: removes the per-stage Modeling Idea action", () => {
    expect(source).not.toContain("onClick={() => void generateModelingIdea()}");
  });

  it("CASE 5: removes the per-stage Content Project action", () => {
    expect(source).not.toContain("onClick={() => void createContentProject()}");
  });

  it("CASE 6: removes image, video and manual Flow actions", () => {
    expect(source).not.toContain("onClick={() => void generateAllProjectImages()}");
    expect(source).not.toContain("onClick={() => void generateAllProjectVideos()}");
    expect(source).not.toContain("onClick={() => void resumeManualFlowSubmission(scene.sceneNumber)}");
    expect(source).not.toContain("onClick={() => void prepareManualFlowSubmission(scene.sceneNumber)}");
  });

  it("CASE 7: keeps the automatic double-run guard and disabled state", () => {
    expect(source).toContain("if (!analysisVideoId || isAutomaticRunning) return;");
    expect(source).toContain("disabled={isAutomaticRunning}");
  });

  it("CASE 8: keeps recovery status and incident visibility", () => {
    expect(source).toContain("contentProjectRecoveryStatus");
    expect(source).toContain("contentProjectIncidentId");
    expect(source).toContain("Đã kiểm tra Kho lỗi — cần xem xét");
  });

  it("CASE 9: keeps all automatic pipeline stages internally wired", () => {
    expect(source).toContain("await generateModelingIdea(runId)");
    expect(source).toContain("await createContentProject(currentIdea, true, runId)");
    expect(source).toContain("await generateAllProjectImages(project, undefined, generatedImages, runId)");
    expect(source).toContain("await generateAllProjectVideos(project, images, undefined, videos)");
    expect(source).toContain("await renderFinalProjectVideo(project, videos)");
  });

  it("CASE 10: keeps output viewing while hiding manual editor execution", () => {
    expect(source).toContain("<video controls");
    expect(source).toContain("false && showVideoEditor && <div");
    expect(source).not.toContain("onClick={() => showVideoEditor ? setShowVideoEditor(false) : openVideoEditor()}");
  });

  it("CASE 11: preserves source caption in the stage-2 Gemini payload", () => {
    expect(source).toContain("caption: sourceVideo.caption");
    expect(source).not.toContain("caption: sourceVideo.url, thumbnailUrl: sourceVideo.thumbnailUrl, publishedAt: sourceVideo.publishedAt },\n            analysisResult.analysis");
  });

  it("CASE 12: keeps one-button checkpoint resume and double-run lock", () => {
    expect(source).toContain("resumableDecision.status === \"RESUME\"");
    expect(source).toContain("Tiếp tục phiên chạy");
    expect(source).toContain("Phiên chạy đang hoạt động");
    expect(source).toContain("automaticRunLockRef.current");
    expect(source).toContain("prepareResumeSteps");
    expect(source).toContain("assertNoWrongStageRestart");
    expect(source).toContain('resumeTarget: "CONTENT_PROJECT_CREATION"');
    expect(source).toContain("incidentHistory");
    expect(source).toContain("if (resumedFromCheckpoint && !activeStep) return;");
    expect(source).toContain("resumeSelection.runId");
    expect(source).toContain("validationStopAfterStage");
  });

  it("CASE 13: clears historical run errors after Stage 2 succeeds", () => {
    expect(source.match(/error: null, lastCompletedStage: 2/g)?.length).toBe(2);
    expect(source.match(/failureFingerprint: null, attemptCount: runAttemptCount/g)?.length).toBe(3);
    expect(source.match(/incidentHistory, failureFingerprint: null, contentProjectId: project\.id/g)?.length).toBe(3);
  });

  it("CASE 14: resumes Stage 4 without re-running completed images and hydrates persisted media", () => {
    expect(source).toContain("const targetStage = resumedFromCheckpoint ? (resumeStage ?? 2) : 1;");
    expect(source).toContain("if (targetStage <= 3)");
    expect(source).toContain("loadPersistedProjectImages(project.id, project.scenes)");
    expect(source).toContain("if (targetStage <= 4)");
    expect(source).toContain("loadPersistedProjectVideos(project.id, project.scenes)");
  });

  it("CASE 15: preserves structured Flow failures instead of converting them to null", () => {
    const videoFunctionStart = source.indexOf("async function generateAllProjectVideos");
    const videoFunctionEnd = source.indexOf("async function loadPersistedProjectImages", videoFunctionStart);
    const videoFunction = source.slice(videoFunctionStart, videoFunctionEnd);
    expect(videoFunction).toContain("throw caught;");
    expect(videoFunction).not.toContain("setContentProjectError(caught instanceof Error ? caught.message : \"Không thể tạo video bằng Flow Veo 3.\");\n      return null;");
  });

  it("CASE 16: shows a non-retryable provider block with manual Flow and Resume actions", () => {
    expect(source).toContain("FLOW_PROVIDER_UNUSUAL_ACTIVITY");
    expect(source).toContain("Google Flow tạm chặn tạo video vì phát hiện hoạt động bất thường.");
    expect(source).toContain(">Mở Flow</button>");
    expect(source).toContain(">Resume</button>");
  });

  it("CASE 17: loads persisted videos and excludes completed scenes before Stage 4 generation", () => {
    expect(source).toContain("const persistedVideos = await loadPersistedProjectVideos(project.id, project.scenes);");
    expect(source).toContain("generateAllProjectVideos(project, images, undefined, videos)");
    expect(source).toContain("!existingVideos[`scene-${scene.sceneNumber}`]");
  });

  it("CASE 18: routes Stage 3 image generation through Gemini and reserves Flow for Stage 4 video generation", () => {
    const imageStart = source.indexOf("async function generateAllProjectImages");
    const imageEnd = source.indexOf("async function generateAllProjectVideos", imageStart);
    const imageFunction = source.slice(imageStart, imageEnd);
    expect(source).toContain("function buildGeminiImageSlots");
    expect(imageFunction).toContain("desktopGemini");
    expect(imageFunction).toContain("gemini.runJob(project.id, preparedSlots");
    expect(imageFunction).not.toContain("desktopFlow");
    expect(imageFunction).not.toContain("runImageJob(");
  });

  it("CASE 19: exposes selectable Flow and Gemini video providers", () => {
    expect(source).toContain('type VideoProvider = "flow" | "gemini"');
    expect(source).toContain('name="video-provider"');
    expect(source).toContain("Luồng 1 · Google Flow");
    expect(source).toContain("Luồng 2 · Gemini qua CDP");
  });

  it("CASE 20: routes the Gemini selection through the queued CDP path", () => {
    const videoStart = source.indexOf("async function generateAllProjectVideos");
    const videoEnd = source.indexOf("async function loadPersistedProjectImages", videoStart);
    const videoFunction = source.slice(videoStart, videoEnd);
    expect(videoFunction).toContain('provider: "gemini"');
    expect(videoFunction).toContain("status=1&queueJobId=");
    expect(videoFunction).toContain("Gemini qua CDP đang tạo video");
    expect(videoFunction).not.toContain("Gemini Veo API");
  });

  it("CASE 21: keeps provider selection disabled while a run is active", () => {
    expect(source).toContain("disabled={isAutomaticRunning || isGeneratingVideos}");
    expect(source).toContain("providerAtStart");
  });
});
