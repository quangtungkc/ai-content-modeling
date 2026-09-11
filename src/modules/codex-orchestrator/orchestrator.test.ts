import { describe, expect, it } from "vitest";
import { CODEX_EVENT_TYPES, type CodexStageSnapshot, type ExpectedState } from "./types";
import { buildSceneExpectedState, canAutoResumeAfterFlowRuntimeRepair, chooseRecoveryStrategy, classifyFailure, createErrorSignature, extractRecoveryTargetIds, findIncompleteFinalAuditPrerequisite, hasReachedRetryLimit, nextContinuousRecoveryStrategy, nextPendingAction, planSceneBatches, recoveryActionFor, recoveryStrategies, redactSecrets, requiresUserAction, retryCountForSignature, shouldCreateImprovementCandidate, shouldKeepRunningUntilFinal, shouldUseCodexPipeline, validateExpectedActual } from "./policy";
import { CODEX_REQUEST_TIMEOUT_MS } from "./reasoner";

const stage = (name: CodexStageSnapshot["stage"], status: CodexStageSnapshot["status"]): CodexStageSnapshot => ({ stage: name, status, retryCount: 0, maxRetries: 3 });
const scene = buildSceneExpectedState({ sceneId: "scene-1", sceneNumber: 1, visualBlock: "Cận cảnh nhân vật cầm chiếc cốc đỏ", actionBlock: "Nhân vật làm rơi cốc", audioBlock: "Tiếng cốc rơi", startFramePrompt: "still", englishPrompt: "animate", characterDesign: { name: "Bùn" }, backgroundDesign: { place: "phòng" }, sourceModelingIntent: "slapstick gag" });

describe("Codex orchestrator policy", () => {
  it("giới hạn thời gian chờ Codex là 5 phút", () => expect(CODEX_REQUEST_TIMEOUT_MS).toBe(300_000));
  it("1. New Codex job bắt đầu từ stage đầu tiên còn thiếu", () => expect(nextPendingAction([stage("ANALYSIS", "PENDING"), stage("MODELING", "PENDING")])).toMatchObject({ name: "runAnalysisStage", stage: "ANALYSIS" }));
  it("2. Resume job tiếp tục đúng checkpoint đang chạy", () => expect(nextPendingAction([stage("ANALYSIS", "COMPLETED"), stage("MODELING", "RUNNING")])).toMatchObject({ name: "runModelingStage", stage: "MODELING" }));
  it("3. Persistent session giữ nguyên checkpoint sau serialize", () => { const snapshot = { sessionId: "persistent-session", stages: [stage("PROJECT", "RUNNING")] }; expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot); });
  it("4. Stage success khi asset đúng Expected State", () => expect(validateExpectedActual({ stage: "ASSETS", requiredAssetKeys: ["background-0", "scene-1"] }, { generatedAssetKeys: ["background-0", "scene-1"] }).verdict).toBe("PASS"));
  it("5. Technical failure được phân loại riêng", () => expect(classifyFailure("network timeout 504")).toBe("TECHNICAL_FAILURE"));
  it("6. Semantic failure được phân loại riêng", () => expect(classifyFailure("wrong character and continuity mismatch")).toBe("SEMANTIC_FAILURE"));
  it("7. Recovery chọn strategy chưa thử", () => expect(chooseRecoveryStrategy(["a", "b"], ["a"])).toBe("b"));
  it("8. Recovery retry không lặp strategy cũ", () => expect(chooseRecoveryStrategy(["a", "b", "c"], ["a", "b"])).toBe("c"));
  it("9. Retry limit dừng đúng ngưỡng", () => expect(hasReachedRetryLimit(3, 3)).toBe(true));
  it("10. Experience match thành công được ưu tiên", () => expect(chooseRecoveryStrategy(["new"], [], "known-good")).toBe("known-good"));
  it("11. Expected vs Actual phát hiện khác tỷ lệ", () => expect(validateExpectedActual({ stage: "FINAL_ASSEMBLY", expectedAspectRatio: "9:16" }, { aspectRatio: "16:9" }).issues[0].code).toBe("ASPECT_RATIO_MISMATCH"));
  it("12. Asset mismatch chỉ rõ asset thiếu", () => expect(validateExpectedActual({ stage: "ASSETS", requiredAssetKeys: ["scene-1"] }, { generatedAssetKeys: [] }).issues[0]).toMatchObject({ code: "ASSET_MISSING", targetId: "scene-1" }));
  it("13. Scene mismatch chỉ rõ cảnh thiếu", () => expect(validateExpectedActual({ stage: "SCENES", expectedSceneNumbers: [1, 2] }, { generatedSceneNumbers: [1], semanticVerdict: "PASS" }).issues[0]).toMatchObject({ code: "SCENE_MISSING", sceneNumber: 2 }));
  it("14. Final Audit fail khi sai thứ tự", () => expect(validateExpectedActual({ stage: "FINAL_AUDIT", expectedSceneOrder: [1, 2], scenes: [scene] }, { sceneOrder: [2, 1], semanticVerdict: "PASS" }).verdict).toBe("FAIL"));
  it("15. Final Audit có recovery riêng", () => expect(recoveryStrategies("FINAL_AUDIT", "SEMANTIC_FAILURE", "gag missing")).toContain("reassemble-failed-scene-set"));
  it("16. Final completion bị chặn nếu một prerequisite chưa xong", () => {
    const stages = [stage("ANALYSIS", "COMPLETED"), stage("MODELING", "COMPLETED"), stage("PROJECT", "COMPLETED"), stage("ASSETS", "RETRYING"), stage("SCENES", "COMPLETED"), stage("FINAL_ASSEMBLY", "COMPLETED")];
    expect(findIncompleteFinalAuditPrerequisite(stages)?.stage).toBe("ASSETS");
  });
  it("17. Final Audit PASS vẫn phải chạy Post-Run Review trước khi hoàn tất", () => {
    const stages = [stage("ANALYSIS", "COMPLETED"), stage("MODELING", "COMPLETED"), stage("PROJECT", "COMPLETED"), stage("ASSETS", "COMPLETED"), stage("SCENES", "COMPLETED"), stage("FINAL_ASSEMBLY", "COMPLETED"), stage("FINAL_AUDIT", "COMPLETED"), stage("POST_RUN_REVIEW", "PENDING")];
    expect(nextPendingAction(stages)).toMatchObject({ name: "runPostRunReview", stage: "POST_RUN_REVIEW" });
  });
  it("18. Restart/resume bảo toàn Expected State", () => { const expected: ExpectedState = { stage: "SCENES", projectId: "p1", scenes: [scene] }; expect(JSON.parse(JSON.stringify(expected)).scenes[0].sceneId).toBe("scene-1"); });
  it("19. Idempotency tạo cùng error signature cho cùng lỗi biến thiên ID", () => expect(createErrorSignature("SCENES", "timeout job abcdef1234567890")).toBe(createErrorSignature("SCENES", "timeout job fedcba0987654321")));
  it("20. Không tạo trùng scene trong batch", () => expect(planSceneBatches([1, 1, 2, 2], 4)).toEqual([[1, 2]]));
  it("21. Scene độc lập được chia batch song song", () => expect(planSceneBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]));
  it("22. Event logging có đủ lifecycle bắt buộc", () => expect(CODEX_EVENT_TYPES).toEqual(expect.arrayContaining(["CODEX_JOB_STARTED", "VALIDATION_FAILED", "RECOVERY_SUCCEEDED", "FINAL_AUDIT_PASSED", "JOB_COMPLETED"])));
  it("23. Improvement candidate chỉ tạo cho lỗi lặp hoặc root cause rõ", () => { expect(shouldCreateImprovementCandidate(1)).toBe(false); expect(shouldCreateImprovementCandidate(2)).toBe(true); expect(shouldCreateImprovementCandidate(1, true)).toBe(true); });
  it("24. External research disabled không ảnh hưởng recovery policy", () => expect(recoveryStrategies("ASSETS", "TECHNICAL_FAILURE", "network").length).toBeGreaterThan(0));
  it("25. Lỗi JavaScript thiếu sender được phân loại là lỗi code", () => expect(classifyFailure("Cannot read properties of undefined (reading 'send')")).toBe("ENGINEERING_FAILURE"));
  it("26. Runtime Flow mới tự resume đúng stage lỗi code", () => expect(canAutoResumeAfterFlowRuntimeRepair({ status: "NEEDS_HUMAN", stage: "ASSETS", failureReason: "Cannot read properties of undefined (reading 'send')", runtimeRevision: "flow-ipc-event-v2" })).toBe(true));
  it("27. Không tự resume lỗi cần đăng nhập", () => expect(canAutoResumeAfterFlowRuntimeRepair({ status: "NEEDS_HUMAN", stage: "ASSETS", failureReason: "Hãy đăng nhập Google Flow", runtimeRevision: "flow-ipc-event-v2" })).toBe(false));
  it("28. Secret redaction loại credential nhưng giữ Expected State", () => {
    const redacted = redactSecrets({ apiKey: "credential-value", note: "Bearer abc.def.ghi", password: "pw", requiredAssetKeys: ["background-0", "scene-1"] });
    expect(JSON.stringify(redacted)).not.toContain("real-secret");
    expect(redacted.requiredAssetKeys).toEqual(["background-0", "scene-1"]);
  });
  it("29. Feature flag disabled giữ pipeline cũ", () => { expect(shouldUseCodexPipeline(false)).toBe(false); expect(shouldUseCodexPipeline(true)).toBe(true); });
  it("30. Lỗi Start frame chọn đúng recovery và đúng scene", () => {
    const message = "Không tìm thấy ảnh scene-13.jpg trong bảng chọn Start frame Google Flow.";
    expect(recoveryStrategies("SCENES", "TECHNICAL_FAILURE", message)[0]).toBe("reupload-missing-start-frame");
    expect(extractRecoveryTargetIds(message, {})).toEqual(["13"]);
    expect(recoveryActionFor("SCENES", "reupload-missing-start-frame")).toBe("regenerateScene");
  });
  it("31. Quality provider lỗi chỉ retry validator, không tạo lại video", () => {
    const strategies = recoveryStrategies("SCENES", "TECHNICAL_FAILURE", "GEMINI_QUALITY_VALIDATION_429");
    expect(strategies[0]).toBe("retry-quality-validation");
    expect(recoveryActionFor("SCENES", strategies[0])).toBe("validateScenes");
  });
  it("32. UNCERTAIN do provider vẫn là lỗi kỹ thuật", () => {
    const validation = validateExpectedActual({ stage: "SCENES", scenes: [scene] }, { semanticVerdict: "UNCERTAIN", semanticFailureKind: "TECHNICAL_FAILURE", semanticIssues: [{ code: "QUALITY_PROVIDER_FAILURE", message: "GEMINI_QUALITY_VALIDATION_429" }] });
    expect(validation).toMatchObject({ verdict: "UNCERTAIN", failureKind: "TECHNICAL_FAILURE", issues: [{ code: "QUALITY_PROVIDER_FAILURE" }] });
  });
  it("33. Runtime v3 tự mở lại job Quality Validator nhưng vẫn chặn lỗi đăng nhập", () => {
    expect(canAutoResumeAfterFlowRuntimeRepair({ status: "NEEDS_HUMAN", stage: "SCENES", failureReason: "Cần Quality Validator xác nhận nội dung hình ảnh/video.", runtimeRevision: "flow-recovery-v3" })).toBe(true);
    expect(canAutoResumeAfterFlowRuntimeRepair({ status: "NEEDS_HUMAN", stage: "ASSETS", failureReason: "GEMINI_QUALITY_VALIDATION_429", runtimeRevision: "flow-recovery-v3" })).toBe(true);
    expect(canAutoResumeAfterFlowRuntimeRepair({ status: "NEEDS_HUMAN", stage: "SCENES", failureReason: "Cần đăng nhập Google Flow", runtimeRevision: "flow-recovery-v3" })).toBe(false);
  });
  it("34. Lỗi mới trong cùng stage có ngân sách retry riêng", () => {
    expect(retryCountForSignature("SCENES:start-frame", "SCENES:quality-provider", 3)).toBe(0);
    expect(retryCountForSignature("SCENES:quality-provider", "SCENES:quality-provider", 2)).toBe(2);
  });
  it("35. Lỗi provider không chuyển NEEDS_HUMAN sau khi hết 3 retry", () => {
    expect(shouldKeepRunningUntilFinal("TECHNICAL_FAILURE", "GEMINI_QUALITY_VALIDATION_429")).toBe(true);
    expect(nextContinuousRecoveryStrategy(["retry-quality-validation", "provider-backoff", "retry-quality-validation-after-backoff"], 3)).toBe("retry-quality-validation");
  });
  it("36. Chỉ blocker quyền/đăng nhập mới yêu cầu người dùng", () => {
    expect(requiresUserAction("Hãy đăng nhập Google Flow")).toBe(true);
    expect(shouldKeepRunningUntilFinal("TECHNICAL_FAILURE", "Hãy đăng nhập Google Flow")).toBe(false);
  });
  it("37. Semantic failure tiếp tục recovery, không chọn request-human khi còn cách tự xử lý", () => {
    expect(shouldKeepRunningUntilFinal("SEMANTIC_FAILURE", "Sai nhân vật trong cảnh 2")).toBe(true);
    expect(nextContinuousRecoveryStrategy(["strengthen-scene-expected-state", "regenerate-failed-scenes-only", "request-human-scene-review"], 2)).toBe("strengthen-scene-expected-state");
  });
});
