import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyFailure, recoveryStrategies } from "./policy";
import { createStallGuard, executeStage } from "./executor";
import * as ideas from "@/modules/ideas/service";
import * as approval from "@/modules/ideas/approval-service";
import { requestStage2GeminiBrowser } from "@/modules/generation/browser-flow-bridge";
import { LocalJobQueue } from "@/lib/jobs/queue";
import * as browserBridge from "@/modules/generation/browser-flow-bridge";
import { GeminiProvider } from "@/services/ai/gemini";
import { OpenAIProvider } from "@/services/ai/openai";
import { VeoProvider } from "@/services/video-generation/veo";
import { isAllowedRepairPath } from "./self-repair";
import { CODEX_EVENT_TYPES } from "./types";
import { extractRecoveryTargetIds } from "./policy";
import { parseRepairResponse } from "./quality-validator";
import { promoteImageCandidates, preserveImageCandidateBaseline } from "@/modules/assets/image-generation-service";
import * as files from "node:fs/promises";
import { db } from "@/lib/db";

vi.mock("node:fs/promises", async importOriginal => ({ ...await importOriginal<typeof files>() }));

describe("Codex background executor", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("Stage 2 worker dùng browser và chuyển binding run cho cả hai command", async () => {
    vi.spyOn(db.codexJob, "findUniqueOrThrow").mockResolvedValue({ sourceVideoId: "video", automationRunId: "run", checkpoint: { ideaId: "idea", settings: { artStyle: "3D", aspectRatio: "9:16" } } } as never);
    const apiIdea = vi.spyOn(ideas, "generateIdeasFromVideo");
    const apiDevelop = vi.spyOn(approval, "developApprovedIdea");
    const geminiIdea = vi.spyOn(GeminiProvider.prototype, "generateIdeas");
    const geminiDevelop = vi.spyOn(GeminiProvider.prototype, "developIdea");
    const openaiIdea = vi.spyOn(OpenAIProvider.prototype, "generateIdeas");
    const openaiDevelop = vi.spyOn(OpenAIProvider.prototype, "developIdea");
    const veo = vi.spyOn(VeoProvider.prototype, "generateScene");
    const browserIdea = vi.spyOn(ideas, "generateIdeasFromVideoBrowser").mockResolvedValue({ ideas: [{ id: "idea", title: "title" }] } as never);
    const browserDevelop = vi.spyOn(approval, "developApprovedIdeaBrowser").mockResolvedValue({ id: "project" } as never);
    vi.spyOn(approval, "setIdeaStatus").mockResolvedValue({} as never);
    expect(await executeStage("job", "user", { name: "runModelingStage", stage: "MODELING" } as never, async () => {})).toEqual({ ideaId: "idea", title: "title" });
    expect(await executeStage("job", "user", { name: "runProjectDevelopmentStage", stage: "PROJECT" } as never, async () => {})).toEqual({ projectId: "project" });
    expect(browserIdea).toHaveBeenCalledWith("video", "user", "3D", "run", expect.objectContaining({ codexJobId: "job", onProgress: expect.any(Function) }));
    expect(browserDevelop).toHaveBeenCalledWith("idea", "user", "9:16", "run", expect.objectContaining({ codexJobId: "job", onProgress: expect.any(Function) }));
    expect(apiIdea).not.toHaveBeenCalled();
    expect(apiDevelop).not.toHaveBeenCalled();
    for (const provider of [geminiIdea, geminiDevelop, openaiIdea, openaiDevelop, veo]) expect(provider).not.toHaveBeenCalled();
  });

  it.each(["browser failure", "timeout", "malformed JSON"])("Stage 2 dừng khi %s, không fallback API", async message => {
    vi.spyOn(db.codexJob, "findUniqueOrThrow").mockResolvedValue({ sourceVideoId: "video", automationRunId: "run", checkpoint: {} } as never);
    vi.spyOn(ideas, "generateIdeasFromVideoBrowser").mockRejectedValue(new Error(message));
    const api = vi.spyOn(ideas, "generateIdeasFromVideo");
    await expect(executeStage("job", "user", { name: "runModelingStage", stage: "MODELING" } as never, async () => {})).rejects.toThrow(message);
    expect(api).not.toHaveBeenCalled();
  });

  it.each(["MODELING_IDEA", "CONTENT_PROJECT_DEVELOP"] as const)("%s dùng persisted bridge với run binding", async purpose => {
    const enqueue = vi.spyOn(LocalJobQueue.prototype, "enqueue").mockResolvedValue({ jobId: "bridge" } as never);
    vi.spyOn(db.backgroundJob, "findUnique").mockResolvedValue({ status: "succeeded", payload: { bridgeResult: { schemaVersion: "1.0" } } } as never);
    expect(await requestStage2GeminiBrowser({ userId: "user", channelId: "channel", runId: "run", purpose, video: { id: "video" }, analysis: {}, channelDNA: {} })).toEqual({ schemaVersion: "1.0" });
    expect(enqueue).toHaveBeenCalledWith("desktop.flow.quality", expect.objectContaining({ purpose, stage: "STAGE2", runId: "run" }), expect.any(String));
  });

  it("idea browser lưu đúng schema và không gọi provider", async () => {
    const evidenceText = "Quan sát trực tiếp từ tệp video nguồn cho thấy diễn biến và nhịp hành động này.";
    const analysis = { schemaVersion: "1.0", summary: evidenceText, hook: evidenceText, setup: evidenceText, conflict: evidenceText, escalation: evidenceText, twist: evidenceText, payoff: evidenceText, theGag: evidenceText, cameraPattern: evidenceText, editingRhythm: evidenceText, soundPattern: evidenceText, retentionMechanism: evidenceText, characterInteractions: [evidenceText], whyItWorks: [evidenceText], analysisEvidence: { sourceVideoAttached: true, observationMethod: "attached-video-file", observedDurationSec: 4 } };
    const direction = { title: "title", coreConcept: "concept", script: "script", characterDesign: "design", setting: "setting", artStyle: "3D", sourceMechanism: "mechanism", whatIsPreserved: ["order"], whatIsChanged: ["Bối cảnh/môi trường", "Nhân vật chính theo ảnh tham chiếu", "Phong cách mỹ thuật"], targetMarketAdaptation: "market", similarityRisk: "low", whyWorthDeveloping: "reason", postText: "caption" };
    vi.spyOn(db.competitorVideo, "findFirst").mockResolvedValue({ id: "video", url: "https://example.com", analyses: [{ id: "analysis", version: 1, content: analysis }], competitor: { channel: { id: "channel" } } } as never);
    const request = vi.spyOn(browserBridge, "requestStage2GeminiBrowser").mockResolvedValue({ schemaVersion: "1.0", modelingDirections: [direction] });
    const create = vi.spyOn(db.modelingIdea, "create").mockResolvedValue({ id: "idea", content: direction } as never);
    vi.spyOn(db, "$transaction").mockImplementation(async values => Promise.all(values as never) as never);
    const gemini = vi.spyOn(GeminiProvider.prototype, "generateIdeas");
    const openai = vi.spyOn(OpenAIProvider.prototype, "generateIdeas");
    const result = await ideas.generateIdeasFromVideoBrowser("video", "user", "3D", "run");
    expect(result.analysisId).toBe("analysis");
    expect(result.ideas[0].id).toBe("idea");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ analysisId: "analysis", sourceVideoId: "video", content: direction }) }));
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ runId: "run", purpose: "MODELING_IDEA" }), undefined);
    expect(gemini).not.toHaveBeenCalled();
    expect(openai).not.toHaveBeenCalled();
  });

  it("develop resume reuse project đã lưu mà không gọi browser/API", async () => {
    vi.spyOn(db.modelingIdea, "findFirst").mockResolvedValue({ id: "idea", status: "APPROVED" } as never);
    vi.spyOn(db.contentProject, "findUnique").mockResolvedValue({ id: "existing" } as never);
    const request = vi.spyOn(browserBridge, "requestStage2GeminiBrowser");
    const api = vi.spyOn(GeminiProvider.prototype, "developIdea");
    expect(await approval.developApprovedIdeaBrowser("idea", "user", "9:16", "run")).toEqual({ id: "existing" });
    expect(request).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });

  it("bridge failure terminal không được trở thành kết quả Stage 2", async () => {
    vi.spyOn(LocalJobQueue.prototype, "enqueue").mockResolvedValue({ jobId: "bridge" } as never);
    vi.spyOn(db.backgroundJob, "findUnique").mockResolvedValue({ status: "failed", error: "GEMINI_BROWSER_FAILURE" } as never);
    await expect(requestStage2GeminiBrowser({ userId: "user", channelId: "channel", runId: "run", purpose: "MODELING_IDEA", video: {}, analysis: {}, channelDNA: {} })).rejects.toThrow("GEMINI_BROWSER_FAILURE");
  });

  it("chỉ chọn những cảnh có lỗi semantic cụ thể, kể cả cảnh nối bị ảnh hưởng", () => {
    expect(extractRecoveryTargetIds("identity mismatch", { semanticIssues: [{ sceneNumber: 3 }, { sceneNumber: 4 }, { sceneNumber: 3 }] })).toEqual(["3", "4"]);
    expect(extractRecoveryTargetIds("GEMINI_QUALITY_VALIDATION_429", { semanticIssues: [{ code: "QUALITY_PROVIDER_FAILURE" }] })).toEqual([]);
  });

  it.each(["FAIL", "UNCERTAIN"])("không duyệt ảnh khi ảnh/nối cảnh trả %s", async verdict => {
    vi.spyOn(db.contentProject, "findFirst").mockResolvedValue({ id: "project" } as never);
    await expect(promoteImageCandidates("project", "user", "11111111-1111-4111-8111-111111111111", [3], { verdict })).rejects.toMatchObject({ code: "IMAGE_NOT_APPROVED" });
  });

  it("giữ ảnh ứng viên của vòng trước trong vùng ứng viên, không ghi đè khi resume", async () => {
    vi.spyOn(db.contentProject, "findFirst").mockResolvedValue({ id: "project" } as never);
    vi.spyOn(files, "mkdir").mockResolvedValue(undefined);
    const previous = "11111111-1111-4111-8111-111111111111";
    const current = "22222222-2222-4222-8222-222222222222";
    let copied = false;
    vi.spyOn(files, "stat").mockImplementation(async target => {
      const value = String(target);
      if (value.endsWith("scene-1.jpg") && (value.includes(previous) || (copied && value.includes(current)))) return { size: 2048 } as never;
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    const copy = vi.spyOn(files, "copyFile").mockImplementation(async () => { copied = true; });
    expect(await preserveImageCandidateBaseline("project", "user", current, previous, [1, 2])).toEqual([1]);
    expect(await preserveImageCandidateBaseline("project", "user", current, previous, [1, 2])).toEqual([1]);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(String(copy.mock.calls[0][0])).toContain(previous);
    expect(String(copy.mock.calls[0][1])).toContain(current);
    expect(String(copy.mock.calls[0][1])).toContain("candidates");
  });

  it("bắt thiếu/trùng scene trong repair response và nhận mapping sceneId", () => {
    const requested = [{ sceneId: "scene-03", sceneNumber: 3 }, { sceneId: "scene-05", sceneNumber: 5 }];
    expect(parseRepairResponse({ repairs: [
      { sceneId: "scene-03", repairedPrompt: "prompt 3" },
      { sceneId: "scene-05", repairedPrompt: "prompt 5" },
    ] }, requested)).toEqual([{ sceneNumber: 3, prompt: "prompt 3" }, { sceneNumber: 5, prompt: "prompt 5" }]);
    expect(() => parseRepairResponse({ repairs: [{ sceneId: "scene-03", repairedPrompt: "prompt 3" }, { sceneId: "scene-03", repairedPrompt: "prompt 3b" }] }, requested)).toThrow("GEMINI_REPAIR_PROMPT_MISSING_OR_DUPLICATE");
    expect(() => parseRepairResponse({ repairs: [{ sceneId: "scene-03", repairedPrompt: "prompt 3" }, { sceneId: "scene-99", repairedPrompt: "prompt 99" }] }, requested)).toThrow("GEMINI_REPAIR_PROMPT_INVALID_MAPPING");
  });

  it("đánh thức recovery khi stage không có tiến triển quá 5 phút", async () => {
    vi.useFakeTimers();
    const onStalled = vi.fn();
    const guard = createStallGuard(300_000, onStalled);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(onStalled).toHaveBeenCalledTimes(1);
    guard.stop();
  });

  it("heartbeat đặt lại đồng hồ đứng", async () => {
    vi.useFakeTimers();
    const onStalled = vi.fn();
    const guard = createStallGuard(300_000, onStalled);
    await vi.advanceTimersByTimeAsync(240_000);
    guard.touch();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(onStalled).not.toHaveBeenCalled();
    guard.stop();
  });

  it("phân loại lỗi parser/schema là lỗi kỹ thuật và chọn retry tự động", () => {
    const message = "OpenAI trả về invalid_type expected string received undefined trong storyboard";
    expect(classifyFailure(message)).toBe("TECHNICAL_FAILURE");
    expect(recoveryStrategies("PROJECT", "TECHNICAL_FAILURE", message)).toEqual(["retry-structured-output", "switch-ai-provider", "resume-from-checkpoint"]);
    expect(classifyFailure("TypeError: Cannot read properties of undefined")).toBe("ENGINEERING_FAILURE");
  });

  it("chặn patch vào cấu hình nhạy cảm và chỉ cho phép module liên quan", () => {
    const roots = ["src/services/ai"];
    expect(isAllowedRepairPath("src/services/ai/openai.ts", roots)).toBe(true);
    expect(isAllowedRepairPath("src/services/ai/openai.test.ts", roots)).toBe(true);
    expect(isAllowedRepairPath(".env", roots)).toBe(false);
    expect(isAllowedRepairPath("prisma/schema.prisma", roots)).toBe(false);
    expect(isAllowedRepairPath("src/modules/auth/service.ts", roots)).toBe(false);
  });

  it("có event tiến độ, engineering và kết quả tự sửa", () => {
    expect(CODEX_EVENT_TYPES).toEqual(expect.arrayContaining(["STAGE_PROGRESS", "JOB_NEEDS_ENGINEERING", "ENGINEERING_REPAIR_STARTED", "ENGINEERING_REPAIR_SUCCEEDED", "ENGINEERING_REPAIR_FAILED"]));
  });
});
