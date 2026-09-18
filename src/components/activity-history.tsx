"use client";

import { useEffect, useState } from "react";

type ActivityStep = {
  key: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  detail?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};
type AutomationRun = {
  id: string;
  sourceVideoId: string;
  ideaId: string | null;
  projectId: string | null;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  settings: { artStyle: string; aspectRatio: string; postText?: string; hashtags?: string; language?: string; targetCountry?: string };
  steps: ActivityStep[];
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  sourceVideoUrl: string | null;
  finalVideoUrl: string | null;
  codexAgent?: {
    id: string;
    status: string;
    sessionId: string;
    currentStage: string;
    currentAction: string | null;
    retryCount: number;
    generationStatus: string;
    qualityStatus: string;
    outputReady: boolean;
    stages: Array<{ stage: string; status: string; retryCount: number; validationResult: string | null; lastStrategy: string | null }>;
    events: Array<{ id: string; sequence: number; type: string; stage: string | null; payload: Record<string, unknown>; reasoningSummary: string | null; createdAt: string }>;
  } | null;
};

export function ActivityHistory() {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [expandedStepKey, setExpandedStepKey] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copiedRunId, setCopiedRunId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const loadRuns = () => fetch("/api/v1/automations")
      .then(async (response) => {
        const body = await response.json() as { data?: AutomationRun[]; error?: { message?: string } };
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể tải lịch sử hoạt động.");
        if (!active) return;
        setRuns(body.data);
        setSelectedRunId((current) => current && body.data?.some((run) => run.id === current) ? current : body.data?.[0]?.id ?? "");
      })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Không thể tải lịch sử hoạt động."); })
      .finally(() => setIsLoading(false));
    void loadRuns();
    const refresh = window.setInterval(() => void loadRuns(), 5_000);
    return () => { active = false; window.clearInterval(refresh); };
  }, []);

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  const completedSteps = selectedRun?.steps.filter((step) => step.status === "completed").length ?? 0;
  const activeStep = selectedRun?.steps.find((step) => step.status === "running") ?? null;
  const postAssemblyQa = selectedRun ? getPostAssemblyQaSummary(selectedRun) : null;

  useEffect(() => {
    if (!selectedRun) {
      setExpandedStepKey("");
      return;
    }
    const preferredStep = selectedRun.steps.find((step) => step.status === "running" || step.status === "failed")
      ?? selectedRun.steps[selectedRun.steps.length - 1];
    setExpandedStepKey(preferredStep?.key ?? "");
  }, [selectedRunId, selectedRun]);

  async function deleteSelectedProject() {
    if (!selectedRun || !window.confirm("Xóa project modeling, toàn bộ ảnh/video đã tạo và phiên lịch sử này? Dữ liệu không thể khôi phục.")) return;
    setIsDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/automations?id=${encodeURIComponent(selectedRun.id)}`, { method: "DELETE" });
      const body = await response.json() as { data?: { deletedRunId?: string }; error?: { message?: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể xóa project.");
      const remaining = runs.filter((run) => run.id !== selectedRun.id);
      setRuns(remaining);
      setSelectedRunId(remaining[0]?.id ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể xóa project.");
    } finally {
      setIsDeleting(false);
    }
  }

  async function copyPublishingContent(run: AutomationRun) {
    const content = [run.settings.postText?.trim(), run.settings.hashtags?.trim()].filter(Boolean).join("\n\n");
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopiedRunId(run.id);
    window.setTimeout(() => setCopiedRunId((id) => id === run.id ? "" : id), 1800);
  }

  return (
    <section className="mx-auto max-w-[1150px]">
      <header>
        <p className="text-xs font-extrabold tracking-[0.18em] text-teal-600">NHẬT KÝ VẬN HÀNH</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-[#0b3262]">Lịch sử hoạt động</h1>
        <p className="mt-2 text-sm text-[#6883aa]">Theo dõi từng bước app đã thực hiện trong các phiên chạy tự động.</p>
      </header>
      {error && <p className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
      {isLoading && <p className="mt-6 text-sm font-semibold text-[#6883aa]">Đang tải lịch sử...</p>}
      {!isLoading && !runs.length && <div className="mt-6 rounded-xl border border-dashed border-[#cbd9ea] bg-white p-8 text-center text-sm text-[#6883aa]">Chưa có phiên chạy tự động nào.</div>}
      {!!runs.length && (
        <div className="mt-6 grid gap-5 lg:grid-cols-[340px_1fr]">
          <div className="space-y-3">
            {runs.map((run) => (
              <button type="button" key={run.id} onClick={() => setSelectedRunId(run.id)} className={`w-full rounded-xl border p-4 text-left shadow-sm ${selectedRunId === run.id ? "border-[#7c3aed] bg-violet-50" : "border-[#d8e3f1] bg-white"}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-extrabold text-[#0b3262]">{run.codexAgent ? "Run with Codex" : "Chạy tự động"}</p>
                  <StatusBadge status={run.status} />
                </div>
                <p className="mt-2 text-xs text-[#6883aa]">{formatDate(run.startedAt)}</p>
                <p className="mt-1 text-xs text-[#7990b0]">{run.settings.artStyle} · {run.settings.aspectRatio}</p>
                <p className="mt-2 text-xs font-bold text-[#7c3aed]">{run.steps.filter((step) => step.status === "completed").length}/{run.steps.length} bước đã xong</p>
              </button>
            ))}
          </div>
          {selectedRun && (
            <article className="rounded-xl border border-[#d8e3f1] bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-extrabold tracking-[0.16em] text-violet-600">CHI TIẾT PHIÊN CHẠY</p>
                  <h2 className="mt-1 text-xl font-extrabold text-[#0b3262]">Video modeling tự động</h2>
                  <p className="mt-1 text-xs text-[#6883aa]">Bắt đầu: {formatDate(selectedRun.startedAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedRun.status} />
                  <button type="button" onClick={() => void deleteSelectedProject()} disabled={isDeleting} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-extrabold text-rose-700 disabled:opacity-50">{isDeleting ? "Đang xóa..." : "Xóa dự án"}</button>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-violet-100 bg-violet-50 px-4 py-3 text-sm text-violet-900">
                <p className="font-extrabold">Tiến độ: {completedSteps}/{selectedRun.steps.length} bước đã hoàn tất</p>
                {activeStep && <p className="mt-1">Đang thực hiện: {activeStep.label}</p>}
                {selectedRun.status === "SUCCEEDED" && <p className="mt-1">Quy trình đã hoàn thành toàn bộ.</p>}
              </div>
              {selectedRun.codexAgent && <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-950">
                <p className="font-extrabold">CODEX AGENT · {selectedRun.codexAgent.status === "NEEDS_ENGINEERING" ? "NEEDS_ENGINEERING — đang/đã thử tự sửa code" : selectedRun.codexAgent.status}</p>
                <p className="mt-1 text-xs">Session: {selectedRun.codexAgent.sessionId}</p>
                <p className="mt-1">Stage: {selectedRun.codexAgent.currentStage}{selectedRun.codexAgent.currentAction ? ` · Action: ${selectedRun.codexAgent.currentAction}` : ""}</p>
                <p className="mt-1">Tổng recovery: {selectedRun.codexAgent.retryCount}</p>
              </div>}
              <div className="mt-5 rounded-lg bg-[#f7f9fc] p-4 text-sm text-[#0b3262]">
                <p><strong>Phong cách:</strong> {selectedRun.settings.artStyle}</p>
                <p className="mt-1"><strong>Khung hình:</strong> {selectedRun.settings.aspectRatio}</p>
                {selectedRun.ideaId && <p className="mt-1"><strong>Modeling Idea:</strong> {selectedRun.ideaId}</p>}
                {selectedRun.projectId && <p className="mt-1"><strong>Content Project:</strong> {selectedRun.projectId}</p>}
              </div>
              <div className="mt-5 space-y-3">
                {selectedRun.steps.map((step, index) => (
                  <div key={step.key} className="rounded-lg border border-[#e4ebf4]">
                    <button type="button" onClick={() => setExpandedStepKey((key) => key === step.key ? "" : step.key)} className="flex w-full items-center gap-3 p-3 text-left">
                      <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${step.status === "completed" ? "bg-emerald-100 text-emerald-700" : step.status === "failed" ? "bg-rose-100 text-rose-700" : step.status === "running" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{step.status === "completed" ? "✓" : step.status === "failed" ? "!" : index + 1}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-[#0b3262]">{step.label}</p><span className="text-xs font-semibold text-[#6883aa]">{stepStatusLabel(step.status)}</span></div>
                        <p className="mt-1 text-xs font-semibold text-violet-600">{expandedStepKey === step.key ? "Thu gọn kết quả" : "Xem kết quả bước"}</p>
                      </div>
                      <span className="text-lg text-[#6883aa]" aria-hidden="true">{expandedStepKey === step.key ? "⌃" : "⌄"}</span>
                    </button>
                    {expandedStepKey === step.key && <div className="border-t border-[#e4ebf4] bg-[#fbfcfe] px-4 py-3 text-sm">
                      <p className="font-extrabold text-[#0b3262]">Kết quả bước</p>
                      {step.detail && <p className="mt-1 text-[#6883aa]">{step.detail}</p>}
                      {step.error && <p className="mt-1 text-rose-700">{step.error}</p>}
                      {(step.startedAt || step.completedAt) && <p className="mt-2 text-xs text-[#7990b0]">{step.startedAt && `Bắt đầu: ${formatDate(step.startedAt)}`}{step.completedAt && ` · Kết thúc: ${formatDate(step.completedAt)}`}</p>}
                      {selectedRun.codexAgent && <CodexStepEvents events={selectedRun.codexAgent.events.filter((event) => normalizeStageKey(event.stage) === step.key)} />}
                      {step.key === "final-video" && selectedRun.finalVideoUrl && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                        <p className="font-extrabold text-emerald-800">Video kết quả cuối cùng</p>
                        <video controls preload="metadata" src={selectedRun.finalVideoUrl} className="mt-3 max-h-[420px] w-full rounded-lg bg-black" />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <a href={selectedRun.finalVideoUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Mở video kết quả</a>
                          {selectedRun.sourceVideoUrl && <a href={selectedRun.sourceVideoUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-bold text-emerald-800">Mở video gốc</a>}
                          <a href={`${selectedRun.finalVideoUrl}&download=1`} download="video-modeling.mp4" className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-bold text-emerald-800">Tải video</a>
                        </div>
                        {(selectedRun.settings.postText || selectedRun.settings.hashtags) && <div className="mt-4 rounded-lg border border-emerald-200 bg-white p-3">
                          <div>
                            <p className="text-xs font-extrabold uppercase tracking-wide text-[#6883aa]">Text ngắn đăng kèm video</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-[#0b3262]">{selectedRun.settings.postText || "Chưa có nội dung."}</p>
                            {(selectedRun.settings.language || selectedRun.settings.targetCountry) && <p className="mt-1 text-xs text-[#7990b0]">{[selectedRun.settings.language, selectedRun.settings.targetCountry].filter(Boolean).join(" · ")}</p>}
                          </div>
                          <div className="mt-3">
                            <p className="text-xs font-extrabold uppercase tracking-wide text-[#6883aa]">Hashtag kênh</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm font-semibold text-violet-700">{selectedRun.settings.hashtags || "Chưa khai báo hashtag cho kênh."}</p>
                          </div>
                          <button type="button" onClick={() => void copyPublishingContent(selectedRun)} className="mt-3 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white">
                            {copiedRunId === selectedRun.id ? "Đã sao chép" : "Sao chép text + hashtag"}
                          </button>
                        </div>}
                      </div>}
                    </div>}
                  </div>
                ))}
              </div>
              {postAssemblyQa && <PostAssemblyQaCard qa={postAssemblyQa} />}
              {selectedRun.finalVideoUrl && selectedRun.steps.every((step) => step.key !== "final-video" || step.status !== "completed") && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Video cuối đã có sẵn: mở rộng bước “Ghép và xuất video hoàn chỉnh” để xem hoặc tải xuống.</div>}
              {selectedRun.error && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{selectedRun.error}</p>}
            </article>
          )}
        </div>
      )}
    </section>
  );
}

function normalizeStageKey(stage: string | null) {
  if (stage === "FINAL_ASSEMBLY") return "final-video";
  return stage?.toLowerCase().replaceAll("_", "-") ?? "";
}

function CodexStepEvents({ events }: { events: NonNullable<AutomationRun["codexAgent"]>["events"] }) {
  if (!events.length) return <p className="mt-2 text-xs text-[#7990b0]">Chưa có Codex event cho bước này.</p>;
  return <div className="mt-3 space-y-2 border-t border-[#e4ebf4] pt-3">
    <p className="text-xs font-extrabold uppercase tracking-wide text-teal-700">Event log có cấu trúc</p>
    {events.map((event) => <div key={event.id} className="rounded-md bg-white px-3 py-2 text-xs text-[#0b3262]">
      <div className="flex flex-wrap justify-between gap-2"><strong>#{event.sequence} · {event.type}</strong><span className="text-[#7990b0]">{formatDate(event.createdAt)}</span></div>
      {event.reasoningSummary && <p className="mt-1">{event.reasoningSummary}</p>}
      {Object.keys(event.payload ?? {}).length > 0 && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px] text-[#6883aa]">{JSON.stringify(event.payload, null, 2)}</pre>}
    </div>)}
  </div>;
}

type PostAssemblyQaSummary = {
  qualityStatus: string;
  generationStatus: string;
  outputReady: boolean;
  qaRunId: string | null;
  issueCount: number;
  incidentId: string | null;
  repairCount: number;
  sourceFidelity: { status: string; score: number | null; breakdown: Record<string, number | null> } | null;
};

function getPostAssemblyQaSummary(run: AutomationRun): PostAssemblyQaSummary | null {
  const agent = run.codexAgent;
  if (!agent && !run.finalVideoUrl) return null;
  const auditEvent = agent?.events.filter((event) => event.type === "FINAL_AUDIT_RECORDED").at(-1);
  const payload = auditEvent?.payload ?? {};
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const issueCount = findings.filter((finding) => finding && typeof finding === "object" && (finding as { status?: unknown }).status === "FAIL").length;
  const incidents = Array.isArray(payload.incidentsCreated) ? payload.incidentsCreated.filter((value): value is string => typeof value === "string") : [];
  const repairs = Array.isArray(payload.repairsTriggered) ? payload.repairsTriggered : [];
  const sourceFinding = findings.find((finding) => finding && typeof finding === "object" && (finding as { validatorId?: unknown }).validatorId === "source-fidelity") as { actual?: { validationStatus?: unknown; overallModelingFidelityScore?: unknown; breakdown?: unknown } } | undefined;
  const sourceActual = sourceFinding?.actual;
  const sourceFidelity = sourceActual ? { status: typeof sourceActual.validationStatus === "string" ? sourceActual.validationStatus : "NOT_EVALUATED", score: typeof sourceActual.overallModelingFidelityScore === "number" ? sourceActual.overallModelingFidelityScore : null, breakdown: sourceActual.breakdown && typeof sourceActual.breakdown === "object" && !Array.isArray(sourceActual.breakdown) ? sourceActual.breakdown as Record<string, number | null> : {} } : null;
  return {
    qualityStatus: agent?.qualityStatus ?? (typeof payload.qualityStatus === "string" ? payload.qualityStatus : "NOT_RUN"),
    generationStatus: agent?.generationStatus ?? (run.finalVideoUrl ? "SUCCESS" : "RUNNING"),
    outputReady: agent?.outputReady ?? Boolean(run.finalVideoUrl),
    qaRunId: typeof payload.qaRunId === "string" ? payload.qaRunId : null,
    issueCount,
    incidentId: incidents[0] ?? null,
    repairCount: repairs.length,
    sourceFidelity,
  };
}

function PostAssemblyQaCard({ qa }: { qa: PostAssemblyQaSummary }) {
  const copy: Record<string, { title: string; detail: string; style: string }> = {
    NOT_RUN: { title: "Chưa kiểm tra", detail: "Video đã xuất thành công; hậu kiểm chất lượng chưa chạy.", style: "border-slate-200 bg-slate-50 text-slate-800" },
    CHECKING: { title: "Đang kiểm tra chất lượng video…", detail: "Video hiện tại vẫn sẵn sàng trong lúc hậu kiểm chạy nền.", style: "border-amber-200 bg-amber-50 text-amber-900" },
    REPAIRING: { title: "Đã phát hiện vấn đề — Đang tự sửa…", detail: "Bản video hiện tại được giữ nguyên cho đến khi candidate mới đạt kiểm tra.", style: "border-violet-200 bg-violet-50 text-violet-900" },
    APPROVED: { title: "Kiểm tra hoàn tất — Video đạt yêu cầu", detail: "Hậu kiểm sau khi xuất đã hoàn tất.", style: "border-emerald-200 bg-emerald-50 text-emerald-900" },
    NEEDS_REVIEW: { title: "Phát hiện vấn đề cần xem xét", detail: "Video hiện tại vẫn được giữ nguyên và vẫn có thể xem hoặc tải xuống.", style: "border-orange-200 bg-orange-50 text-orange-900" },
    REPAIR_FAILED: { title: "Tự sửa chưa thành công — Video hiện tại vẫn được giữ nguyên", detail: "Candidate không đạt hậu kiểm nên không thay thế video đang có.", style: "border-rose-200 bg-rose-50 text-rose-900" },
  };
  const current = copy[qa.qualityStatus] ?? copy.NOT_RUN;
  return <section className={`mt-5 rounded-lg border p-4 text-sm ${current.style}`}>
    <p className="text-xs font-extrabold uppercase tracking-wide">Kiểm tra chất lượng sau khi xuất</p>
    <p className="mt-1 font-extrabold">{current.title}</p>
    <p className="mt-1 text-xs opacity-85">{current.detail}</p>
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
      <span>Xuất video: {qa.generationStatus === "SUCCESS" ? "Hoàn tất" : qa.generationStatus}</span>
      <span>Video: {qa.outputReady ? "Sẵn sàng xem/tải" : "Chưa sẵn sàng"}</span>
      {qa.qaRunId && <span>QA run: {qa.qaRunId}</span>}
      {qa.issueCount > 0 && <span>Vấn đề phát hiện: {qa.issueCount}</span>}
      {qa.repairCount > 0 && <span>Đã kích hoạt sửa: {qa.repairCount}</span>}
      {qa.incidentId && <span>Incident: {qa.incidentId}</span>}
    </div>
    {qa.sourceFidelity && <div className="mt-3 grid gap-2 border-t border-current/15 pt-3 text-xs sm:grid-cols-4"><span><strong>Modeling Fidelity:</strong> {qa.sourceFidelity.score === null ? "NOT_EVALUATED" : `${Math.round(qa.sourceFidelity.score * 100)}%`}</span><span><strong>Structure:</strong> {qa.sourceFidelity.breakdown.structureFidelity === undefined || qa.sourceFidelity.breakdown.structureFidelity === null ? "NOT_EVALUATED" : qa.sourceFidelity.breakdown.structureFidelity === 1 ? "PASS" : "FAIL"}</span><span><strong>Action:</strong> {qa.sourceFidelity.breakdown.actionFidelity === undefined || qa.sourceFidelity.breakdown.actionFidelity === null ? "NOT_EVALUATED" : qa.sourceFidelity.breakdown.actionFidelity === 1 ? "PASS" : "FAIL"}</span><span><strong>Camera/Timing:</strong> {qa.sourceFidelity.status}</span></div>}
  </section>;
}

function StatusBadge({ status }: { status: AutomationRun["status"] }) {
  const styles = status === "SUCCEEDED" ? "bg-emerald-100 text-emerald-700" : status === "FAILED" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700";
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${styles}`}>{status === "SUCCEEDED" ? "Hoàn tất" : status === "FAILED" ? "Thất bại" : "Đang chạy"}</span>;
}

function stepStatusLabel(status: ActivityStep["status"]) {
  return status === "completed" ? "Đã xong" : status === "failed" ? "Lỗi" : status === "running" ? "Đang chạy" : "Chờ chạy";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
