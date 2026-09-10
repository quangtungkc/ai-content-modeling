"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";

type Dashboard = {
  channel: { id: string; name: string } | null;
  stats: { competitors: number; newVideos: number; viralVideos: number };
  videos: Array<{
    id: string;
    url: string;
    modelingVideoUrl: string | null;
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
type ChannelOption = { id: string; name: string; targetCountry?: string; language?: string; hashtags?: string | null; mainCharacterImageUrl?: string | null; mainCharacterImageName?: string };
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
type ImageSlot = { kind: "character" | "background" | "scene"; sceneNumber?: number; label: string; prompt: string; aspectRatio: string };
type VideoSlot = { sceneNumber: number; label: string; visualBlock: string; actionBlock: string; audioBlock: string; englishPrompt: string; aspectRatio: string };
type DesktopFlow = {
  runImageJob: (projectId: string, channelId: string, slots: ImageSlot[], onProgress?: (progress: { processed: number; total: number; label: string }) => void) => Promise<{ status: string; images: Record<string, string> }>;
  runVideoJob: (projectId: string, channelId: string, slots: VideoSlot[], onProgress?: (progress: { processed: number; total: number; label: string }) => void) => Promise<{ status: string; videos: Record<string, string> }>;
};
type DesktopVideoEditor = {
  pickAudio: () => Promise<{ status: "cancelled" | "selected"; path?: string; name?: string }>;
  renderFinal: (projectId: string, sceneNumbers: number[], options: VideoEditOptions, onProgress?: (progress: { stage: string; processed: number; total: number; label: string }) => void) => Promise<{ status: string; video: string }>;
};
type VideoEditScene = { sceneNumber: number; trimStart: number; trimEnd: number; duration?: number };
type VideoEditOptions = { scenes: VideoEditScene[]; transition: "none" | "fade"; transitionDuration: number; originalVolume: number; musicVolume: number; musicPath?: string };
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
type ModelingIdeaResult = { id: string; title: string; coreConcept: string; script: string; characterDesign: string; setting: string; artStyle: string; sourceMechanism: string; whatIsPreserved: string[]; whatIsChanged: string[]; targetMarketAdaptation: string; similarityRisk: "low" | "medium" | "high"; whyWorthDeveloping: string; postText: string };
type ContentProjectResult = { id: string; artDirection: Record<string, unknown>; characterDesign: Record<string, unknown>; backgroundDesign: Record<string, unknown>; scenes: Array<{ sceneNumber: number; visualBlock: string; actionBlock: string; audioBlock: string; startFramePrompt?: string | null; englishPrompt?: string | null }> };
type AutomationStep = { key: string; label: string; status: "pending" | "running" | "completed" | "failed"; detail?: string; error?: string; startedAt?: string; completedAt?: string };
type AutomationSettings = { artStyle: string; aspectRatio: "9:16" | "16:9" | "1:1" | "4:5"; postText?: string; hashtags?: string; language?: string; targetCountry?: string };
type AutomationRunResult = { id: string; status: "RUNNING" | "SUCCEEDED" | "FAILED"; steps: AutomationStep[] };
type SelectedModelingVideo = { videoId: string; modelingUrl: string; sourceUrl: string };
const accents = [
  "border-l-emerald-600",
  "border-l-teal-500",
  "border-l-orange-400",
  "border-l-blue-600",
];

// Keep prompts compatible with consumer image-generation surfaces while
// preserving the approved visual direction of existing Content Projects.
// Existing projects may have been created before that rule was added, so sanitize
// immediately before the prompt is sent instead of requiring the user to recreate a project.
function toFlowSafePrompt(prompt: string) {
  return prompt
    .replace(/\b(?:3D\s+)?Pixar(?:[-\s]style)?\b/gi, "original expressive 3D animated film style")
    .replace(/\bDisney(?:[-\s]style)?\b/gi, "original family animation style")
    .replace(/\bDreamWorks(?:[-\s]style)?\b/gi, "original stylized 3D animation style")
    .replace(/\bStudio\s+Ghibli(?:[-\s]style)?\b/gi, "original hand-painted fantasy animation style")
    .replace(/\b(?:in\s+the\s+style\s+of|style\s+of)\s+[^,.\n]+/gi, "with an original visual treatment");
}

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
  const [aspectRatio, setAspectRatio] = useState<AutomationSettings["aspectRatio"]>("9:16");
  const [contentProject, setContentProject] = useState<ContentProjectResult | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [contentProjectError, setContentProjectError] = useState("");
  const [generatedImages, setGeneratedImages] = useState<Record<string, string>>({});
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [showGeneratedImages, setShowGeneratedImages] = useState(false);
  const [flowImageSlots, setFlowImageSlots] = useState<ImageSlot[]>([]);
  const [flowImageMessage, setFlowImageMessage] = useState("");
  const [flowImageProgress, setFlowImageProgress] = useState({ processed: 0, total: 0 });
  const [generatedVideos, setGeneratedVideos] = useState<Record<string, string>>({});
  const [isGeneratingVideos, setIsGeneratingVideos] = useState(false);
  const [showGeneratedVideos, setShowGeneratedVideos] = useState(false);
  const [geminiVideoMessage, setGeminiVideoMessage] = useState("");
  const [geminiVideoProgress, setGeminiVideoProgress] = useState({ processed: 0, total: 0 });
  const [isRenderingFinalVideo, setIsRenderingFinalVideo] = useState(false);
  const [finalVideoUrl, setFinalVideoUrl] = useState("");
  const [finalVideoMessage, setFinalVideoMessage] = useState("");
  const [showVideoEditor, setShowVideoEditor] = useState(false);
  const [videoEditScenes, setVideoEditScenes] = useState<VideoEditScene[]>([]);
  const [draggingSceneNumber, setDraggingSceneNumber] = useState<number | null>(null);
  const [videoEditAudioPath, setVideoEditAudioPath] = useState("");
  const [videoEditAudioName, setVideoEditAudioName] = useState("");
  const [videoEditOriginalVolume, setVideoEditOriginalVolume] = useState(100);
  const [videoEditMusicVolume, setVideoEditMusicVolume] = useState(20);
  const [videoEditTransition, setVideoEditTransition] = useState<"none" | "fade">("fade");
  const [videoEditTransitionDuration, setVideoEditTransitionDuration] = useState(0.3);
  const [videoEditProgress, setVideoEditProgress] = useState({ stage: "", processed: 0, total: 0, label: "" });
  const [videoEditError, setVideoEditError] = useState("");
  const [analysisFilter, setAnalysisFilter] = useState<"all" | "analyzed" | "unanalyzed">("all");
  const [videoPage, setVideoPage] = useState(1);
  const [autoSyncRequested, setAutoSyncRequested] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("autoSync") === "1");
  const [manualVideo, setManualVideo] = useState({ competitorId: "", url: "", publishedAt: new Date().toISOString().slice(0, 16), views: "", likes: "0", comments: "0", shares: "0", caption: "" });
  const [executionMode, setExecutionMode] = useState<"manual" | "automatic">("manual");
  const [isAutomaticRunning, setIsAutomaticRunning] = useState(false);
  const [automationRunId, setAutomationRunId] = useState("");
  const [automationSteps, setAutomationSteps] = useState<AutomationStep[]>([]);
  const [selectedModelingVideo, setSelectedModelingVideo] = useState<SelectedModelingVideo | null>(null);
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
  async function deleteVideo(videoId: string) {
    if (!window.confirm("Xóa video gốc khỏi app, video modeling, project và lịch sử chạy liên quan? Dữ liệu này không thể khôi phục.")) return;
    setError("");
    setMessage("Đang xóa video gốc và toàn bộ video modeling liên quan...");
    try {
      const response = await fetch(`/api/v1/videos/${videoId}`, { method: "DELETE" });
      const body = await response.json() as { data?: { deletedProjects?: number }; error?: { message?: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể xóa video.");
      setDashboard((current) => {
        if (!current) return current;
        const removed = current.videos.find((video) => video.id === videoId);
        return {
          ...current,
          stats: {
            ...current.stats,
            newVideos: Math.max(0, current.stats.newVideos - (removed ? 1 : 0)),
            viralVideos: Math.max(0, current.stats.viralVideos - (removed?.score && removed.score >= 80 ? 1 : 0)),
          },
          videos: current.videos.filter((video) => video.id !== videoId),
        };
      });
      if (analysisVideoId === videoId) {
        setAnalysisVideoId("");
        setAnalysisResult(null);
        setModelingIdea(null);
        setContentProject(null);
      }
      if (selectedModelingVideo?.videoId === videoId) setSelectedModelingVideo(null);
      setMessage(`Đã xóa video gốc và ${body.data.deletedProjects ?? 0} project modeling liên quan.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thể xóa video.");
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
      setContentProject(null);
      setExecutionMode("manual");
      setAutomationRunId("");
      setAutomationSteps([]);
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
      setContentProject(null);
      setExecutionMode("manual");
      setAutomationRunId("");
      setAutomationSteps([]);
    }
  }
  async function generateModelingIdea(): Promise<ModelingIdeaResult | null> {
    if (!analysisVideoId) return null;
    setIsGeneratingIdea(true);
    setError("");
    setModelingIdeaError("");
    try {
      const response = await fetch(`/api/v1/videos/${analysisVideoId}/ideas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artStyle: ideaArtStyle }) });
      const body = await response.json() as { data?: { ideas?: ModelingIdeaResult[] }; error?: { message?: string } };
      if (!response.ok || !body.data?.ideas?.[0]) throw new Error(body.error?.message ?? "Không thể tạo Modeling Idea.");
      const idea = body.data.ideas[0];
      setModelingIdea(idea);
      setContentProject(null);
      return idea;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Không thể tạo Modeling Idea.";
      setModelingIdeaError(message);
      setError(message);
      return null;
    } finally {
      setIsGeneratingIdea(false);
    }
  }
  async function createContentProject(idea = modelingIdea): Promise<ContentProjectResult | null> {
    if (!idea?.id) return null;
    setIsCreatingProject(true);
    setContentProjectError("");
    try {
      const approveResponse = await fetch(`/api/v1/ideas/${idea.id}/approve`, { method: "POST" });
      if (!approveResponse.ok) {
        const body = await approveResponse.json() as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Không thể duyệt Modeling Idea.");
      }
      const response = await fetch(`/api/v1/ideas/${idea.id}/develop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aspectRatio }) });
      const body = await response.json() as { data?: ContentProjectResult; error?: { message?: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể tạo thiết kế và phân cảnh.");
      setContentProject(body.data);
      setGeneratedImages({});
      setFlowImageSlots([]);
      setFlowImageMessage("");
      setShowGeneratedImages(false);
      setGeneratedVideos({});
      setGeminiVideoMessage("");
      setShowGeneratedVideos(false);
      return body.data;
    } catch (caught) {
      setContentProjectError(caught instanceof Error ? caught.message : "Không thể tạo thiết kế và phân cảnh.");
      return null;
    } finally {
      setIsCreatingProject(false);
    }
  }
  function buildFlowImageSlots(project = contentProject): ImageSlot[] {
    if (!project) return [];
    const selectedChannelId = channelId || dashboard?.channel?.id || channels[0]?.id;
    const selectedChannel = channels.find((channel) => channel.id === selectedChannelId);
    const referenceInstruction = selectedChannel?.mainCharacterImageUrl
      ? `Use the attached fixed main-character reference image together with the approved background reference image to compose the scene. Preserve the exact identity, silhouette, face, colors, clothing, and proportions of the channel's recurring protagonist. Never reproduce the character reference-sheet layout, labels, poses, panels, or text. Treat the background reference as the approved environment and preserve its location, layout, lighting, and key visual landmarks. Compose the requested scene as one natural full-frame image.`
      : "No fixed main-character reference is available; keep the approved project character design consistent.";
    const backgroundPrompt = toFlowSafePrompt(`Create one single full-frame vertical background plate for this project. Use the approved background design below as the source of truth. Establish one recognizable, coherent world/location that can be reused across every scene. Preserve the requested overall space, mood, lighting, color palette, camera language, and key landmarks. Do not include any character, person, animal, prop held by a character, text, caption, logo, collage, storyboard, character sheet, contact sheet, split panel, or multiple variations. The result must be a clean empty environment that can later receive the fixed main character and scene action. Approved background design: ${JSON.stringify(project.backgroundDesign)}. Aspect ratio: 9:16. Generate exactly one final image.`);
    const sceneSlots = [...project.scenes].sort((left, right) => left.sceneNumber - right.sceneNumber).map((scene) => {
      const startFramePrompt = scene.startFramePrompt?.trim() || `Create one single full-frame vertical 9:16 still image showing the exact starting state of scene ${scene.sceneNumber}. Preserve the approved main character, background, composition, lighting, and initial pose. Do not show motion, a collage, a storyboard, text, or multiple variations.`;
      return {
        kind: "scene" as const,
        sceneNumber: scene.sceneNumber,
        label: `Ảnh bắt đầu cảnh ${scene.sceneNumber}`,
        aspectRatio: "9:16",
        prompt: toFlowSafePrompt(`${referenceInstruction}\nThis is the separate start-frame image prompt for scene ${scene.sceneNumber}. Create exactly one frozen full-frame vertical image by combining the attached fixed main-character reference image and the attached approved background reference image. The character image and background image are inputs for this one image, not separate panels. Do not create a collage, storyboard, character sheet, contact sheet, split panel, multiple variations, captions, labels, written text, or motion blur.\nStart-frame prompt written by Gemini:\n${startFramePrompt}\nVisual setup: ${scene.visualBlock}\nKeep the approved fixed main character, approved background, lighting, key props, and art direction consistent with the project. Show the exact frozen state before the 4-second action begins; do not depict later action beats. Aspect ratio: 9:16. Generate exactly one final image.`),
      };
    });
    return [{ kind: "background", sceneNumber: 0, label: "Bối cảnh đồng nhất", aspectRatio: "9:16", prompt: backgroundPrompt }, ...sceneSlots];
  }
  async function generateAllProjectImages(project = contentProject): Promise<Record<string, string> | null> {
    if (!project) return null;
    setIsGeneratingImages(true);
    setContentProjectError("");
    try {
      const slots = buildFlowImageSlots(project);
      const flow = (window as Window & { desktopFlow?: DesktopFlow }).desktopFlow;
      if (!flow) throw new Error("Tính năng này chỉ dùng trong ứng dụng Modeling AI trên máy tính.");
      const selectedChannelId = channelId || dashboard?.channel?.id || channels[0]?.id;
      if (!selectedChannelId) throw new Error("Hãy chọn kênh trước khi tạo ảnh.");
      setFlowImageSlots(slots);
      setFlowImageProgress({ processed: 0, total: slots.length });
      const result = await flow.runImageJob(project.id, selectedChannelId, slots, (progress) => { setFlowImageProgress({ processed: progress.processed, total: progress.total }); setFlowImageMessage(`Đang tạo ${progress.label} — ${progress.processed}/${progress.total}`); });
      setGeneratedImages(result.images);
      setShowGeneratedImages(true);
      setFlowImageMessage("Đã tạo và đưa toàn bộ ảnh từ Google Flow vào app theo đúng thứ tự.");
      return result.images;
    } catch (caught) { setContentProjectError(caught instanceof Error ? caught.message : "Không thể tạo ảnh bằng Google Flow."); return null; }
    finally { setIsGeneratingImages(false); }
  }
  async function generateAllProjectVideos(project = contentProject, images = generatedImages): Promise<Record<string, string> | null> {
    if (!project) return null;
    const sceneSlots: VideoSlot[] = project.scenes.map((scene) => ({
      sceneNumber: scene.sceneNumber,
      label: `Video cảnh ${scene.sceneNumber}`,
      visualBlock: scene.visualBlock,
      actionBlock: scene.actionBlock,
      audioBlock: scene.audioBlock,
      englishPrompt: scene.englishPrompt?.trim() || `Create one 4-second video starting from the approved start image for scene ${scene.sceneNumber}. Preserve the character, background, composition, story meaning, and ending, and animate only the specified primary action with synchronized sound.`,
      aspectRatio,
    }));
    if (!images["background-0"] || sceneSlots.some((scene) => !images[`scene-${scene.sceneNumber}`])) {
      setContentProjectError("Hãy tạo bối cảnh đồng nhất và đầy đủ ảnh phân cảnh trước khi tạo video.");
      return null;
    }
    setIsGeneratingVideos(true);
    setContentProjectError("");
    setGeminiVideoProgress({ processed: 0, total: sceneSlots.length });
    setGeminiVideoMessage("Đang mở Google Flow...");
    try {
      const flow = (window as Window & { desktopFlow?: DesktopFlow }).desktopFlow;
      if (!flow) throw new Error("Tính năng này chỉ dùng trong ứng dụng Modeling AI trên máy tính.");
      const selectedChannelId = channelId || dashboard?.channel?.id || channels[0]?.id;
      if (!selectedChannelId) throw new Error("Hãy chọn kênh trước khi tạo video.");
      const result = await flow.runVideoJob(project.id, selectedChannelId, sceneSlots, (progress) => {
        setGeminiVideoProgress({ processed: progress.processed, total: progress.total });
        setGeminiVideoMessage(`Đang tạo ${progress.label} — ${progress.processed}/${progress.total}`);
      });
      setGeneratedVideos(result.videos);
      setShowGeneratedVideos(true);
      setGeminiVideoMessage("Đã tạo và lưu toàn bộ video 4 giây theo đúng thứ tự phân cảnh.");
      return result.videos;
    } catch (caught) {
      setContentProjectError(caught instanceof Error ? caught.message : "Không thể tạo video bằng Google Flow.");
      return null;
    } finally {
      setIsGeneratingVideos(false);
    }
  }
  function defaultVideoEditScenes(project: ContentProjectResult): VideoEditScene[] {
    return project.scenes.map((scene) => ({ sceneNumber: scene.sceneNumber, trimStart: 0, trimEnd: 0 }));
  }
  function openVideoEditor(project = contentProject) {
    if (!project) return;
    const defaults = defaultVideoEditScenes(project);
    setVideoEditScenes((current) => current.length === defaults.length && current.every((scene, index) => scene.sceneNumber === defaults[index].sceneNumber) ? current : defaults);
    setVideoEditError("");
    setShowVideoEditor(true);
  }
  function updateVideoEditScene(sceneNumber: number, patch: Partial<VideoEditScene>) {
    setVideoEditScenes((current) => current.map((scene) => scene.sceneNumber === sceneNumber ? { ...scene, ...patch } : scene));
  }
  function handleVideoEditDrop(event: DragEvent<HTMLDivElement>, targetSceneNumber: number) {
    event.preventDefault();
    if (draggingSceneNumber === null || draggingSceneNumber === targetSceneNumber) return;
    setVideoEditScenes((current) => {
      const sourceIndex = current.findIndex((scene) => scene.sceneNumber === draggingSceneNumber);
      const targetIndex = current.findIndex((scene) => scene.sceneNumber === targetSceneNumber);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const reordered = [...current];
      const [moved] = reordered.splice(sourceIndex, 1);
      reordered.splice(targetIndex, 0, moved);
      return reordered;
    });
    setDraggingSceneNumber(null);
  }
  async function chooseVideoEditAudio() {
    try {
      const editor = (window as Window & { desktopVideoEditor?: DesktopVideoEditor }).desktopVideoEditor;
      if (!editor) throw new Error("Tính năng này chỉ dùng trong ứng dụng Modeling AI trên máy tính.");
      const result = await editor.pickAudio();
      if (result.status === "selected" && result.path) {
        setVideoEditAudioPath(result.path);
        setVideoEditAudioName(result.name ?? result.path.split(/[\\/]/).pop() ?? "Tệp âm thanh");
        setVideoEditError("");
      }
    } catch (caught) {
      setVideoEditError(caught instanceof Error ? caught.message : "Không thể chọn tệp âm thanh.");
    }
  }
  async function renderFinalProjectVideo(project = contentProject, videos = generatedVideos, editOptions?: VideoEditOptions): Promise<string | null> {
    if (!project) return null;
    const scenes = editOptions?.scenes?.length ? editOptions.scenes : videoEditScenes.length ? videoEditScenes : defaultVideoEditScenes(project);
    const sceneNumbers = scenes.map((scene) => scene.sceneNumber);
    if (sceneNumbers.some((sceneNumber) => !videos[`scene-${sceneNumber}`])) {
      setContentProjectError("Hãy tạo đầy đủ video phân cảnh trước khi ghép.");
      return null;
    }
    const options: VideoEditOptions = {
      scenes: scenes.map((scene) => ({ sceneNumber: scene.sceneNumber, trimStart: scene.trimStart, trimEnd: scene.trimEnd })),
      transition: editOptions?.transition ?? videoEditTransition,
      transitionDuration: editOptions?.transitionDuration ?? videoEditTransitionDuration,
      originalVolume: (editOptions?.originalVolume ?? videoEditOriginalVolume) / 100,
      musicVolume: (editOptions?.musicVolume ?? videoEditMusicVolume) / 100,
      musicPath: editOptions?.musicPath ?? (videoEditAudioPath || undefined),
    };
    setIsRenderingFinalVideo(true);
    setContentProjectError("");
    setVideoEditError("");
    setFinalVideoUrl("");
    setFinalVideoMessage("Đang chuẩn bị ghép và edit video...");
    setVideoEditProgress({ stage: "prepare", processed: 0, total: 1, label: "Đang chuẩn bị ghép và edit video..." });
    try {
      const editor = (window as Window & { desktopVideoEditor?: DesktopVideoEditor }).desktopVideoEditor;
      if (!editor) throw new Error("Tính năng này chỉ dùng trong ứng dụng Modeling AI trên máy tính.");
      const result = await editor.renderFinal(project.id, sceneNumbers, options, (progress) => {
        setVideoEditProgress(progress);
        setFinalVideoMessage(progress.label);
      });
      setFinalVideoUrl(result.video);
      setFinalVideoMessage("Đã ghép và xuất video hoàn chỉnh 9:16, 720p, 30fps.");
      return result.video;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Không thể ghép và edit video.";
      setVideoEditError(`${message} Bạn có thể bấm chạy lại.`);
      setContentProjectError(message);
      return null;
    } finally {
      setIsRenderingFinalVideo(false);
    }
  }
  function createAutomationSteps(): AutomationStep[] {
    return [
      { key: "modeling-idea", label: "Tạo Modeling Idea", status: "pending" },
      { key: "content-project", label: "Tạo Content Project và phân cảnh", status: "pending" },
      { key: "images", label: "Tạo toàn bộ ảnh bằng Google Flow", status: "pending" },
      { key: "videos", label: "Tạo video theo từng phân cảnh bằng Google Flow", status: "pending" },
      { key: "final-video", label: "Ghép và xuất video hoàn chỉnh", status: "pending" },
    ];
  }
  async function createAutomationRun(settings: AutomationSettings, steps: AutomationStep[]): Promise<AutomationRunResult> {
    const response = await fetch("/api/v1/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceVideoId: analysisVideoId, settings, steps }) });
    const body = await response.json() as { data?: AutomationRunResult; error?: { message?: string } };
    if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể tạo phiên chạy tự động.");
    return body.data;
  }
  async function updateAutomationRun(runId: string, steps: AutomationStep[], fields: { status?: "RUNNING" | "SUCCEEDED" | "FAILED"; ideaId?: string; projectId?: string; error?: string | null; settings?: AutomationSettings } = {}) {
    const response = await fetch("/api/v1/automations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: runId, steps, ...fields }) });
    const body = await response.json() as { data?: AutomationRunResult; error?: { message?: string } };
    if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể cập nhật lịch sử chạy.");
    return body.data;
  }
  async function runAutomaticPipeline() {
    if (!analysisVideoId || isAutomaticRunning) return;
    const settings: AutomationSettings = { artStyle: ideaArtStyle.trim() || "Hoạt hình 3D", aspectRatio };
    let currentSteps = createAutomationSteps();
    let runId = "";
    let activeStep = "";
    setExecutionMode("automatic");
    setIsAutomaticRunning(true);
    setAutomationSteps(currentSteps);
    setAutomationRunId("");
    setContentProjectError("");
    setError("");
    try {
      const run = await createAutomationRun(settings, currentSteps);
      runId = run.id;
      setAutomationRunId(runId);
      const changeStep = async (key: string, status: AutomationStep["status"], detail?: string, stepError?: string) => {
        const timestamp = new Date().toISOString();
        currentSteps = currentSteps.map((step) => step.key === key
          ? { ...step, status, ...(detail ? { detail } : {}), ...(stepError ? { error: stepError } : {}), ...(status === "running" ? { startedAt: timestamp } : {}), ...(status === "completed" || status === "failed" ? { completedAt: timestamp } : {}) }
          : step);
        setAutomationSteps(currentSteps);
        await updateAutomationRun(runId, currentSteps);
      };
      activeStep = "modeling-idea";
      await changeStep(activeStep, "running", "Đang tạo một Modeling Idea từ kết quả phân tích...");
      const idea = await generateModelingIdea();
      if (!idea) throw new Error("Không tạo được Modeling Idea.");
      await changeStep(activeStep, "completed", `Đã tạo: ${idea.title}`);
      const selectedChannelId = channelId || dashboard?.channel?.id || channels[0]?.id;
      const selectedChannel = channels.find((channel) => channel.id === selectedChannelId);
      const publishingSettings: AutomationSettings = {
        ...settings,
        postText: idea.postText,
        hashtags: selectedChannel?.hashtags?.trim() ?? "",
        language: selectedChannel?.language ?? "",
        targetCountry: selectedChannel?.targetCountry ?? "",
      };
      await updateAutomationRun(runId, currentSteps, { ideaId: idea.id, settings: publishingSettings });

      activeStep = "content-project";
      await changeStep(activeStep, "running", "Đang phát triển ý tưởng thành Content Project...");
      const project = await createContentProject(idea);
      if (!project) throw new Error("Không tạo được Content Project và phân cảnh.");
      await changeStep(activeStep, "completed", `Đã tạo ${project.scenes.length} phân cảnh.`);
      await updateAutomationRun(runId, currentSteps, { projectId: project.id, ideaId: idea.id });

      activeStep = "images";
      await changeStep(activeStep, "running", "Đang mở Google Flow và tạo ảnh...");
      const images = await generateAllProjectImages(project);
      if (!images) throw new Error("Không tạo đủ ảnh bằng Google Flow.");
      await changeStep(activeStep, "completed", `Đã tạo ${Object.keys(images).length} ảnh và lưu vào app.`);

      activeStep = "videos";
      await changeStep(activeStep, "running", "Đang tạo video cho từng phân cảnh...");
      const videos = await generateAllProjectVideos(project, images);
      if (!videos) throw new Error("Không tạo đủ video phân cảnh bằng Google Flow.");
      await changeStep(activeStep, "completed", `Đã tạo ${Object.keys(videos).length} video phân cảnh.`);

      activeStep = "final-video";
      await changeStep(activeStep, "running", "Đang ghép video hoàn chỉnh...");
      const finalVideo = await renderFinalProjectVideo(project, videos);
      if (!finalVideo) throw new Error("Không xuất được video hoàn chỉnh.");
      await changeStep(activeStep, "completed", "Đã nhận video hoàn chỉnh và lưu vào app.");
      await updateAutomationRun(runId, currentSteps, { status: "SUCCEEDED", ideaId: idea.id, projectId: project.id, error: null });
      setMessage("Đã chạy tự động toàn bộ quy trình và tạo video hoàn chỉnh. Có thể xem lại tại Lịch sử hoạt động.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Quy trình tự động không hoàn tất.";
      setContentProjectError(message);
      setError(message);
      if (runId) {
        try {
          const timestamp = new Date().toISOString();
          currentSteps = currentSteps.map((step) => step.key === activeStep && step.status !== "completed" ? { ...step, status: "failed", error: message, completedAt: timestamp } : step);
          setAutomationSteps(currentSteps);
          await updateAutomationRun(runId, currentSteps, { status: "FAILED", error: message });
        } catch {
          setError(`${message} Không thể lưu đầy đủ lịch sử hoạt động.`);
        }
      }
    } finally {
      setIsAutomaticRunning(false);
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
            <div className="mt-6 rounded-xl border border-violet-200 bg-violet-50 p-4">
              <p className="font-extrabold text-[#0b3262]">Thiết lập triển khai</p>
              <p className="mt-1 text-sm text-[#6883aa]">Chọn cài đặt trước, sau đó chạy từng bước hoặc để app tự chạy đến video hoàn chỉnh.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold text-[#0b3262]">Phong cách mỹ thuật<select value={ideaArtStyle} onChange={(event) => setIdeaArtStyle(event.target.value)} disabled={isAutomaticRunning} className="mt-1 w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-2.5 font-normal"><option>Hoạt hình 3D</option><option>Hoạt hình 2D</option><option>Stop motion đất sét</option><option>Anime</option><option>Điện ảnh chân thực</option><option>Truyện tranh</option><option>Pixel art</option></select></label>
                <label className="text-sm font-semibold text-[#0b3262]">Kích thước khung hình<select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AutomationSettings["aspectRatio"])} disabled={isAutomaticRunning} className="mt-1 w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-2.5 font-normal"><option value="9:16">9:16 · Dọc</option><option value="16:9">16:9 · Ngang</option><option value="1:1">1:1 · Vuông</option><option value="4:5">4:5 · Dọc mạng xã hội</option></select></label>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" onClick={() => { setExecutionMode("manual"); setMessage("Đã chọn chạy thủ công. Thực hiện từng bước bên dưới."); }} disabled={isAutomaticRunning} className={`rounded-lg px-4 py-2.5 text-sm font-bold ${executionMode === "manual" ? "bg-[#0b5799] text-white" : "border border-[#cbd9ea] bg-white text-[#0b3262]"}`}>Chạy thủ công</button>
                <button type="button" onClick={() => void runAutomaticPipeline()} disabled={isAutomaticRunning} className="rounded-lg bg-[#7c3aed] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60">{isAutomaticRunning ? "Đang chạy tự động..." : "Chạy tự động đến video hoàn chỉnh"}</button>
              </div>
              {automationSteps.length > 0 && <div className="mt-4 space-y-2 rounded-lg border border-violet-200 bg-white p-3">{automationSteps.map((step) => <div key={step.key} className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold text-[#0b3262]">{step.label}</span><span className={step.status === "completed" ? "font-bold text-emerald-700" : step.status === "failed" ? "font-bold text-rose-700" : step.status === "running" ? "font-bold text-amber-700" : "text-[#7990b0]"}>{step.status === "completed" ? "Đã xong" : step.status === "failed" ? "Lỗi" : step.status === "running" ? "Đang chạy" : "Chờ chạy"}</span></div>)}</div>}
              {automationRunId && <p className="mt-2 text-xs text-[#7990b0]">Mã phiên: {automationRunId}. Có thể xem lại tại Lịch sử hoạt động.</p>}
            </div>
            <div className="mt-6 rounded-xl border border-[#d8e3f1] bg-[#f7f9fc] p-4">
              <p className="font-extrabold text-[#0b3262]">Tạo Modeling Idea</p>
              <p className="mt-1 text-sm text-[#6883aa]">Tạo đúng 1 ý tưởng mới dựa trên cơ chế thành công của video gốc.</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex-1 text-sm font-semibold text-[#0b3262]">Phong cách mỹ thuật<select value={ideaArtStyle} onChange={(event) => setIdeaArtStyle(event.target.value)} className="mt-1 w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-2.5 font-normal"><option>Hoạt hình 3D</option><option>Hoạt hình 2D</option><option>Stop motion đất sét</option><option>Anime</option><option>Điện ảnh chân thực</option><option>Truyện tranh</option><option>Pixel art</option></select></label>
                <button type="button" onClick={() => void generateModelingIdea()} disabled={isGeneratingIdea || isAutomaticRunning} className="rounded-lg bg-[#07865f] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{isGeneratingIdea ? "Đang tạo ý tưởng..." : "Tạo Modeling Idea"}</button>
              </div>
              {modelingIdeaError && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{modelingIdeaError}</p>}
              {modelingIdea && <div className="mt-5 space-y-4 border-t border-[#d8e3f1] pt-4 text-sm leading-6 text-[#0b3262]"><AnalysisBlock label="Ý tưởng" value={`${modelingIdea.title}\n${modelingIdea.coreConcept}`} /><AnalysisBlock label="Kịch bản" value={modelingIdea.script} /><AnalysisBlock label="Xây dựng hình tượng nhân vật" value={modelingIdea.characterDesign} /><AnalysisBlock label="Bối cảnh" value={modelingIdea.setting} /><AnalysisBlock label="Phong cách mỹ thuật" value={modelingIdea.artStyle} />
                 <div className="rounded-xl border border-[#d8e3f1] bg-[#f7f9fc] p-4"><p className="font-extrabold text-[#0b3262]">Tạo hình và phân cảnh</p><p className="mt-1 text-sm text-[#6883aa]">Giữ nhân vật và bối cảnh đồng nhất trong toàn bộ video.</p><div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"><label className="flex-1 text-sm font-semibold text-[#0b3262]">Kích thước khung hình<select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AutomationSettings["aspectRatio"])} disabled={isAutomaticRunning} className="mt-1 w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-2.5 font-normal"><option value="9:16">9:16 · Dọc</option><option value="16:9">16:9 · Ngang</option><option value="1:1">1:1 · Vuông</option><option value="4:5">4:5 · Dọc mạng xã hội</option></select></label><button type="button" onClick={() => void createContentProject()} disabled={isCreatingProject || isAutomaticRunning} className="rounded-lg bg-[#0b5799] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{isCreatingProject ? "Đang tạo..." : "Tạo hình tượng & phân cảnh"}</button></div>{contentProjectError && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{contentProjectError}</p>}{contentProject && <div className="mt-5 space-y-4 border-t border-[#d8e3f1] pt-4"><AnalysisBlock label="Thiết kế nhân vật đồng nhất" value={JSON.stringify(contentProject.characterDesign, null, 2)} /><AnalysisBlock label="Bối cảnh đồng nhất" value={JSON.stringify(contentProject.backgroundDesign, null, 2)} /><AnalysisBlock label="Khung hình" value={String(contentProject.artDirection.aspectRatio ?? aspectRatio)} /><div><p className="font-extrabold text-[#0b3262]">Các phân cảnh</p><div className="mt-2 space-y-3">{contentProject.scenes.map((scene) => <div key={scene.sceneNumber} className="rounded-lg border border-[#d8e3f1] bg-white p-3"><p className="font-bold text-[#0b5799]">Cảnh {scene.sceneNumber}</p><p className="mt-1"><strong>Hình ảnh:</strong> {scene.visualBlock}</p><p className="mt-1"><strong>Hành động:</strong> {scene.actionBlock}</p><p className="mt-1"><strong>Âm thanh:</strong> {scene.audioBlock}</p><p className="mt-1"><strong>Prompt ảnh bắt đầu:</strong> {scene.startFramePrompt ?? "Chưa có; app sẽ dùng prompt dự phòng cho ảnh bắt đầu."}</p><p className="mt-1"><strong>Prompt video 4 giây:</strong> {scene.englishPrompt ?? "Chưa có; app sẽ dùng prompt dự phòng cho video."}</p></div>)}</div></div></div>}</div>
              </div>}
              {contentProject && <div className="mt-4 space-y-3">
                <button type="button" onClick={() => void generateAllProjectImages()} disabled={isGeneratingImages || isAutomaticRunning} className="rounded-lg bg-[#0b5799] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{isGeneratingImages ? `Đang tạo ảnh ${flowImageProgress.processed}/${flowImageProgress.total}...` : "Tự động tạo toàn bộ ảnh bằng Google Flow"}</button>
                {flowImageSlots.length > 0 && <div className="rounded-xl border border-[#d8e3f1] bg-[#f7f9fc] p-4"><p className="font-extrabold text-[#0b3262]">Quy trình Google Flow</p><p className="mt-1 text-sm leading-6 text-[#6883aa]">App tạo bối cảnh đồng nhất trước, sau đó mỗi ảnh cảnh dùng lần lượt ảnh nhân vật chính và ảnh bối cảnh làm tham chiếu. Mỗi ảnh được tạo và tải về thành công rồi mới chuyển sang bước tiếp theo.</p>{flowImageMessage && <p className="mt-2 text-sm font-semibold text-[#0b5799]">{flowImageMessage}</p>}<p className="mt-2 text-xs text-[#6883aa]">Nếu lần đầu dùng, hãy đăng nhập Google Flow trong cửa sổ mở ra. Không xử lý CAPTCHA tự động.</p></div>}
                {Object.keys(generatedImages).length > 0 && <button type="button" onClick={() => setShowGeneratedImages((visible) => !visible)} className="ml-2 rounded-lg border border-[#0b5799] px-4 py-2.5 text-sm font-bold text-[#0b5799]">{showGeneratedImages ? "Ẩn ảnh" : "Xem ảnh"}</button>}
                {showGeneratedImages && <div className="mt-4 grid gap-4 sm:grid-cols-2">{generatedImages["character-0"] && <figure><img src={generatedImages["character-0"]} alt="Hình tượng nhân vật" className="w-full rounded-lg border border-[#d8e3f1]" /><figcaption className="mt-1 text-sm font-semibold">Nhân vật</figcaption></figure>}{generatedImages["background-0"] && <figure><img src={generatedImages["background-0"]} alt="Bối cảnh đồng nhất" className="w-full rounded-lg border border-[#d8e3f1]" /><figcaption className="mt-1 text-sm font-semibold">Bối cảnh</figcaption></figure>}{contentProject.scenes.map((scene) => generatedImages[`scene-${scene.sceneNumber}`] && <figure key={`image-${scene.sceneNumber}`}><img src={generatedImages[`scene-${scene.sceneNumber}`]} alt={`Ảnh cảnh ${scene.sceneNumber}`} className="w-full rounded-lg border border-[#d8e3f1]" /><figcaption className="mt-1 text-sm font-semibold">Cảnh {scene.sceneNumber}</figcaption></figure>)}</div>}
              </div>}
              {contentProject && contentProject.scenes.every((scene) => generatedImages[`scene-${scene.sceneNumber}`]) && (
                <div className="mt-5 border-t border-[#d8e3f1] pt-4">
                   <button type="button" onClick={() => void generateAllProjectVideos()} disabled={isGeneratingVideos || isAutomaticRunning} className="rounded-lg bg-[#7c3aed] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">
                    {isGeneratingVideos ? `Đang tạo video ${geminiVideoProgress.processed}/${geminiVideoProgress.total}...` : "Tạo toàn bộ video theo phân cảnh"}
                  </button>
                  {geminiVideoMessage && <p className="mt-2 text-sm font-semibold text-[#6d28d9]">{geminiVideoMessage}</p>}
                  {Object.keys(generatedVideos).length > 0 && <button type="button" onClick={() => setShowGeneratedVideos((visible) => !visible)} className="ml-2 rounded-lg border border-[#7c3aed] px-4 py-2.5 text-sm font-bold text-[#6d28d9]">{showGeneratedVideos ? "Ẩn video" : "Xem video"}</button>}
                  {contentProject.scenes.every((scene) => generatedVideos[`scene-${scene.sceneNumber}`]) && <>
                    <button type="button" onClick={() => showVideoEditor ? setShowVideoEditor(false) : openVideoEditor()} disabled={isAutomaticRunning} className="ml-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{showVideoEditor ? "Ẩn trình edit video" : "Ghép & Edit video"}</button>
                    {showVideoEditor && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div><p className="font-extrabold text-[#0b3262]">Ghép & Edit video</p><p className="mt-1 text-sm leading-6 text-[#6883aa]">Kéo thả để đổi thứ tự. Âm thanh gốc từ Google Flow luôn được giữ lại; nhạc nền hoặc hiệu ứng chỉ là lớp trộn thêm.</p></div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-700">{videoEditScenes.length} cảnh</span>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <label className="text-sm font-semibold text-[#0b3262]">Chuyển cảnh<select value={videoEditTransition} onChange={(event) => setVideoEditTransition(event.target.value as "none" | "fade")} disabled={isRenderingFinalVideo} className="mt-1 w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-2.5 font-normal"><option value="fade">Fade mềm</option><option value="none">Không chuyển cảnh</option></select></label>
                        <label className="text-sm font-semibold text-[#0b3262]">Thời lượng chuyển cảnh<select value={videoEditTransitionDuration} onChange={(event) => setVideoEditTransitionDuration(Number(event.target.value))} disabled={isRenderingFinalVideo || videoEditTransition === "none"} className="mt-1 w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-2.5 font-normal"><option value="0.2">0,2 giây</option><option value="0.3">0,3 giây</option><option value="0.4">0,4 giây</option></select></label>
                        <div className="flex items-end"><button type="button" onClick={() => void chooseVideoEditAudio()} disabled={isRenderingFinalVideo} className="w-full rounded-lg border border-[#0b5799] bg-white px-3 py-2.5 text-sm font-bold text-[#0b5799]">{videoEditAudioName ? "Đổi nhạc / hiệu ứng" : "Thêm nhạc / hiệu ứng"}</button></div>
                      </div>
                      {videoEditAudioName && <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm text-[#0b3262]"><span className="truncate">Âm thanh thêm: <strong>{videoEditAudioName}</strong></span><button type="button" onClick={() => { setVideoEditAudioPath(""); setVideoEditAudioName(""); }} disabled={isRenderingFinalVideo} className="shrink-0 font-bold text-rose-600">Bỏ chọn</button></div>}
                      <div className="mt-4 grid gap-4 rounded-lg border border-emerald-100 bg-white p-3 sm:grid-cols-2">
                        <label className="text-sm font-semibold text-[#0b3262]">Âm thanh gốc Flow: {videoEditOriginalVolume}%<input type="range" min="0" max="200" step="5" value={videoEditOriginalVolume} onChange={(event) => setVideoEditOriginalVolume(Number(event.target.value))} disabled={isRenderingFinalVideo} className="mt-2 w-full" /></label>
                        <label className="text-sm font-semibold text-[#0b3262]">Âm lượng nhạc / hiệu ứng: {videoEditMusicVolume}%<input type="range" min="0" max="200" step="5" value={videoEditMusicVolume} onChange={(event) => setVideoEditMusicVolume(Number(event.target.value))} disabled={isRenderingFinalVideo || !videoEditAudioPath} className="mt-2 w-full" /></label>
                      </div>
                      <div className="mt-4 space-y-3">
                        {videoEditScenes.map((scene, index) => {
                          const availableDuration = scene.duration ?? 0;
                          const maxStart = availableDuration > 0 ? Math.max(0, availableDuration - scene.trimEnd - 0.1) : 3600;
                          const maxEnd = availableDuration > 0 ? Math.max(0, availableDuration - scene.trimStart - 0.1) : 3600;
                          return <div key={scene.sceneNumber} draggable={!isRenderingFinalVideo} onDragStart={() => setDraggingSceneNumber(scene.sceneNumber)} onDragEnd={() => setDraggingSceneNumber(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => handleVideoEditDrop(event, scene.sceneNumber)} className={`rounded-lg border bg-white p-3 ${draggingSceneNumber === scene.sceneNumber ? "border-emerald-500 opacity-60" : "border-[#d8e3f1]"}`}>
                            <div className="flex items-center justify-between gap-3"><p className="font-bold text-[#0b5799]">☷ Cảnh {index + 1} · Phân cảnh {scene.sceneNumber}</p><span className="text-xs font-semibold text-[#7990b0]">Kéo để sắp xếp</span></div>
                            <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr]">
                              <video controls preload="metadata" src={generatedVideos[`scene-${scene.sceneNumber}`]} onLoadedMetadata={(event) => { const duration = event.currentTarget.duration; if (Number.isFinite(duration) && duration > 0 && scene.duration !== duration) updateVideoEditScene(scene.sceneNumber, { duration }); }} className="aspect-video w-full rounded-lg border border-[#d8e3f1] bg-black object-contain" />
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="text-sm font-semibold text-[#0b3262]">Cắt đầu (giây)<input type="number" min="0" max={maxStart} step="0.1" value={scene.trimStart} onChange={(event) => updateVideoEditScene(scene.sceneNumber, { trimStart: Math.max(0, Number(event.target.value) || 0) })} disabled={isRenderingFinalVideo} className="mt-1 w-full rounded-lg border border-[#cbd9ea] px-3 py-2.5 font-normal" /></label>
                                <label className="text-sm font-semibold text-[#0b3262]">Cắt cuối (giây)<input type="number" min="0" max={maxEnd} step="0.1" value={scene.trimEnd} onChange={(event) => updateVideoEditScene(scene.sceneNumber, { trimEnd: Math.max(0, Number(event.target.value) || 0) })} disabled={isRenderingFinalVideo} className="mt-1 w-full rounded-lg border border-[#cbd9ea] px-3 py-2.5 font-normal" /></label>
                                <p className="text-xs leading-5 text-[#7990b0] sm:col-span-2">Cắt cuối được tính từ cuối video. Thời lượng gốc: {availableDuration > 0 ? `${availableDuration.toFixed(1)} giây` : "đang đọc..."}.</p>
                              </div>
                            </div>
                          </div>;
                        })}
                      </div>
                      {videoEditProgress.total > 0 && <div className="mt-4 rounded-lg bg-white p-3"><div className="flex justify-between gap-3 text-sm font-semibold text-[#0b3262]"><span>{videoEditProgress.label}</span><span>{videoEditProgress.total > 0 ? Math.round((videoEditProgress.processed / videoEditProgress.total) * 100) : 0}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[#d8e3f1]"><div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${Math.min(100, Math.max(0, videoEditProgress.total > 0 ? (videoEditProgress.processed / videoEditProgress.total) * 100 : 0))}%` }} /></div></div>}
                      {videoEditError && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{videoEditError}</p>}
                      <div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={() => void renderFinalProjectVideo()} disabled={isRenderingFinalVideo || isAutomaticRunning} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60">{isRenderingFinalVideo ? "Đang xuất video..." : videoEditError ? "Chạy lại xuất video" : "Xuất video hoàn chỉnh"}</button><span className="text-xs text-[#6883aa]">Video sẽ xuất ở 720p, khung 9:16, 30fps.</span></div>
                    </div>}
                  </>}
                  {finalVideoMessage && <p className="mt-2 text-sm font-semibold text-emerald-700">{finalVideoMessage}</p>}
                  {finalVideoUrl && <figure className="mt-4 max-w-md"><video controls preload="metadata" src={finalVideoUrl} className="w-full rounded-lg border border-emerald-200" /><figcaption className="mt-1 text-sm font-semibold">Video hoàn chỉnh</figcaption></figure>}
                  {showGeneratedVideos && <div className="mt-4 grid gap-4 sm:grid-cols-2">{contentProject.scenes.map((scene) => generatedVideos[`scene-${scene.sceneNumber}`] && <figure key={`video-${scene.sceneNumber}`}><video controls preload="metadata" src={generatedVideos[`scene-${scene.sceneNumber}`]} className="w-full rounded-lg border border-[#d8e3f1]" /><figcaption className="mt-1 text-sm font-semibold">Video cảnh {scene.sceneNumber}</figcaption></figure>)}</div>}
                </div>
              )}
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
                    {video.modelingVideoUrl && (
                      <button
                        type="button"
                        onClick={() => setSelectedModelingVideo({ videoId: video.id, modelingUrl: video.modelingVideoUrl ?? "", sourceUrl: video.url })}
                        className="mr-4 text-xs font-bold text-[#7c3aed]"
                      >
                        Video modeling
                      </button>
                    )}
                    <button onClick={() => video.analysis ? viewStoredAnalysis(video) : void analyzeVideo(video.id)} disabled={analyzingVideoId === video.id} className="text-xs font-bold text-[#0b5799] disabled:cursor-wait disabled:opacity-60">
                      {analyzingVideoId === video.id ? "Đang phân tích..." : video.analysis ? "Xem phân tích" : "Phân tích"}
                    </button>
                    <button type="button" onClick={() => void deleteVideo(video.id)} className="ml-4 text-xs font-bold text-rose-600">Xóa</button>
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
      {selectedModelingVideo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedModelingVideo(null);
          }}
        >
          <section role="dialog" aria-modal="true" aria-label="Video modeling" className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-extrabold tracking-[0.16em] text-violet-600">VIDEO MODELING</p>
                <h2 className="mt-1 text-xl font-extrabold text-[#0b3262]">Video modeling đã hoàn thiện</h2>
              </div>
              <button type="button" onClick={() => setSelectedModelingVideo(null)} className="text-xl text-[#6883aa]" aria-label="Đóng">×</button>
            </div>
            <video controls autoPlay preload="metadata" src={selectedModelingVideo.modelingUrl} className="mt-5 max-h-[70vh] w-full rounded-lg bg-black" />
            <div className="mt-4 flex flex-wrap justify-end gap-3">
              <a href={selectedModelingVideo.sourceUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-300 px-4 py-2.5 text-sm font-bold text-emerald-700">Mở video gốc</a>
              <a
                href={withDownloadFlag(selectedModelingVideo.modelingUrl)}
                download="video-modeling.mp4"
                className="rounded-lg bg-[#7c3aed] px-4 py-2.5 text-sm font-bold text-white"
              >
                Tải video
              </a>
              <button type="button" onClick={() => void deleteVideo(selectedModelingVideo.videoId)} className="rounded-lg border border-rose-300 px-4 py-2.5 text-sm font-bold text-rose-700">Xóa cả hai video</button>
              <button type="button" onClick={() => setSelectedModelingVideo(null)} className="rounded-lg border border-[#cbd9ea] px-4 py-2.5 text-sm font-bold text-[#0b3262]">Đóng</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
function withDownloadFlag(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
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
