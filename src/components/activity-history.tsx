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
  projectId: string | null;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  settings: { artStyle: string; aspectRatio: string };
  steps: ActivityStep[];
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};

export function ActivityHistory() {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/v1/automations")
      .then(async (response) => {
        const body = await response.json() as { data?: AutomationRun[]; error?: { message?: string } };
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể tải lịch sử hoạt động.");
        setRuns(body.data);
        setSelectedRunId(body.data[0]?.id ?? "");
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Không thể tải lịch sử hoạt động."))
      .finally(() => setIsLoading(false));
  }, []);

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
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
                  <p className="font-extrabold text-[#0b3262]">Chạy tự động</p>
                  <StatusBadge status={run.status} />
                </div>
                <p className="mt-2 text-xs text-[#6883aa]">{formatDate(run.startedAt)}</p>
                <p className="mt-1 text-xs text-[#7990b0]">{run.settings.artStyle} · {run.settings.aspectRatio}</p>
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
                <StatusBadge status={selectedRun.status} />
              </div>
              <div className="mt-5 rounded-lg bg-[#f7f9fc] p-4 text-sm text-[#0b3262]">
                <p><strong>Phong cách:</strong> {selectedRun.settings.artStyle}</p>
                <p className="mt-1"><strong>Khung hình:</strong> {selectedRun.settings.aspectRatio}</p>
                {selectedRun.projectId && <p className="mt-1"><strong>Content Project:</strong> {selectedRun.projectId}</p>}
              </div>
              <div className="mt-5 space-y-3">
                {selectedRun.steps.map((step, index) => (
                  <div key={step.key} className="flex gap-3 rounded-lg border border-[#e4ebf4] p-3">
                    <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${step.status === "completed" ? "bg-emerald-100 text-emerald-700" : step.status === "failed" ? "bg-rose-100 text-rose-700" : step.status === "running" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{step.status === "completed" ? "✓" : step.status === "failed" ? "!" : index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-[#0b3262]">{step.label}</p><span className="text-xs font-semibold text-[#6883aa]">{stepStatusLabel(step.status)}</span></div>
                      {step.detail && <p className="mt-1 text-sm text-[#6883aa]">{step.detail}</p>}
                      {step.error && <p className="mt-1 text-sm text-rose-700">{step.error}</p>}
                    </div>
                  </div>
                ))}
              </div>
              {selectedRun.error && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{selectedRun.error}</p>}
            </article>
          )}
        </div>
      )}
    </section>
  );
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
