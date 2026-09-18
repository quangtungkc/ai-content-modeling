import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { qaIncidentReportSchema, incidentReportToMarkdown, type QaIncidentReport } from "./report";

export type QaIncidentReportPaths = { jsonReportPath: string; markdownReportPath: string };
export type ReportFileSystem = { mkdir: typeof mkdir; writeFile: typeof writeFile; readFile: typeof readFile; readdir: typeof readdir };

export function troubleshootingIncidentReportRoot() {
  return path.join(process.env.APPDATA ?? process.cwd(), "ai-content-modeling", "troubleshooting-incidents");
}

function safeSegment(value: string | null | undefined) {
  return (value ?? "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

function reportFileNames(report: QaIncidentReport) {
  const stem = `${safeSegment(report.projectId)}-${safeSegment(report.incidentId)}-qa-report`;
  return { json: `${stem}.json`, markdown: `${stem}.md` };
}

const defaultFileSystem: ReportFileSystem = { mkdir, writeFile, readFile, readdir };

export async function exportQaIncidentReport(reportInput: QaIncidentReport, options: { root?: string; fileSystem?: ReportFileSystem } = {}): Promise<QaIncidentReportPaths> {
  const report = qaIncidentReportSchema.parse(reportInput);
  const root = options.root ?? troubleshootingIncidentReportRoot();
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  await fileSystem.mkdir(root, { recursive: true });
  const names = reportFileNames(report);
  const jsonReportPath = path.join(root, names.json);
  const markdownReportPath = path.join(root, names.markdown);
  await fileSystem.writeFile(jsonReportPath, JSON.stringify(report, null, 2), "utf8");
  await fileSystem.writeFile(markdownReportPath, incidentReportToMarkdown(report), "utf8");
  return { jsonReportPath, markdownReportPath };
}

async function findReportPath(incidentId: string, extension: "json" | "md", root: string, fileSystem: ReportFileSystem) {
  const names = await fileSystem.readdir(root).catch(() => [] as string[]);
  const suffix = `-${safeSegment(incidentId)}-qa-report.${extension}`;
  const match = names.find((name) => name.endsWith(suffix));
  return match ? path.join(root, match) : null;
}

export async function getQaIncidentJsonPath(incidentId: string, root = troubleshootingIncidentReportRoot(), fileSystem: ReportFileSystem = defaultFileSystem) {
  return findReportPath(incidentId, "json", root, fileSystem);
}

export async function getQaIncidentMarkdownPath(incidentId: string, root = troubleshootingIncidentReportRoot(), fileSystem: ReportFileSystem = defaultFileSystem) {
  return findReportPath(incidentId, "md", root, fileSystem);
}

export async function getQaIncidentReport(incidentId: string, root = troubleshootingIncidentReportRoot(), fileSystem: ReportFileSystem = defaultFileSystem) {
  const reportPath = await getQaIncidentJsonPath(incidentId, root, fileSystem);
  if (!reportPath) throw new Error(`QA_INCIDENT_REPORT_NOT_FOUND:${incidentId}`);
  return qaIncidentReportSchema.parse(JSON.parse(await fileSystem.readFile(reportPath, "utf8")));
}

function handoffValue(value: unknown, max = 4_000) {
  const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const safe = raw.replace(/xóa toàn bộ|regenerate tất cả|reset project/gi, "[unsafe action omitted; require explicit evidence]");
  return safe.length <= max ? safe : `${safe.slice(0, max)}\n[TRUNCATED]`;
}

export function buildCodexHandoffText(reportInput: QaIncidentReport) {
  const report = qaIncidentReportSchema.parse(reportInput);
  return [
    "CODEX HANDOFF — POST-ASSEMBLY QA INCIDENT",
    "",
    "Đây là incident được tạo tự động từ app, không phải kết luận rằng video generation thất bại.",
    `Report version: ${report.reportVersion}`,
    `Disposition: ${report.disposition}`,
    `Incident: ${report.incidentId}`,
    `QA run: ${report.qaRunId ?? "UNKNOWN"}`,
    `Project: ${report.projectId ?? "UNKNOWN"}`,
    `Scene: ${report.sceneNumber ?? "UNKNOWN"}`,
    `Global timestamp: ${report.globalTimestamp ?? "UNKNOWN"}`,
    `Scene-local timestamp: ${report.sceneLocalTimestamp ?? "UNKNOWN"}`,
    `Final video: ${report.finalVideoPath ?? "UNKNOWN"}`,
    `Final video hash: ${report.finalVideoHash ?? "UNKNOWN"}`,
    `Final video version: ${report.finalVideoVersion ?? "UNKNOWN"}`,
    "",
    "VALIDATOR",
    `id=${report.validatorId ?? "UNKNOWN"}; status=${report.validatorStatus ?? "UNKNOWN"}; severity=${report.severity ?? "UNKNOWN"}; confidence=${report.confidence ?? "UNKNOWN"}`,
    "",
    "SYMPTOM",
    report.symptom,
    "",
    "EXPECTED",
    handoffValue(report.expected),
    "",
    "ACTUAL",
    handoffValue(report.actual),
    "",
    "EVIDENCE",
    report.evidence.length ? report.evidence.map((item) => `- ${item.kind} / ${item.source}: ${handoffValue(item.value, 1_500)}`).join("\n") : "- UNKNOWN",
    "",
    `SUGGESTED_FIRST_DIVERGENCE: ${report.suggestedFirstDivergence ?? "UNKNOWN"}`,
    `CONFIRMED_FIRST_DIVERGENCE: ${report.confirmedFirstDivergence ?? "UNKNOWN"}`,
    `MATCH_DECISION: ${report.matchDecision}`,
    `MATCHED_RULE_ID: ${report.matchedRuleId ?? "NONE"}`,
    `MATCH_CONFIDENCE: ${report.matchConfidence}`,
    `MATCHED_EVIDENCE: ${report.matchedEvidence.join(", ") || "NONE"}`,
    `MISSING_EVIDENCE: ${report.missingEvidence.join(", ") || "NONE"}`,
    `CONTRADICTING_EVIDENCE: ${report.contradictingEvidence.join(", ") || "NONE"}`,
    "",
    "CANDIDATE_RULES",
    report.candidateRules.length ? report.candidateRules.map((candidate) => `- ${candidate.ruleId}: confidence=${candidate.confidence}; missing=${candidate.missingEvidence.join(", ") || "none"}; contradicting=${candidate.contradictingEvidence.join(", ") || "none"}`).join("\n") : "- NONE",
    "",
    "WHY_AUTO_REPAIR_WAS_NOT_PERFORMED",
    report.whyAutoRepairNotPerformed,
    "",
    "PREVIOUS_REPAIR_ATTEMPTS",
    report.previousRepairAttempts.length ? report.previousRepairAttempts.map((attempt) => `- ${attempt.ruleId}: ${attempt.status} at ${attempt.at}`).join("\n") : "- NONE",
    `retryCount=${report.retryCount}; retryLimit=${report.retryLimit ?? "UNKNOWN"}`,
    "",
    "FILES_AND_STATE_TO_PRESERVE",
    `finalVideoPath=${report.finalVideoPath ?? "UNKNOWN"}`,
    `affectedFile=${report.affectedFile ?? "UNKNOWN"}`,
    report.preserveRequirements.length ? report.preserveRequirements.map((item) => `- ${item}`).join("\n") : "- PRESERVE APPROVED STATE.",
    `generationStatus=${report.generationStatus}; outputReady=${report.outputReady ?? "UNKNOWN"}; qualityStatus=${report.qualityStatus}`,
    "",
    "APPROVED_MANIFEST",
    handoffValue(report.approvedManifest, 3_000),
    "",
    "APPROVED_SOURCE_INFORMATION",
    handoffValue(report.approvedSourceInformation, 3_000),
    "",
    "CHECKPOINT",
    handoffValue(report.checkpoint, 4_000),
    "",
    "CODEX INSTRUCTIONS",
    "1. Tìm root cause trước, không mặc định đây là lỗi generation.",
    "2. Chỉ sửa đúng phạm vi của incident và repairScope có bằng chứng.",
    "3. Không regenerate toàn pipeline; không thay các scene/asset đã APPROVED ngoài phạm vi.",
    "4. Nếu repairScope là FRAME_REGION thì không regenerate whole scene.",
    "5. Sau khi sửa phải chạy validation lại và ghi rõ evidence PASS/FAIL.",
    "6. Nếu giải pháp PASS, trả về root cause, files/state đã thay đổi, validation evidence và dữ liệu đủ để thêm troubleshooting rule/handler sau này.",
    "7. Mặc định PRESERVE APPROVED STATE; không xóa toàn bộ, regenerate tất cả hoặc reset project khi chưa có evidence và phạm vi được phê duyệt.",
  ].join("\n");
}

export function buildQaIncidentUserMessage(reportInput: QaIncidentReport) {
  const report = qaIncidentReportSchema.parse(reportInput);
  return [
    "Video đã được tạo thành công.",
    "",
    "Post-Assembly QA phát hiện một vấn đề chưa thể tự xử lý.",
    `Scene: ${report.sceneNumber ?? "UNKNOWN"}`,
    `Timestamp: ${report.globalTimestamp ?? "UNKNOWN"}s`,
    `Issue: ${report.symptom}`,
    `Incident: ${report.incidentId}`,
    "",
    "Video hiện tại vẫn sẵn sàng.",
    "Báo cáo cho Codex đã được chuẩn bị.",
  ].join("\n");
}

export async function getCodexHandoffText(incidentId: string, root = troubleshootingIncidentReportRoot(), fileSystem: ReportFileSystem = defaultFileSystem) {
  return buildCodexHandoffText(await getQaIncidentReport(incidentId, root, fileSystem));
}
