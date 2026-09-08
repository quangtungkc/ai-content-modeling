"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useState } from "react";

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
    analysis: { createdAt: string; content: VideoAnalysisResult["analysis"] } | null;
    competitor: {
      handle: string;
      displayName: string | null;
      platform: string;
    };
  }>;
};
type ChannelOption = { id: string; name: string };
type CompetitorOption = { id: string; handle: string; displayName: string | null; platform: string; url: string };
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
type FacebookScanItem = { url: string; caption: string; publishedAt: string | null; views: number | null; likes: number | null; comments: number | null; shares: number | null };
type FacebookScanResult = { competitorId: string; sourceUrl: string; needsLogin: boolean; items: FacebookScanItem[]; error?: string };
type FacebookScanProgress = { processed: number; total: number };
type DesktopFacebook = {
  open: () => Promise<{ status: string }>;
  scan: (entries: Array<{ id: string; url: string }>, onProgress?: (progress: FacebookScanProgress) => void) => Promise<FacebookScanResult[]>;
};
type VideoAnalysisResult = {
  analysis: {
    summary: string;
    hook: string;
    setup: string;
    conflict: string;
    escalation: string;
    twist: string;
    payoff: string;
    retentionMechanism: string;
    whyItWorks: string[];
  };
};
type ModelingIdeaResult = { title: string; coreConcept: string; script: string; characterDesign: string; setting: string; artStyle: string; sourceMechanism: string; whatIsPreserved: string[]; whatIsChanged: string[]; targetMarketAdaptation: string; similarityRisk: "low" | "medium" | "high"; whyWorthDeveloping: string };
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
  const [minimumViews, setMinimumViews] = useState("20000");
  const [appliedFilters, setAppliedFilters] = useState({ periodHours: "24", channelId: "", minimumViews: "20000" });
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualChannelId, setManualChannelId] = useState("");
  const [manualCompetitors, setManualCompetitors] = useState<CompetitorOption[]>([]);
  const [manualError, setManualError] = useState("");
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [isBrowserScanning, setIsBrowserScanning] = useState(false);
  const [facebookScanProgress, setFacebookScanProgress] = useState<FacebookScanProgress | null>(null);
  const [analyzingVideoId, setAnalyzingVideoId] = useState("");
  const [analysisResult, setAnalysisResult] = useState<VideoAnalysisResult | null>(null);
  const [analysisVideoId, setAnalysisVideoId] = useState("");
  const [analysisCopied, setAnalysisCopied] = useState(false);
  const [ideaArtStyle, setIdeaArtStyle] = useState("Hoạt hình 3D");
  const [modelingIdea, setModelingIdea] = useState<ModelingIdeaResult | null>(null);
  const [isGeneratingIdea, setIsGeneratingIdea] = useState(false);
  const [modelingIdeaError, setModelingIdeaError] = useState("");
  const [analysisFilter, setAnalysisFilter] = useState<"all" | "analyzed" | "unanalyzed">("all");
  const [videoPage, setVideoPage] = useState(1);
  const [autoSyncRequested, setAutoSyncRequested] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("autoSync") === "1");
  const [manualVideo, setManualVideo] = useState({ competitorId: "", url: "", publishedAt: new Date().toISOString().slice(0, 16), views: "", likes: "0", comments: "0", shares: "0", caption: "" });
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
    if (!showManualEntry || !manualChannelId) return;
    setManualCompetitors([]);
    setManualVideo((current) => ({ ...current, competitorId: "" }));
    fetch(`/api/v1/channels/${manualChannelId}/competitors`)
      .then(async (response) => {
        const body = await response.json() as { data?: CompetitorOption[]; error?: { message?: string } };
        if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể tải danh sách đối thủ.");
        setManualCompetitors(body.data);
      })
      .catch((caught: unknown) => setManualError(caught instanceof Error ? caught.message : "Không thể tải danh sách đối thủ."));
  }, [showManualEntry, manualChannelId]);
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
    return (dashboard?.videos ?? []).filter((video) => new Date(video.publishedAt).getTime() >= cutoff && video.currentViews >= Number(appliedFilters.minimumViews) && (analysisFilter === "all" || (analysisFilter === "analyzed" ? Boolean(video.analysis) : !video.analysis)));
  }, [dashboard, appliedFilters, analysisFilter]);
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(videos.length / pageSize));
  const visibleVideos = videos.slice((videoPage - 1) * pageSize, videoPage * pageSize);
  const ranking = useMemo(
    () =>
      [...videos]
        .sort((a, b) => b.score - a.score)
        .slice(0, 5),
    [videos],
  );
  const maxScore = Math.max(100, ...ranking.map((video) => video.score));
  useEffect(() => { setVideoPage(1); }, [appliedFilters, analysisFilter]);
  const handleSync = useCallback(async () => {
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
  }, [channelId]);
  async function deleteVideoData() {
    const selectedChannelId = channelId || dashboard?.channel?.id || channels[0]?.id;
    if (!selectedChannelId) {
      setError("Hãy chọn Channel trước khi xoá dữ liệu video.");
      return;
    }
    if (!window.confirm("Xoá toàn bộ video và kết quả phân tích của Channel này? Không thể hoàn tác.")) return;
    setError("");
    setMessage("Đang xoá dữ liệu video...");
    try {
      const response = await fetch(`/api/v1/dashboard?channelId=${encodeURIComponent(selectedChannelId)}`, { method: "DELETE" });
      const body = await response.json() as { data?: { deleted?: number }; error?: { message?: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể xoá dữ liệu video.");
      setAnalysisResult(null);
      setMessage(`Đã xoá ${body.data.deleted ?? 0} video và dữ liệu phân tích. Dữ liệu sẽ chỉ bị xoá khi Phong bấm nút này.`);
      setAppliedFilters((current) => ({ ...current }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể xoá dữ liệu video.");
    }
  }
  useEffect(() => {
    if (!autoSyncRequested || !dashboard || isSyncing) return;
    setAutoSyncRequested(false);
    void handleSync();
  }, [autoSyncRequested, dashboard, isSyncing, handleSync]);
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
  async function openFacebookBrowser() {
    const browser = (window as Window & { desktopFacebook?: DesktopFacebook }).desktopFacebook;
    if (!browser) {
      setError("Chức năng này chỉ chạy trong ứng dụng cài trên máy.");
      return;
    }
    await browser.open();
    setMessage("Cửa sổ Facebook đã mở. Đăng nhập xong, quay lại app và bấm Quét toàn bộ đối thủ.");
  }
  async function scanFacebookTrial() {
    const browser = (window as Window & { desktopFacebook?: DesktopFacebook }).desktopFacebook;
    const selectedChannelId = channelId || dashboard?.channel?.id || channels[0]?.id;
    if (!browser) {
      setError("Chức năng này chỉ chạy trong ứng dụng cài trên máy.");
      return;
    }
    if (!selectedChannelId) {
      setError("Hãy chọn Channel trước khi quét đối thủ.");
      return;
    }
    setIsBrowserScanning(true);
    setError("");
    setMessage("Đang tải danh sách đối thủ Facebook...");
    try {
      const competitorsResponse = await fetch(`/api/v1/channels/${selectedChannelId}/competitors`);
      const competitorsBody = await competitorsResponse.json() as { data?: CompetitorOption[]; error?: { message?: string } };
      const facebookCompetitors = (competitorsBody.data ?? []).filter((competitor) => competitor.platform.toLowerCase() === "facebook");
      if (!competitorsResponse.ok || !facebookCompetitors.length) throw new Error(competitorsBody.error?.message ?? "Channel chưa có đối thủ Facebook để quét.");
      setFacebookScanProgress({ processed: 0, total: facebookCompetitors.length });
      const results = await browser.scan(
        facebookCompetitors.map(({ id, url }) => ({ id, url })),
        (progress) => {
          setFacebookScanProgress(progress);
          setMessage(`Đang quét đối thủ: ${progress.processed}/${progress.total}`);
        },
      );
      if (results.some((result) => result.needsLogin)) {
        setMessage("Facebook yêu cầu đăng nhập. Đăng nhập trong cửa sổ Facebook rồi bấm Quét toàn bộ đối thủ lần nữa.");
        return;
      }
      let stored = 0;
      let skipped = 0;
      const discovered = results.reduce((total, result) => total + result.items.length, 0);
      const scanErrors = results.filter((result) => result.error).length;
      for (const result of results) {
        for (const item of result.items) {
          if (!item.publishedAt || item.views === null) { skipped += 1; continue; }
          const response = await fetch(`/api/v1/competitors/${result.competitorId}/manual-video`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: item.url,
              caption: item.caption,
              publishedAt: item.publishedAt,
              views: item.views,
              likes: item.likes ?? 0,
              comments: item.comments ?? 0,
              shares: item.shares ?? 0,
            }),
          });
          if (response.ok) stored += 1;
          else skipped += 1;
        }
      }
      setAppliedFilters((current) => ({ ...current }));
      setMessage(stored
        ? `Đã quét và lưu ${stored} video từ ${facebookCompetitors.length} đối thủ. ${skipped ? `${skipped} mục chưa đủ số liệu nên bỏ qua.` : ""}`
        : discovered
          ? `Đã tìm thấy ${discovered} video nhưng Facebook chưa hiển thị đủ thời gian đăng hoặc lượt xem để lưu. ${scanErrors ? `${scanErrors} Trang không thể mở.` : ""}`
          : `Chưa tải được video từ các Trang. ${scanErrors ? `${scanErrors} Trang không thể mở.` : "Kiểm tra lại phiên đăng nhập Facebook rồi thử lại."}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể quét Facebook.");
    } finally {
      setIsBrowserScanning(false);
      setFacebookScanProgress(null);
    }
  }
  async function analyzeVideo(videoId: string) {
    setAnalyzingVideoId(videoId);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/videos/${videoId}/analysis`, { method: "POST" });
      const body = await response.json() as { data?: VideoAnalysisResult; error?: { message?: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể phân tích video.");
      setAnalysisResult(body.data);
      setAnalysisVideoId(videoId);
      setModelingIdea(null);
      setDashboard((current) => current ? { ...current, videos: current.videos.map((video) => video.id === videoId ? { ...video, analysis: { createdAt: new Date().toISOString(), content: body.data!.analysis } } : video) } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể phân tích video.");
    } finally {
      setAnalyzingVideoId("");
    }
  }
  function viewStoredAnalysis(video: Dashboard["videos"][number]) {
    if (video.analysis) {
      setAnalysisResult({ analysis: video.analysis.content });
      setAnalysisVideoId(video.id);
      setModelingIdea(null);
    }
  }
  async function generateModelingIdea() {
    if (!analysisVideoId) return;
    setIsGeneratingIdea(true);
    setError("");
    setModelingIdeaError("");
    try {
      const response = await fetch(`/api/v1/videos/${analysisVideoId}/ideas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artStyle: ideaArtStyle }) });
      const body = await response.json() as { data?: { ideas?: ModelingIdeaResult[] }; error?: { message?: string } };
      if (!response.ok || !body.data?.ideas?.[0]) throw new Error(body.error?.message ?? "Không thể tạo Modeling Idea.");
      setModelingIdea(body.data.ideas[0]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Không thể tạo Modeling Idea.";
      setModelingIdeaError(message);
      setError(message);
    } finally {
      setIsGeneratingIdea(false);
    }
  }
  async function copyAnalysis() {
    if (!analysisResult) return;
    const analysis = analysisResult.analysis;
    const text = [
      "PHÂN TÍCH VIDEO",
      `\nTóm tắt: ${analysis.summary}`,
      `\nHook mở đầu: ${analysis.hook}`,
      `\nThiết lập: ${analysis.setup}`,
      `\nXung đột và leo thang: ${analysis.conflict} ${analysis.escalation}`,
      `\nCú twist và kết: ${analysis.twist} ${analysis.payoff}`,
      `\nCơ chế giữ người xem: ${analysis.retentionMechanism}`,
      `\nVì sao hiệu quả: ${analysis.whyItWorks.join(" · ")}`,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setAnalysisCopied(true);
    window.setTimeout(() => setAnalysisCopied(false), 1800);
  }
  function openManualEntry() {
    const selectedChannelId = channelId || dashboard?.channel?.id || channels[0]?.id;
    if (!selectedChannelId) {
      setError("Hãy tạo hoặc chọn Channel trước khi nhập dữ liệu đối thủ.");
      return;
    }
    setManualError("");
    setManualChannelId(selectedChannelId);
    setShowManualEntry(true);
  }
  async function saveManualEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualVideo.competitorId) {
      setManualError("Hãy chọn đối thủ.");
      return;
    }
    setIsSavingManual(true);
    setManualError("");
    try {
      const response = await fetch(`/api/v1/competitors/${manualVideo.competitorId}/manual-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: manualVideo.url,
          publishedAt: new Date(manualVideo.publishedAt).toISOString(),
          views: Number(manualVideo.views),
          likes: Number(manualVideo.likes),
          comments: Number(manualVideo.comments),
          shares: Number(manualVideo.shares),
          caption: manualVideo.caption || undefined,
        }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Không thể lưu dữ liệu video.");
      setShowManualEntry(false);
      setMessage("Đã lưu video đối thủ. Bảng xếp hạng đã được cập nhật.");
      setAppliedFilters((current) => ({ ...current }));
      setManualVideo({ competitorId: "", url: "", publishedAt: new Date().toISOString().slice(0, 16), views: "", likes: "0", comments: "0", shares: "0", caption: "" });
    } catch (caught) {
      setManualError(caught instanceof Error ? caught.message : "Không thể lưu dữ liệu video.");
    } finally {
      setIsSavingManual(false);
    }
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
          <button onClick={openManualEntry} className="rounded-lg border border-[#d7e2f1] bg-white px-4 py-3 text-sm font-bold text-[#0b3262] shadow-sm">
            Nhập dữ liệu
          </button>
          <button onClick={() => void openFacebookBrowser()} className="rounded-lg border border-[#d7e2f1] bg-white px-4 py-3 text-sm font-bold text-[#0b3262] shadow-sm">
            Mở Facebook
          </button>
          <button onClick={() => void scanFacebookTrial()} disabled={isBrowserScanning} className="rounded-lg border border-[#d7e2f1] bg-white px-4 py-3 text-sm font-bold text-[#0b3262] shadow-sm disabled:cursor-wait disabled:opacity-60">
            {isBrowserScanning ? (facebookScanProgress ? `Đang quét ${facebookScanProgress.processed}/${facebookScanProgress.total}...` : "Đang chuẩn bị...") : "Quét toàn bộ đối thủ"}
          </button>
          <button onClick={() => void handleSync()} disabled={isSyncing} className="rounded-lg bg-[#07865f] px-4 py-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60">
            {isSyncing ? "Đang xếp hàng..." : "↻ Đồng bộ dữ liệu"}
          </button>
          <button onClick={() => void deleteVideoData()} className="rounded-lg border border-rose-200 bg-white px-4 py-3 text-sm font-bold text-rose-700 shadow-sm">
            Xoá dữ liệu video
          </button>
        </div>
      </header>
      {showManualEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <form onSubmit={(event) => void saveManualEntry(event)} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-extrabold tracking-[0.16em] text-teal-600">NHẬP THỦ CÔNG</p>
                <h2 className="mt-1 text-xl font-extrabold text-[#0b3262]">Dữ liệu video đối thủ</h2>
                <p className="mt-1 text-sm text-[#6883aa]">Dán số liệu đang hiển thị công khai trên Facebook. Không cần chờ Meta duyệt.</p>
              </div>
              <button type="button" onClick={() => setShowManualEntry(false)} className="text-xl text-[#6883aa]" aria-label="Đóng">×</button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-[#0b3262]">Channel<select value={manualChannelId} onChange={(event) => setManualChannelId(event.target.value)} className="mt-2 w-full rounded-lg border border-[#cbd9ea] px-3 py-2.5 font-normal"><option value="">Chọn Channel</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
              <label className="block text-sm font-semibold text-[#0b3262]">Đối thủ<select required value={manualVideo.competitorId} onChange={(event) => setManualVideo((current) => ({ ...current, competitorId: event.target.value }))} className="mt-2 w-full rounded-lg border border-[#cbd9ea] px-3 py-2.5 font-normal"><option value="">Chọn đối thủ</option>{manualCompetitors.map((competitor) => <option key={competitor.id} value={competitor.id}>{competitor.displayName || competitor.handle} · {competitor.platform}</option>)}</select></label>
              <label className="block text-sm font-semibold text-[#0b3262] sm:col-span-2">Link bài viết hoặc Reel<input required type="url" value={manualVideo.url} onChange={(event) => setManualVideo((current) => ({ ...current, url: event.target.value }))} placeholder="https://www.facebook.com/reel/..." className="mt-2 w-full rounded-lg border border-[#cbd9ea] px-3 py-2.5 font-normal" /></label>
              <label className="block text-sm font-semibold text-[#0b3262]">Thời gian đăng<input required type="datetime-local" value={manualVideo.publishedAt} onChange={(event) => setManualVideo((current) => ({ ...current, publishedAt: event.target.value }))} className="mt-2 w-full rounded-lg border border-[#cbd9ea] px-3 py-2.5 font-normal" /></label>
              <label className="block text-sm font-semibold text-[#0b3262]">Lượt xem<input required min="0" type="number" value={manualVideo.views} onChange={(event) => setManualVideo((current) => ({ ...current, views: event.target.value }))} className="mt-2 w-full rounded-lg border border-[#cbd9ea] px-3 py-2.5 font-normal" /></label>
              <label className="block text-sm font-semibold text-[#0b3262]">Lượt thích<input min="0" type="number" value={manualVideo.likes} onChange={(event) => setManualVideo((current) => ({ ...current, likes: event.target.value }))} className="mt-2 w-full rounded-lg border border-[#cbd9ea] px-3 py-2.5 font-normal" /></label>
              <label className="block text-sm font-semibold text-[#0b3262]">Bình luận<input min="0" type="number" value={manualVideo.comments} onChange={(event) => setManualVideo((current) => ({ ...current, comments: event.target.value }))} className="mt-2 w-full rounded-lg border border-[#cbd9ea] px-3 py-2.5 font-normal" /></label>
              <label className="block text-sm font-semibold text-[#0b3262]">Lượt chia sẻ<input min="0" type="number" value={manualVideo.shares} onChange={(event) => setManualVideo((current) => ({ ...current, shares: event.target.value }))} className="mt-2 w-full rounded-lg border border-[#cbd9ea] px-3 py-2.5 font-normal" /></label>
              <label className="block text-sm font-semibold text-[#0b3262]">Ghi chú (không bắt buộc)<input value={manualVideo.caption} onChange={(event) => setManualVideo((current) => ({ ...current, caption: event.target.value }))} className="mt-2 w-full rounded-lg border border-[#cbd9ea] px-3 py-2.5 font-normal" /></label>
            </div>
            {manualError && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{manualError}</p>}
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setShowManualEntry(false)} className="rounded-lg border border-[#cbd9ea] px-4 py-2.5 text-sm font-bold text-[#0b3262]">Hủy</button><button disabled={isSavingManual} className="rounded-lg bg-[#07865f] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{isSavingManual ? "Đang lưu..." : "Lưu và xếp hạng"}</button></div>
          </form>
        </div>
      )}
      {analysisResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-extrabold tracking-[0.16em] text-teal-600">PHÂN TÍCH VIDEO</p><h2 className="mt-1 text-xl font-extrabold text-[#0b3262]">Cơ chế tạo tín hiệu</h2></div>
              <div className="flex items-center gap-3"><button type="button" onClick={() => void copyAnalysis()} className="rounded-lg border border-[#cbd9ea] px-3 py-2 text-sm font-bold text-[#0b5799]">{analysisCopied ? "Đã sao chép" : "Sao chép phân tích"}</button><button type="button" onClick={() => setAnalysisResult(null)} className="text-xl text-[#6883aa]" aria-label="Đóng">×</button></div>
            </div>
            <div className="mt-5 space-y-4 text-sm leading-6 text-[#0b3262]">
              <AnalysisBlock label="Tóm tắt" value={analysisResult.analysis.summary} />
              <AnalysisBlock label="Hook mở đầu" value={analysisResult.analysis.hook} />
              <AnalysisBlock label="Thiết lập" value={analysisResult.analysis.setup} />
              <AnalysisBlock label="Xung đột và leo thang" value={`${analysisResult.analysis.conflict} ${analysisResult.analysis.escalation}`} />
              <AnalysisBlock label="Cú twist và kết" value={`${analysisResult.analysis.twist} ${analysisResult.analysis.payoff}`} />
              <AnalysisBlock label="Cơ chế giữ người xem" value={analysisResult.analysis.retentionMechanism} />
              <AnalysisBlock label="Vì sao hiệu quả" value={analysisResult.analysis.whyItWorks.join(" · ")} />
            </div>
            <div className="mt-6 rounded-xl border border-[#d8e3f1] bg-[#f7f9fc] p-4">
              <p className="font-extrabold text-[#0b3262]">Tạo Modeling Idea</p>
              <p className="mt-1 text-sm text-[#6883aa]">Tạo đúng 1 ý tưởng mới dựa trên cơ chế thành công của video gốc.</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex-1 text-sm font-semibold text-[#0b3262]">Phong cách mỹ thuật<select value={ideaArtStyle} onChange={(event) => setIdeaArtStyle(event.target.value)} className="mt-1 w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-2.5 font-normal"><option>Hoạt hình 3D</option><option>Hoạt hình 2D</option><option>Stop motion đất sét</option><option>Anime</option><option>Điện ảnh chân thực</option><option>Truyện tranh</option><option>Pixel art</option></select></label>
                <button type="button" onClick={() => void generateModelingIdea()} disabled={isGeneratingIdea} className="rounded-lg bg-[#07865f] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{isGeneratingIdea ? "Đang tạo ý tưởng..." : "Tạo Modeling Idea"}</button>
              </div>
              {modelingIdeaError && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{modelingIdeaError}</p>}
              {modelingIdea && <div className="mt-5 space-y-4 border-t border-[#d8e3f1] pt-4 text-sm leading-6 text-[#0b3262]"><AnalysisBlock label="Ý tưởng" value={`${modelingIdea.title}\n${modelingIdea.coreConcept}`} /><AnalysisBlock label="Kịch bản" value={modelingIdea.script} /><AnalysisBlock label="Xây dựng hình tượng nhân vật" value={modelingIdea.characterDesign} /><AnalysisBlock label="Bối cảnh" value={modelingIdea.setting} /><AnalysisBlock label="Phong cách mỹ thuật" value={modelingIdea.artStyle} /></div>}
            </div>
          </section>
        </div>
      )}
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
          <label className="block"><span className="mb-2 block text-sm text-[#6883aa]">Mức tín hiệu</span><select value={minimumViews} onChange={(event) => setMinimumViews(event.target.value)} className="w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-3 text-sm font-semibold text-[#0b3262]"><option value="20000">Từ 20.000 lượt xem</option><option value="50000">Từ 50.000 lượt xem</option><option value="100000">Từ 100.000 lượt xem</option></select></label>
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
        <p className="mt-3 text-xs leading-5 text-[#6883aa]"><strong>Mức tín hiệu</strong> lọc video theo lượt xem hiện tại: từ 20.000, 50.000 hoặc 100.000 lượt xem. Điểm lan truyền vẫn được giữ trong bảng để so sánh mức vượt chuẩn của từng video.</p>
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
          <select value={analysisFilter} onChange={(event) => setAnalysisFilter(event.target.value as typeof analysisFilter)} className="rounded-lg border border-[#cbd9ea] px-3 py-2 text-sm font-semibold text-[#0b5799]">
            <option value="all">Tất cả video</option>
            <option value="analyzed">Đã phân tích</option>
            <option value="unanalyzed">Chưa phân tích</option>
          </select>
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
              {visibleVideos.map((video) => (
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
                        {video.analysis && <p className="mt-1 text-xs font-bold text-[#07865f]">✓ Đã phân tích</p>}
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
                    <button onClick={() => video.analysis ? viewStoredAnalysis(video) : void analyzeVideo(video.id)} disabled={analyzingVideoId === video.id} className="text-xs font-bold text-[#0b5799] disabled:cursor-wait disabled:opacity-60">
                      {analyzingVideoId === video.id ? "Đang phân tích..." : video.analysis ? "Xem phân tích" : "Phân tích"}
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
        {videos.length > pageSize && <div className="mt-4 flex items-center justify-center gap-2"><button type="button" onClick={() => setVideoPage((page) => Math.max(1, page - 1))} disabled={videoPage === 1} className="rounded-lg border border-[#cbd9ea] px-3 py-2 text-sm font-bold text-[#0b5799] disabled:opacity-40">‹</button>{Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => <button type="button" key={page} onClick={() => setVideoPage(page)} className={`rounded-lg px-3 py-2 text-sm font-bold ${page === videoPage ? "bg-[#0b5799] text-white" : "border border-[#cbd9ea] text-[#0b5799]"}`}>{page}</button>)}<button type="button" onClick={() => setVideoPage((page) => Math.min(pageCount, page + 1))} disabled={videoPage === pageCount} className="rounded-lg border border-[#cbd9ea] px-3 py-2 text-sm font-bold text-[#0b5799] disabled:opacity-40">›</button></div>}
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
function AnalysisBlock({ label, value }: { label: string; value: string }) {
  return <div><p className="font-extrabold text-[#0b3262]">{label}</p><p className="mt-1 text-[#6883aa]">{value || "Chưa có dữ liệu."}</p></div>;
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
