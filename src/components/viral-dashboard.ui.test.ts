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
    expect(source).toContain("await generateAllProjectImages(project)");
    expect(source).toContain("await generateAllProjectVideos(project, images)");
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
});
