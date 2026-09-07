"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useState } from "react";

type Dashboard = {
  channel: { id: string; name: string } | null;
  stats: { competitors: number; newVideos: number; viralVideos: number };
  videos: Array<{
    id: string;
    url: string;
    thumbnailUrl?: string | null;
    publishedAt: string;
    score: number;
    relativePerformance: number;
    currentViews: number;
    competitor: {
      handle: string;
      displayName: string | null;
      platform: string;
    };
  }>;
};
type ChannelOption = { id: string; name: string };
type SyncProgress = {
  syncId: string;
  status: "running" | "succeeded" | "failed";
  total: number;
  processed: number;
  failed: number;
  error?: string | null;
};
type DesktopUpdater = {
  check: () => Promise<{ status: string; message?: string }>;
  download: () => Promise<unknown>;
  install: () => Promise<unknown>;
  on: (event: string, listener: (payload?: { version?: string; percent?: number; message?: string }) => void) => () => void;
};
const accents = [
  "border-l-emerald-600",
  "border-l-teal-500",
  "border-l-orange-400",
  "border-l-blue-600",
];

export function ViralDashboard() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [updateStatus, setUpdateStatus] = useState("");
  const [updateReady, setUpdateReady] = useState(false);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [periodHours, setPeriodHours] = useState("24");
  const [channelId, setChannelId] = useState("");
  const [minimumViews, setMinimumViews] = useState("50000");
  const [appliedFilters, setAppliedFilters] = useState({ periodHours: "24", channelId: "", minimumViews: "50000" });
  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError("");
    const query = new URLSearchParams({ periodHours: appliedFilters.periodHours });
    if (appliedFilters.channelId) query.set("channelId", appliedFilters.channelId);
    fetch(`/api/v1/dashboard?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        const body = (await response.json()) as {
          data?: Dashboard;
          error?: { message?: string };
        };
        if (!response.ok || !body.data) {
          throw new Error(body.error?.message ?? "Không thể tải dữ liệu tổng quan.");
        }
        setDashboard(body.data);
        setError("");
        setMessage("Đã áp dụng bộ lọc.");
      })
      .catch((caught: unknown) =>
        { if (caught instanceof DOMException && caught.name === "AbortError") return; setError(caught instanceof Error ? caught.message : "Không thể tải dashboard."); },
      )
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
  }, [appliedFilters]);
  useEffect(() => {
    fetch("/api/v1/channels").then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { data: ChannelOption[] };
      setChannels(body.data);
    });
  }, []);
  useEffect(() => {
    const updater = (window as Window & { desktopUpdater?: DesktopUpdater }).desktopUpdater;
    if (!updater) return;
    const cleanups = [
      updater.on("available", (payload) => {
        setUpdateStatus(`Có bản ${payload?.version ?? "mới"}. Đang tải xuống...`);
        void updater.download();
      }),
      updater.on("progress", (payload) => setUpdateStatus(`Đang tải bản cập nhật: ${payload?.percent ?? 0}%`)),
      updater.on("downloaded", () => {
        setUpdateReady(true);
        setUpdateStatus("Đã tải xong bản cập nhật. Bấm lại để cài đặt.");
      }),
      updater.on("not-available", () => setUpdateStatus("Bạn đang dùng phiên bản mới nhất.")),
      updater.on("error", (payload) => setUpdateStatus(payload?.message ?? "Không thể kiểm tra cập nhật.")),
    ];
    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);
  useEffect(() => {
    if (!syncProgress?.syncId || syncProgress.status !== "running") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/v1/sync/${syncProgress.syncId}`, { cache: "no-store" });
        const body = await response.json() as { data?: SyncProgress; error?: { message?: string } };
        if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể đọc tiến trình đồng bộ.");
        if (cancelled) return;
        setSyncProgress(body.data);
        if (body.data.status === "running") {
          timer = setTimeout(() => void poll(), 1000);
        } else {
          setIsSyncing(false);
          setMessage(body.data.status === "succeeded"
            ? `Đã đồng bộ xong ${body.data.processed}/${body.data.total} đối thủ${body.data.failed ? `, lỗi ${body.data.failed}` : ""}.`
            : body.data.error ?? "Đồng bộ không hoàn tất.");
          setAppliedFilters((current) => ({ ...current }));
        }
      } catch (caught) {
        if (!cancelled) {
          setIsSyncing(false);
          setError(caught instanceof Error ? caught.message : "Không thể đọc tiến trình đồng bộ.");
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [syncProgress?.syncId, syncProgress?.status]);
  const videos = useMemo(() => {
    const cutoff = Date.now() - Number(appliedFilters.periodHours) * 3_600_000;
    return (dashboard?.videos ?? []).filter((video) => new Date(video.publishedAt).getTime() >= cutoff && video.currentViews >= Number(appliedFilters.minimumViews));
  }, [dashboard, appliedFilters]);
  const ranking = useMemo(
    () =>
      [...videos]
        .sort((a, b) => b.score - a.score)
        .slice(0, 5),
    [videos],
  );
  const maxScore = Math.max(100, ...ranking.map((video) => video.score));
  async function handleSync() {
    setIsSyncing(true);
    setSyncProgress(null);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/v1/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(channelId ? { channelId } : {}) });
      const body = await response.json() as { data?: { syncId?: string; channels?: number; total?: number; message?: string }; error?: { message?: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể bắt đầu đồng bộ dữ liệu.");
      if (!body.data.syncId) throw new Error("Máy chủ chưa trả về mã tiến trình đồng bộ.");
      setSyncProgress({ syncId: body.data.syncId, status: "running", total: body.data.total ?? 0, processed: 0, failed: 0 });
      setMessage(`${body.data.message ?? "Đã bắt đầu đồng bộ."} Đang theo dõi ${body.data.total ?? 0} đối thủ.`);
    } catch (caught) {
      setIsSyncing(false);
      setError(caught instanceof Error ? caught.message : "Không thể bắt đầu đồng bộ dữ liệu.");
    }
  }
  async function handleSoftwareUpdate() {
    const updater = (window as Window & { desktopUpdater?: DesktopUpdater }).desktopUpdater;
    if (updateReady && updater) {
      await updater.install();
      return;
    }
    if (!updater) {
      window.open("https://github.com/quangtungkc/ai-content-modeling/releases/latest", "_blank", "noopener,noreferrer");
      setUpdateStatus("Đã mở trang tải bản cập nhật.");
      return;
    }
    setUpdateStatus("Đang kiểm tra cập nhật...");
    const result = await updater.check();
    if (result.status === "dev") setUpdateStatus("Chức năng cập nhật chỉ chạy trong bản cài Electron.");
    if (result.status === "error") setUpdateStatus(result.message ?? "Không thể kiểm tra cập nhật.");
  }
  const kpis: Array<[string, string | number, string]> = [
    [
      "Đối thủ đang theo dõi",
      dashboard?.stats.competitors ?? "—",
      "Nguồn tín hiệu",
    ],
    ["Video mới", dashboard?.stats.newVideos ?? "—", `Trong ${periodLabel(appliedFilters.periodHours)}`],
    ["Video đạt ngưỡng", videos.length, `Từ ${formatViews(Number(appliedFilters.minimumViews))} lượt xem`],
    [
      "Channel hiện tại",
      dashboard?.channel?.name ?? "—",
      "Kênh đang chọn",
    ],
  ];
  return (
    <section className="mx-auto max-w-[1150px]">
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-extrabold tracking-[0.18em] text-teal-600">
            TỔNG QUAN CONTENT INTELLIGENCE
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-[#0b3262]">
            Hiệu quả viral & content modeling
          </h1>
          <p className="mt-2 text-sm text-[#6883aa]">
            Theo dõi competitor, tín hiệu vượt chuẩn và cơ hội modeling từ một
            màn hình duy nhất.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => void handleSoftwareUpdate()} className="rounded-lg border border-[#d7e2f1] bg-white px-4 py-3 text-sm font-bold text-[#0b3262] shadow-sm">
            {updateReady ? "Cài bản cập nhật" : "Cập nhật phần mềm"}
          </button>
          <a
            href="/channels"
            className="rounded-lg border border-[#d7e2f1] bg-white px-4 py-3 text-sm font-bold text-[#0b3262] shadow-sm"
          >
            Quản lý Channel
          </a>
          <button onClick={() => void handleSync()} disabled={isSyncing} className="rounded-lg bg-[#07865f] px-4 py-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60">
            {isSyncing ? "Đang xếp hàng..." : "↻ Đồng bộ dữ liệu"}
          </button>
        </div>
      </header>
      {updateStatus && <p aria-live="polite" className="mt-3 text-sm font-semibold text-[#0b5799]">{updateStatus}</p>}
      {error && (
        <div className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}
      <section className="mt-7 rounded-2xl border border-[#d8e3f1] bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
          <label className="block"><span className="mb-2 block text-sm text-[#6883aa]">Khoảng thời gian</span><select value={periodHours} onChange={(event) => setPeriodHours(event.target.value)} className="w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-3 text-sm font-semibold text-[#0b3262]"><option value="24">24 giờ gần nhất</option><option value="72">3 ngày gần nhất</option><option value="168">7 ngày gần nhất</option></select></label>
          <label className="block"><span className="mb-2 block text-sm text-[#6883aa]">Kênh</span><select value={channelId} onChange={(event) => setChannelId(event.target.value)} className="w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-3 text-sm font-semibold text-[#0b3262]"><option value="">Kênh mặc định</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
          <label className="block"><span className="mb-2 block text-sm text-[#6883aa]">Mức tín hiệu</span><select value={minimumViews} onChange={(event) => setMinimumViews(event.target.value)} className="w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-3 text-sm font-semibold text-[#0b3262]"><option value="50000">Từ 50.000 lượt xem</option><option value="100000">Từ 100.000 lượt xem</option></select></label>
          <button onClick={() => { setMessage(""); setAppliedFilters({ periodHours, channelId, minimumViews }); }} disabled={isLoading} className="self-end rounded-lg bg-[#07865f] px-6 py-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60">
            {isLoading ? "Đang tải..." : "Áp dụng"}
          </button>
        </div>
        {syncProgress?.status === "running" && (
          <div aria-live="polite" className="mt-3 rounded-lg bg-[#eef8f5] px-3 py-2 text-sm font-semibold text-[#07865f]">
            Đang xử lý đối thủ: {syncProgress.processed}/{syncProgress.total}
            {syncProgress.failed ? ` · lỗi ${syncProgress.failed}` : ""}
          </div>
        )}
        {message && !isLoading && syncProgress?.status !== "running" && <p aria-live="polite" className="mt-3 text-sm font-semibold text-[#07865f]">{message}</p>}
        <p className="mt-3 text-xs leading-5 text-[#6883aa]"><strong>Mức tín hiệu</strong> lọc video theo lượt xem hiện tại: từ 50.000 hoặc từ 100.000 lượt xem. Điểm lan truyền vẫn được giữ trong bảng để so sánh mức vượt chuẩn của từng video.</p>
      </section>
      <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(([label, value, hint], index) => (
          <article
            key={label}
            className={`min-h-[122px] rounded-xl border border-[#d8e3f1] border-l-4 bg-white p-5 shadow-sm ${accents[index]}`}
          >
            <p className="text-sm text-[#6883aa]">{label}</p>
            <p className="mt-4 truncate text-[25px] font-extrabold text-[#0b3262]">
              {value}
            </p>
            <p className="mt-1 text-xs text-[#7990b0]">{hint}</p>
          </article>
        ))}
      </section>
      <section className="mt-5 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <article className="rounded-xl border border-[#d8e3f1] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-extrabold text-[#0b3262]">
            Tín hiệu viral theo thời gian
          </h2>
          <p className="mt-1 text-sm text-[#6883aa]">
            Tốc độ tăng lượt xem và mức vượt chuẩn của video mới
          </p>
          <div className="mt-8 flex h-52 items-end gap-2 border-b border-[#c9d8eb] px-1">
            {videos.slice(0, 18).map((video, index) => (
              <div
                key={video.id}
                className="flex min-w-0 flex-1 flex-col justify-end"
              >
                <div
                  title={`${video.score} viral score`}
                  className="rounded-t bg-gradient-to-t from-[#16a085] to-[#28c6af]"
                  style={{
                    height: `${Math.max(8, Math.min(100, video.score))}%`,
                  }}
                />
                <span className="mt-2 truncate text-center text-[10px] text-[#7990b0]">
                  {index + 1}
                </span>
              </div>
            ))}
            {dashboard && !videos.length && (
              <p className="m-auto text-sm text-[#7990b0]">
                Chưa có đủ snapshot để hiển thị tín hiệu.
              </p>
            )}
          </div>
        </article>
        <article className="rounded-xl border border-[#d8e3f1] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-extrabold text-[#0b3262]">
            Xếp hạng tín hiệu viral
          </h2>
          <p className="mt-1 text-sm text-[#6883aa]">
            So sánh mức vượt chuẩn theo từng đối thủ
          </p>
          <div className="mt-7 space-y-5">
            {ranking.map((video, index) => (
              <div key={video.id}>
                <div className="mb-2 flex justify-between gap-3 text-sm">
                  <span className="truncate font-semibold text-[#0b3262]">
                    #{index + 1}{" "}
                    {video.competitor.handle || video.competitor.displayName}
                  </span>
                  <span className="font-extrabold text-[#0b3262]">
                    {video.score} điểm
                  </span>
                </div>
                <div className="h-5 overflow-hidden rounded bg-[#e9f0f8]">
                  <div
                    className="h-full rounded bg-gradient-to-r from-[#2db596] via-[#69be81] to-[#f0aa17]"
                    style={{ width: `${(video.score / maxScore) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {!ranking.length && (
              <p className="py-12 text-center text-sm text-[#7990b0]">
                Chưa có video viral trong khoảng thời gian này.
              </p>
            )}
          </div>
        </article>
      </section>
      <section className="mt-5 rounded-xl border border-[#d8e3f1] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-[#0b3262]">
              Video đang vượt chuẩn
            </h2>
            <p className="mt-1 text-sm text-[#6883aa]">
              Tín hiệu cần ưu tiên phân tích và tạo modeling idea.
            </p>
          </div>
          <span className="rounded-full bg-[#e8f7f2] px-3 py-1 text-xs font-bold text-[#07865f]">
            {appliedFilters.periodHours === "24" ? "24 giờ gần nhất" : `${appliedFilters.periodHours === "72" ? "3" : "7"} ngày gần nhất`}
          </span>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[700px] text-left">
            <thead className="border-y border-[#e2eaf4] bg-[#f7f9fc] text-xs uppercase tracking-wide text-[#6883aa]">
              <tr>
                <th className="px-4 py-3">Đối thủ</th>
                <th className="px-4 py-3">Lượt xem</th>
                <th className="px-4 py-3">So với bình thường</th>
                <th className="px-4 py-3">Điểm lan truyền</th>
                <th className="px-4 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {videos.slice(0, 8).map((video) => (
                <tr
                  key={video.id}
                  className="border-b border-[#edf2f7] text-sm"
                >
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-[#e7f5f1] text-lg">
                        {video.thumbnailUrl ? (
                          <img
                            src={video.thumbnailUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          "🔥"
                        )}
                      </div>
                      <div>
                        <p className="font-bold text-[#0b3262]">
                          {video.competitor.handle ||
                            video.competitor.displayName}
                        </p>
                        <p className="mt-0.5 text-xs text-[#7990b0]">
                          {video.competitor.platform} ·{" "}
                          {formatAge(video.publishedAt)}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 font-bold text-[#0b3262]">
                    {formatViews(video.currentViews)}
                  </td>
                  <td className="px-4 py-4">
                    <span className="rounded-md bg-[#e8f7f2] px-2.5 py-1 text-xs font-bold text-[#07865f]">
                      {video.relativePerformance.toFixed(1)}× bình thường
                    </span>
                  </td>
                  <td className="px-4 py-4 font-extrabold text-[#e68e00]">
                    {video.score}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <a
                      href={video.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mr-4 text-xs font-bold text-[#07865f]"
                    >
                      Mở video
                    </a>
                    <button className="text-xs font-bold text-[#0b5799]">
                      Phân tích
                    </button>
                  </td>
                </tr>
              ))}
              {dashboard && !videos.length && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-sm text-[#7990b0]"
                  >
                    Chưa có video mới hoặc metric snapshot trong 24 giờ gần
                    nhất.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
function formatViews(value: number) {
  return value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1_000
      ? `${Math.round(value / 1_000)}K`
      : String(value);
}
function formatAge(value: string) {
  const hours = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000),
  );
  return hours < 1 ? "vừa xong" : `${hours}h trước`;
}
function periodLabel(value: string) {
  return value === "24" ? "24 giờ" : value === "72" ? "3 ngày" : "7 ngày";
}
