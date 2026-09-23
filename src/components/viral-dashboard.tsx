"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { notifyRuntimeFailure } from "@/components/runtime-error-monitor";
import { assertStrictModelingReady, compileStrictModelingConstraints } from "@/modules/modeling/strict-source-modeling";
import { assertNoWrongStageRestart, checkpointPatch, prepareResumeSteps, resolveResumableRun, resumeTargetForStage, type AutomationPersistenceFields, type ResumeDecision, type ResumableRunInput } from "@/modules/automations/resume";

type Dashboard = {
  channel: { id: string; name: string } | null;
  stats: { competitors: number; newVideos: number; viralVideos: number };
  videos: Array<{
    id: string;
    url: string;
    caption?: string | null;
    modelingVideoUrl: string | null;
    thumbnailUrl?: string | null;
    publishedAt: string;
    score: number;
    relativePerformance: number;
    currentViews: number;
    analysis: { id: string; createdAt: string; content: VideoAnalysisResult["analysis"] } | null;
    competitor: {
      handle: string;
      displayName: string | null;
      platform: string;
    };
  }>;
};
type ChannelIdentityPack = { characterId: string; channelId: string; name: string; styleType: string; lockedTraits: Record<string, unknown>; allowedVariations: string[]; negativeRules: string[]; active: boolean; referenceImages: Array<{ assetId: string; storageKey: string; referenceId: string | null; viewRole: string; active: boolean; name: string | null; mimeType: string | null; url: string }> };
type ChannelOption = { id: string; name: string; targetCountry?: string; language?: string; hashtags?: string | null; mainCharacterImageUrl?: string | null; mainCharacterImageName?: string; characterIdentityPack?: ChannelIdentityPack | null };
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
type FacebookScanItem = { url: string; caption: string; publishedAt: string | null; views: number | null; likes: number | null; comments: number | null; shares: number | null; durationSec: number | null };
type FacebookScanResult = { competitorId: string; sourceUrl: string; needsLogin: boolean; items: FacebookScanItem[]; error?: string };
type FacebookScanProgress = { processed: number; total: number };
type DesktopFacebook = {
  open: () => Promise<{ status: string }>;
  scan: (entries: Array<{ id: string; url: string }>, onProgress?: (progress: FacebookScanProgress) => void) => Promise<FacebookScanResult[]>;
};
type DesktopGemini = {
  runJob: (projectId: string, slots: ImageSlot[], onProgress?: (progress: { processed: number; total: number; label: string }) => void, runId?: string) => Promise<{ status: string; images: Record<string, string> }>;
  runVideoJob: (projectId: string, channelId: string, slots: VideoSlot[], onProgress?: (progress: { processed: number; total: number; label: string }) => void) => Promise<{ status: string; videos: Record<string, string> }>;
  analyzeSource: (video: Record<string, unknown>, channelDNA?: Record<string, unknown>, runId?: string) => Promise<VideoAnalysisResult["analysis"]>;
  generateIdea: (video: Record<string, unknown>, analysis: VideoAnalysisResult["analysis"], channelDNA?: Record<string, unknown>, artStyle?: string, runId?: string) => Promise<{ schemaVersion: "1.0"; modelingDirections: ModelingIdeaResult[] }>;
  developProject: (video: Record<string, unknown>, analysis: VideoAnalysisResult["analysis"], idea: ModelingIdeaResult, channelDNA?: Record<string, unknown>, aspectRatio?: string, runId?: string) => Promise<Record<string, unknown>>;
};
type ImageSlot = { kind: "background" | "scene"; sceneNumber?: number; label: string; prompt: string; aspectRatio: string; promptId?: string; validatedPrompt?: string; validatedPromptHash?: string };
type VideoSlot = { sceneNumber: number; sceneId?: string; label: string; visualBlock: string; actionBlock: string; audioBlock: string; englishPrompt: string; aspectRatio: string; promptId?: string; validatedPrompt?: string; validatedPromptHash?: string };
type VideoProvider = "flow" | "gemini";
type DesktopFlow = {
  open: () => Promise<{ status: string }>;
  runImageJob: (projectId: string, channelId: string, slots: ImageSlot[], onProgress?: (progress: { processed: number; total: number; label: string }) => void) => Promise<{ status: string; images: Record<string, string> }>;
  runVideoJob: (projectId: string, channelId: string, slots: VideoSlot[], onProgress?: (progress: { processed: number; total: number; label: string }) => void) => Promise<{ status: string; videos: Record<string, string> }>;
  resumeAfterManualSubmission: (checkpointId: string) => Promise<{ status: string; checkpointId: string; video?: string }>;
  prepareManualSubmission: (projectId: string, channelId: string, slot: VideoSlot) => Promise<{ status: string; checkpointId: string; flowProjectUrl: string; startFramePath: string; prompt: string }>;
};
type DesktopVideoEditor = {
  pickAudio: () => Promise<{ status: "cancelled" | "selected"; path?: string; name?: string }>;
  renderFinal: (projectId: string, sceneNumbers: number[], options: VideoEditOptions, onProgress?: (progress: { stage: string; processed: number; total: number; label: string }) => void) => Promise<{ status: string; video: string }>;
};
type VideoEditScene = { sceneNumber: number; trimStart: number; trimEnd: number; duration?: number };
type VideoEditOptions = { scenes: VideoEditScene[]; transition: "none" | "fade"; transitionDuration: number; originalVolume: number; musicVolume: number; musicPath?: string };
type VideoAnalysisResult = {
  id?: string;
  analysisId?: string;
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
type ContentProjectResult = { id: string; sourceVideoId?: string | null; sourceVideoUrl?: string | null; sourceDuration?: number | null; sourcePlatform?: string | null; modelingPolicy?: string | null; modelingFidelityTarget?: number | null; sourceModelingSpecVersion?: string | null; sourceModelingSpec?: Record<string, unknown> | null; artDirection: Record<string, unknown>; characterDesign: Record<string, unknown>; backgroundDesign: Record<string, unknown>; scenes: Array<{ id?: string; sceneNumber: number; sourceSceneId?: string | null; sourceSceneOrder?: number | null; sourceSceneStartTime?: number | null; sourceSceneEndTime?: number | null; targetDuration?: number | null; timingStatus?: string | null; cameraSpec?: Record<string, unknown> | null; actionSequence?: string[] | null; visualBlock: string; actionBlock: string; audioBlock: string; startFramePrompt?: string | null; englishPrompt?: string | null }> };
const FLOW_PROVIDER_UNUSUAL_ACTIVITY = "FLOW_PROVIDER_UNUSUAL_ACTIVITY";
const FLOW_PROVIDER_UNUSUAL_ACTIVITY_MESSAGE = "Google Flow tạm chặn tạo video vì phát hiện hoạt động bất thường.\n\nPipeline đã được tạm dừng để tránh retry liên tục.\n\nHãy kiểm tra Flow thủ công. Khi Flow tạo video bình thường trở lại, hãy Resume phiên này.";
function isFlowProviderUnusualActivityError(value: unknown) {
  return typeof value === "string" ? value.includes(FLOW_PROVIDER_UNUSUAL_ACTIVITY) || value.includes("Google Flow tạm chặn tạo video vì phát hiện hoạt động bất thường.") : Boolean(value && typeof value === "object" && (value as { code?: unknown }).code === FLOW_PROVIDER_UNUSUAL_ACTIVITY);
}
type ContentProjectTroubleshooting = { disposition?: string; fingerprint?: string; matchDecision?: string; matchedRuleId?: string | null; resumeStage?: string | null; incidentId?: string; repair?: { status?: string; nextAction?: string }; jsonReportPath?: string; markdownReportPath?: string; reportWarning?: string; userMessage?: string };
function SourceFidelityStatus({ project, promptFidelityStatus }: { project: ContentProjectResult; promptFidelityStatus: "PASS" | "FAIL" | "NEEDS_REVIEW" | "NOT_EVALUATED" }) {
  const sourceSetupReady = Boolean(project.modelingPolicy === "STRICT_MODELING" && project.sourceModelingSpec && project.scenes.length > 0 && project.scenes.every((scene) => scene.sourceSceneId));
  return <div className="mt-5 grid gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-[#0b3262] sm:grid-cols-4"><div><p className="font-bold">Character Fidelity</p><p className="mt-1 font-extrabold text-slate-600">NOT_EVALUATED</p><p className="text-xs text-[#6883aa]">Cần kiểm tra trên start-frame.</p></div><div><p className="font-bold">Source Fidelity</p><p className={`mt-1 font-extrabold ${sourceSetupReady ? "text-emerald-700" : "text-amber-700"}`}>{sourceSetupReady ? "PASS · spec/mapping" : "NEEDS_REVIEW"}</p><p className="text-xs text-[#6883aa]">Cấu trúc source được theo dõi riêng.</p></div><div><p className="font-bold">Technical Quality</p><p className="mt-1 font-extrabold text-slate-600">NOT_EVALUATED</p><p className="text-xs text-[#6883aa]">Chưa có output media để kiểm tra.</p></div><div><p className="font-bold">Prompt Fidelity</p><p className={`mt-1 font-extrabold ${promptFidelityStatus === "PASS" ? "text-emerald-700" : promptFidelityStatus === "FAIL" ? "text-rose-700" : "text-amber-700"}`}>{promptFidelityStatus}</p><p className="text-xs text-[#6883aa]">Gate bắt buộc trước khi gửi model.</p></div></div>;
}
type AutomationStep = { key: string; label: string; status: "pending" | "running" | "completed" | "failed"; detail?: string; error?: string; startedAt?: string; completedAt?: string };
type AutomationSettings = { artStyle: string; aspectRatio: "9:16" | "16:9" | "1:1" | "4:5"; postText?: string; hashtags?: string; language?: string; targetCountry?: string };
type AutomationRunResult = ResumableRunInput & { id: string; status: "RUNNING" | "SUCCEEDED" | "FAILED" | "PAUSED"; steps: AutomationStep[]; modelingIdea?: ModelingIdeaResult | null };
type CodexStage = "ANALYSIS" | "MODELING" | "PROJECT" | "ASSETS" | "SCENES" | "FINAL_ASSEMBLY" | "FINAL_AUDIT" | "POST_RUN_REVIEW";
type CodexAction = { name: string; stage?: CodexStage; targetIds?: string[]; strategy?: string; reason?: string };
type CodexJobResult = {
  id: string;
  automationRunId?: string | null;
  status: string;
  currentStage?: CodexStage;
  stages: Array<{ stage: CodexStage; status: string; retryCount: number; maxRetries?: number; validationResult?: string }>;
  events?: Array<{ type: string; stage?: string | null; payload?: Record<string, unknown>; reasoningSummary?: string | null }>;
  runtimeFailures?: Array<{ id: string; source: string; stage?: string | null; failureKind: string; code: string; message: string; status: string; attempts: number; codexResponseId?: string | null; lastAttemptAt?: string | null; resolvedAt?: string | null; createdAt: string }>;
  nextAction: CodexAction;
};
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

function buildSceneTextPolicy(...sources: string[]) {
  const requiredText = sources
    .flatMap((source) => [...source.matchAll(/[\u0027\u2018\u2019\u201c\u201d]([^\n\u0027\u2018\u2019\u201c\u201d]{2,})[\u0027\u2018\u2019\u201c\u201d]/g)].map((match) => match[1].trim()))
    .find((text) => /\s/.test(text));
  if (requiredText) {
    return `TEXT POLICY: REQUIRED_TEXT is exactly: "${requiredText}". This text may be readable only inside the explicitly requested chat interface on the computer monitor. FORBIDDEN_TEXT: every other readable word, letter, number, sign, label, logo, caption, book-spine text, poster text, or decorative typography anywhere in the image. Do not add any other text.`;
  }
  return "TEXT POLICY: FORBIDDEN_TEXT. Do not render any readable text, words, letters, numbers, signs, labels, logos, captions, screen text, book-spine text, poster text, or decorative typography anywhere in the image. Use only blank surfaces or abstract non-linguistic marks.";
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
  const [promptFidelityStatus, setPromptFidelityStatus] = useState<"PASS" | "FAIL" | "NEEDS_REVIEW" | "NOT_EVALUATED">("NOT_EVALUATED");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [contentProjectError, setContentProjectError] = useState("");
  const [contentProjectRecoveryStatus, setContentProjectRecoveryStatus] = useState("");
  const [contentProjectIncidentId, setContentProjectIncidentId] = useState("");
  const contentProjectTroubleshootingHandled = useRef(false);
  const [generatedImages, setGeneratedImages] = useState<Record<string, string>>({});
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [showGeneratedImages, setShowGeneratedImages] = useState(false);
  const [flowImageSlots, setFlowImageSlots] = useState<ImageSlot[]>([]);
  const [flowImageMessage, setFlowImageMessage] = useState("");
  const [flowImageProgress, setFlowImageProgress] = useState({ processed: 0, total: 0 });
  const [generatedVideos, setGeneratedVideos] = useState<Record<string, string>>({});
  const [isGeneratingVideos, setIsGeneratingVideos] = useState(false);
  const [showGeneratedVideos, setShowGeneratedVideos] = useState(false);
  const [videoProvider, setVideoProvider] = useState<VideoProvider>("flow");
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
  const automaticRunLockRef = useRef(false);
  const appSessionIdRef = useRef("");
  const automaticExecutionRef = useRef<{ runId: string; executionId: string; appSessionId: string; startedAt: string; activeStage: string } | null>(null);
  const [analysisFilter, setAnalysisFilter] = useState<"all" | "analyzed" | "unanalyzed">("all");
  const [videoPage, setVideoPage] = useState(1);
  const [autoSyncRequested, setAutoSyncRequested] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("autoSync") === "1");
  const [manualVideo, setManualVideo] = useState({ competitorId: "", url: "", publishedAt: new Date().toISOString().slice(0, 16), views: "", likes: "0", comments: "0", shares: "0", caption: "" });
  const [executionMode, setExecutionMode] = useState<"manual" | "automatic" | "codex">("manual");
  const [isAutomaticRunning, setIsAutomaticRunning] = useState(false);
  const [automationRunId, setAutomationRunId] = useState("");
  const [automationSteps, setAutomationSteps] = useState<AutomationStep[]>([]);
  const [resumableDecision, setResumableDecision] = useState<ResumeDecision>({ status: "NONE" });
  const [codexJobId, setCodexJobId] = useState("");
  const [codexStatus, setCodexStatus] = useState("");
  const [codexErrorDeliveryStatus, setCodexErrorDeliveryStatus] = useState("");
  const [selectedModelingVideo, setSelectedModelingVideo] = useState<SelectedModelingVideo | null>(null);
  const [resumeSelection] = useState(() => {
    if (typeof window === "undefined") return { runId: "", modelingIdeaId: "", stopAfterStage: null as number | null };
    const params = new URLSearchParams(window.location.search);
    const stopAfterStage = params.get("validationStopAfterStage");
    return { runId: params.get("runId")?.trim() ?? "", modelingIdeaId: params.get("modelingIdeaId")?.trim() ?? "", stopAfterStage: stopAfterStage === "1" ? 1 : stopAfterStage === "2" ? 2 : stopAfterStage === "3" ? 3 : stopAfterStage === "4" ? 4 : null };
  });
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
    const selectedChannelId = channelId || dashboard?.channel?.id || channels[0]?.id;
    if (!analysisVideoId || !selectedChannelId) {
      setResumableDecision({ status: "NONE" });
      return;
    }
    let cancelled = false;
    fetch(`/api/v1/automations?sourceVideoId=${encodeURIComponent(analysisVideoId)}&channelId=${encodeURIComponent(selectedChannelId)}`)
      .then(async (response) => {
        const body = await response.json() as { data?: AutomationRunResult[]; error?: { message?: string } };
        if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể kiểm tra checkpoint tự động.");
        if (cancelled) return;
        const decision = resolveResumableRun(body.data, { sourceVideoId: analysisVideoId, channelId: selectedChannelId, runId: resumeSelection.runId || undefined, modelingIdeaId: resumeSelection.modelingIdeaId || undefined });
        setResumableDecision(decision);
        if (decision.status === "RESUME") {
          setModelingIdea(decision.modelingIdea as ModelingIdeaResult);
          setAutomationRunId(decision.run.id);
          setAutomationSteps(decision.run.steps as AutomationStep[]);
        }
      })
      .catch(() => { if (!cancelled) setResumableDecision({ status: "NONE" }); });
    return () => { cancelled = true; };
  }, [analysisVideoId, channelId, channels, dashboard?.channel?.id, resumeSelection.runId, resumeSelection.modelingIdeaId]);
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
        notifyRuntimeFailure(caught, { operation: "sync-progress" });
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
      notifyRuntimeFailure(caught, { operation: "start-sync" });
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
      notifyRuntimeFailure(caught, { operation: "delete-channel-video-data" });
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
      notifyRuntimeFailure(caught, { operation: "delete-video" });
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
                durationSec: item.durationSec,
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
      notifyRuntimeFailure(caught, { operation: "facebook-browser-scan" });
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
      const video = dashboard?.videos.find((item) => item.id === videoId);
      const desktopGemini = (window as Window & { desktopGemini?: DesktopGemini }).desktopGemini;
      if (!desktopGemini || !video) {
        throw new Error("SOURCE_VIDEO_BROWSER_REQUIRED: Phân tích chỉ được phép khi cầu nối CDP/Desktop có thể tải và đính kèm video gốc thật.");
      }
      const response = await (async () => {
          const analysis = await desktopGemini.analyzeSource({ id: video.id, url: video.url, caption: video.url, thumbnailUrl: video.thumbnailUrl, publishedAt: video.publishedAt }, { channel: dashboard?.channel });
          return fetch(`/api/v1/videos/${videoId}/analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "gemini-browser", analysis }) });
        })();
      const body = await response.json() as { data?: VideoAnalysisResult; error?: { message?: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể phân tích video.");
      setAnalysisResult(body.data);
      setAnalysisVideoId(videoId);
      setModelingIdea(null);
      setContentProject(null);
      setExecutionMode("manual");
      setAutomationRunId("");
      setAutomationSteps([]);
      setDashboard((current) => current ? { ...current, videos: current.videos.map((video) => video.id === videoId ? { ...video, analysis: { id: body.data!.id ?? body.data!.analysisId ?? videoId, createdAt: new Date().toISOString(), content: body.data!.analysis } } : video) } : current);
    } catch (caught) {
      notifyRuntimeFailure(caught, { operation: "analyze-video" });
      setError(caught instanceof Error ? caught.message : "Không thể phân tích video.");
    } finally {
      setAnalyzingVideoId("");
    }
  }
  function viewStoredAnalysis(video: Dashboard["videos"][number]) {
    if (video.analysis) {
      setAnalysisResult({ id: video.analysis.id, analysis: video.analysis.content });
      setAnalysisVideoId(video.id);
      setModelingIdea(null);
      setContentProject(null);
      setExecutionMode("manual");
      setAutomationRunId("");
      setAutomationSteps([]);
    }
  }
  async function generateModelingIdea(runId?: string): Promise<ModelingIdeaResult | null> {
    if (!analysisVideoId) return null;
    setIsGeneratingIdea(true);
    setError("");
    setModelingIdeaError("");
    try {
      const sourceVideo = dashboard?.videos.find((video) => video.id === analysisVideoId);
      const desktopGemini = (window as Window & { desktopGemini?: DesktopGemini }).desktopGemini;
      const response = desktopGemini && sourceVideo && analysisResult
        ? await (async () => {
          const ideas = await desktopGemini.generateIdea({ id: sourceVideo.id, url: sourceVideo.url, caption: sourceVideo.url, thumbnailUrl: sourceVideo.thumbnailUrl, publishedAt: sourceVideo.publishedAt }, analysisResult.analysis, { channel: dashboard?.channel }, ideaArtStyle, runId);
          return fetch(`/api/v1/videos/${analysisVideoId}/ideas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "gemini-browser", ideas, analysisId: analysisResult.id ?? analysisResult.analysisId }) });
        })()
        : await fetch(`/api/v1/videos/${analysisVideoId}/ideas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artStyle: ideaArtStyle }) });
      const body = await response.json() as { data?: { ideas?: ModelingIdeaResult[] }; error?: { message?: string } };
      if (!response.ok || !body.data?.ideas?.[0]) throw new Error(body.error?.message ?? "Không thể tạo Modeling Idea.");
      const idea = body.data.ideas[0];
      setModelingIdea(idea);
      setContentProject(null);
      return idea;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Không thể tạo Modeling Idea.";
      notifyRuntimeFailure(caught, { operation: "create-modeling-idea" });
      setModelingIdeaError(message);
      setError(message);
      return null;
    } finally {
      setIsGeneratingIdea(false);
    }
  }
  function applyContentProjectTroubleshooting(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const troubleshooting = value as ContentProjectTroubleshooting;
    contentProjectTroubleshootingHandled.current = true;
    const repairStatus = troubleshooting.repair?.status;
    const status = troubleshooting.disposition === "RESUME" || repairStatus === "REPAIRED" || repairStatus === "RECOVERED_WITH_WARNING"
      ? "Đã tìm thấy giải pháp — đang chạy lại bước này"
      : troubleshooting.matchDecision === "NO_MATCH"
        ? "Lỗi mới — đã chuẩn bị báo cáo cho Codex"
        : "Đã kiểm tra Kho lỗi — cần xem xét";
    setContentProjectRecoveryStatus(status);
    setContentProjectIncidentId(typeof troubleshooting.incidentId === "string" ? troubleshooting.incidentId : "");
    return true;
  }
  async function createContentProject(idea = modelingIdea, useBrowserGemini = false, recoveryRunId?: string): Promise<ContentProjectResult | null> {
    if (!idea?.id) return null;
    setIsCreatingProject(true);
    setContentProjectError("");
    setContentProjectRecoveryStatus("");
    setContentProjectIncidentId("");
    contentProjectTroubleshootingHandled.current = false;
    const sourceVideo = dashboard?.videos.find((video) => video.id === analysisVideoId);
    try {
      const approveResponse = await fetch(`/api/v1/ideas/${idea.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(recoveryRunId ? { automationRunId: recoveryRunId } : {}) });
      const approveBody = await approveResponse.json() as { error?: { message?: string; details?: { troubleshooting?: unknown } }; troubleshooting?: unknown };
      if (approveBody.troubleshooting) applyContentProjectTroubleshooting(approveBody.troubleshooting);
      if (!approveResponse.ok) {
        if (approveBody.error?.details?.troubleshooting) applyContentProjectTroubleshooting(approveBody.error.details.troubleshooting);
        throw new Error(approveBody.error?.message ?? "Không thể duyệt Modeling Idea.");
      }
      const desktopGemini = (window as Window & { desktopGemini?: DesktopGemini }).desktopGemini;
      const requestContext = recoveryRunId ? { automationRunId: recoveryRunId } : {};
      const response = useBrowserGemini
        ? await (async () => {
          if (!desktopGemini || !sourceVideo || !analysisResult) throw new Error("CONTENT_PROJECT_BROWSER_REQUIRED: Không tìm thấy phiên Gemini trình duyệt để chạy bước 3.");
          const project = await desktopGemini.developProject(
            { id: sourceVideo.id, url: sourceVideo.url, caption: sourceVideo.caption, thumbnailUrl: sourceVideo.thumbnailUrl, publishedAt: sourceVideo.publishedAt },
            analysisResult.analysis,
            idea,
            { channel: dashboard?.channel },
            aspectRatio,
            recoveryRunId,
          );
          return fetch(`/api/v1/ideas/${idea.id}/develop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "gemini-browser", project, aspectRatio, ...requestContext }) });
        })()
        : await fetch(`/api/v1/ideas/${idea.id}/develop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aspectRatio, ...requestContext }) });
      const body = await response.json() as { data?: ContentProjectResult; error?: { message?: string; details?: { troubleshooting?: unknown } } };
      if (body.error?.details?.troubleshooting) applyContentProjectTroubleshooting(body.error.details.troubleshooting);
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể tạo thiết kế và phân cảnh.");
      setContentProject(body.data);
      setPromptFidelityStatus("NOT_EVALUATED");
      setGeneratedImages({});
      setFlowImageSlots([]);
      setFlowImageMessage("");
      setShowGeneratedImages(false);
      setGeneratedVideos({});
      setGeminiVideoMessage("");
      setShowGeneratedVideos(false);
      return body.data;
    } catch (caught) {
      const propagatedError = caught instanceof Error ? caught : new Error(String(caught ?? "Không thể tạo thiết kế và phân cảnh."));
      const structuredError = propagatedError as Error & { code?: string; firstDivergence?: string; cause?: string | null; details?: Record<string, unknown>; context?: Record<string, unknown> };
      const upstreamDetails = structuredError.details ?? structuredError.context ?? {};
      const failureCode = structuredError.code ?? "CONTENT_PROJECT_CREATION_FAILED";
      if (!contentProjectTroubleshootingHandled.current) {
        let reported = false;
        try {
          const reportResponse = await fetch("/api/v1/runtime-failures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "renderer:content-project-creation", code: failureCode, message: propagatedError.message, stack: propagatedError.stack, stage: "PROJECT", context: { operation: "create-content-project", ideaId: idea.id, sourceVideoId: sourceVideo?.id ?? null, automationRunId: recoveryRunId ?? null, firstDivergence: structuredError.firstDivergence ?? upstreamDetails.firstDivergence ?? failureCode, cause: structuredError.cause ?? upstreamDetails.cause ?? null, ...upstreamDetails, checkpoint: { stage: "PROJECT", ideaId: idea.id, sourceVideoId: sourceVideo?.id ?? null, aspectRatio } } }) });
          const reportBody = await reportResponse.json() as { data?: { troubleshooting?: unknown } };
          reported = Boolean(reportBody.data?.troubleshooting) && applyContentProjectTroubleshooting(reportBody.data?.troubleshooting);
        } catch {
          reported = false;
        }
        if (!reported) notifyRuntimeFailure(propagatedError, { operation: "create-content-project", ideaId: idea.id, sourceVideoId: sourceVideo?.id, automationRunId: recoveryRunId, stage: "PROJECT" });
      }
      setContentProjectError(propagatedError.message);
      throw propagatedError;
    } finally {
      setIsCreatingProject(false);
    }
  }
  async function preparePromptForFlow(projectId: string, draftPrompt: string, promptType: "IMAGE" | "VIDEO", sceneNumber?: number) {
    const response = await fetch(`/api/v1/projects/${projectId}/prompt-fidelity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptType, sceneNumber, draftPrompt }) });
    const body = await response.json() as { data?: { promptId: string; compiledPromptHash?: string; validatedPrompt: string; promptHash: string }; error?: { message?: string } };
    if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Prompt Fidelity Gate không cho phép generation.");
    return body.data;
  }
  function buildGeminiImageSlots(project = contentProject): ImageSlot[] {
    if (!project) return [];
    const strictSpec = assertStrictModelingReady({ sourceVideoId: project.sourceVideoId, sourceVideoUrl: project.sourceVideoUrl, sourceDuration: project.sourceDuration, modelingPolicy: project.modelingPolicy ?? "STRICT_MODELING", sourceModelingSpec: project.sourceModelingSpec, generatedScenes: project.scenes.map((scene) => ({ sceneNumber: scene.sceneNumber, sourceSceneId: scene.sourceSceneId, targetDuration: scene.targetDuration })) });
    const selectedChannelId = channelId || dashboard?.channel?.id || channels[0]?.id;
    const identityPack = channels.find((channel) => channel.id === selectedChannelId)?.characterIdentityPack;
    if (!identityPack?.active || !identityPack.referenceImages.some((reference) => reference.active)) throw new Error("MAIN_CHARACTER_IDENTITY_MISSING: Hãy lưu Character Identity Pack cho Channel trước khi tạo ảnh/video.");
    const identityDesign = identityPack.lockedTraits;
    const identityPrompt = `PRESERVE IDENTITY: use the approved Channel Character Identity Pack ${identityPack.name}. Locked traits: ${JSON.stringify(identityDesign)}. Never invent or replace the main character. Apply only the scene appearance explicitly stated below.`;
    const castPrompt = `CAST AND ROLE CONTINUITY (authoritative): ${JSON.stringify(project.characterDesign)}. Keep every recurring character's gender, face, hair, clothing, and role consistent across shots. The protagonist must not replace another character as the patient, doctor, or action target. Match the approved storyboard's subject and object for this scene.`;
    const backgroundPrompt = toFlowSafePrompt(`${identityPrompt}\n${compileStrictModelingConstraints(strictSpec)}\nCreate one single full-frame vertical background reference image for this project. Use the approved background design below as the source of truth. Establish one recognizable, coherent world/location that can be reused across every scene. Preserve the requested overall space, mood, color palette, camera language, and key landmarks, while applying only the explicitly allowed environment/style transformations. Do not include any character, person, animal, prop held by a character, text, caption, logo, collage, storyboard, character sheet, contact sheet, split panel, or multiple variations. The result must be a clean empty environment that can later receive the fixed character and scene appearance. Approved background design: ${JSON.stringify(project.backgroundDesign)}. Use an original visual treatment. Aspect ratio: ${aspectRatio}. Generate exactly one final image.`);
    const sceneSlots = [...project.scenes].sort((left, right) => left.sceneNumber - right.sceneNumber).map((scene) => {
      const startFramePrompt = scene.startFramePrompt?.trim() || `Create one single full-frame vertical 9:16 still image showing the exact starting state of scene ${scene.sceneNumber}. Preserve the approved main character, background, composition, lighting, and initial pose. Do not show motion, a collage, a storyboard, text, or multiple variations.`;
      const sceneAppearance = `SCENE APPEARANCE STATE (authoritative for this scene): Use only the wardrobe, accessories, temporary condition, and required props explicitly described by this scene. Do not inherit a global outfit when this scene specifies a different appearance. Visual: ${scene.visualBlock}. Action roles: ${scene.actionBlock}. Start-frame state: ${startFramePrompt}`;
      const sceneTextPolicy = buildSceneTextPolicy(scene.visualBlock, startFramePrompt);
      const strictConstraints = compileStrictModelingConstraints(strictSpec, scene.sourceSceneId ?? undefined);
      return {
        kind: "scene" as const,
        sceneNumber: scene.sceneNumber,
        label: `Ảnh bắt đầu cảnh ${scene.sceneNumber}`,
        aspectRatio: "9:16",
        prompt: toFlowSafePrompt(`${identityPrompt}\n${castPrompt}\n${strictConstraints}\nPRESERVE IDENTITY\n${sceneAppearance}\n${sceneTextPolicy}\nSCENE ACTION / FROZEN INITIAL STATE: Show only the exact state before motion begins; do not depict later action beats.\nBACKGROUND / CAMERA / COMPOSITION: Use the approved background design as one natural full-frame environment with the identity and scene appearance above. Do not create a collage, storyboard, character sheet, contact sheet, split panel, multiple variations. Aspect ratio: ${aspectRatio}. Generate exactly one final image.`),
      };
    });
    return [
      { kind: "background", sceneNumber: 0, label: "Bối cảnh đồng nhất", aspectRatio, prompt: backgroundPrompt },
      ...sceneSlots,
    ];
  }
  async function generateAllProjectImages(project = contentProject, onlySceneNumbers?: number[], existingImages = generatedImages, runId?: string): Promise<Record<string, string> | null> {
    if (!project) return null;
    setIsGeneratingImages(true);
    setContentProjectError("");
    try {
      const allSlots = buildGeminiImageSlots(project);
      const selected = onlySceneNumbers?.length ? new Set(onlySceneNumbers) : null;
      const slots = selected ? allSlots.filter((slot) => slot.kind === "scene" && slot.sceneNumber !== undefined && selected.has(slot.sceneNumber)) : allSlots;
      if (!slots.length) throw new Error("Không xác định được ảnh cần tạo lại.");
      const selectedChannelId = channelId || dashboard?.channel?.id || channels[0]?.id;
      if (!selectedChannelId) throw new Error("Hãy chọn kênh trước khi tạo ảnh.");
      setPromptFidelityStatus("NOT_EVALUATED");
      const preparedSlots = await Promise.all(slots.map(async (slot) => { const prepared = await preparePromptForFlow(project.id, slot.prompt, "IMAGE", slot.kind === "scene" ? slot.sceneNumber : undefined); return { ...slot, prompt: prepared.validatedPrompt, promptId: prepared.promptId, validatedPrompt: prepared.validatedPrompt, validatedPromptHash: prepared.promptHash }; }));
      setPromptFidelityStatus("PASS");
      setFlowImageSlots(preparedSlots);
      setFlowImageProgress({ processed: 0, total: preparedSlots.length });
      setFlowImageMessage("Đang tạo ảnh bằng Gemini qua trình duyệt...");
      const gemini = (window as Window & { desktopGemini?: DesktopGemini }).desktopGemini;
      if (!gemini) throw new Error("Không tìm thấy cầu nối Gemini trên trình duyệt. Hãy chạy app desktop.");
      const result = await gemini.runJob(project.id, preparedSlots, (progress) => { setFlowImageProgress({ processed: progress.processed, total: progress.total }); setFlowImageMessage(`Gemini đang tạo ${progress.label} — ${progress.processed}/${progress.total}`); }, runId);
      setFlowImageProgress({ processed: preparedSlots.length, total: preparedSlots.length });
      setFlowImageMessage("Đã tạo và lưu ảnh bằng Gemini qua trình duyệt.");
      const mergedImages = { ...existingImages, ...result.images };
      setGeneratedImages(mergedImages);
      setShowGeneratedImages(true);
      setFlowImageMessage("Đã tạo và đưa toàn bộ ảnh vào app theo đúng thứ tự.");
      return mergedImages;
    } catch (caught) { notifyRuntimeFailure(caught, { operation: "generate-project-images", projectId: project.id, stage: "ASSETS" }); setContentProjectError(caught instanceof Error ? caught.message : "Không thể tạo ảnh bằng Gemini."); throw caught; }
    finally { setIsGeneratingImages(false); }
  }
  async function generateAllProjectVideos(project = contentProject, images = generatedImages, onlySceneNumbers?: number[], existingVideos = generatedVideos): Promise<Record<string, string> | null> {
    if (!project) return null;
    const strictSpec = assertStrictModelingReady({ sourceVideoId: project.sourceVideoId, sourceVideoUrl: project.sourceVideoUrl, sourceDuration: project.sourceDuration, modelingPolicy: project.modelingPolicy ?? "STRICT_MODELING", sourceModelingSpec: project.sourceModelingSpec, generatedScenes: project.scenes.map((scene) => ({ sceneNumber: scene.sceneNumber, sourceSceneId: scene.sourceSceneId, targetDuration: scene.targetDuration })) });
    const selectedChannelId = channelId || dashboard?.channel?.id || channels[0]?.id;
    const identityPack = channels.find((channel) => channel.id === selectedChannelId)?.characterIdentityPack;
    if (!identityPack?.active || !identityPack.referenceImages.some((reference) => reference.active)) throw new Error("MAIN_CHARACTER_IDENTITY_MISSING: Hãy lưu Character Identity Pack cho Channel trước khi tạo video.");
    const identityPrompt = `PRESERVE IDENTITY: use the approved Character Identity Pack ${identityPack.name}. LOCKED TRAITS: ${JSON.stringify(identityPack.lockedTraits)}. CAST AND ROLE CONTINUITY: ${JSON.stringify(project.characterDesign)}. Preserve every character's identity, gender, wardrobe, and scene role; never substitute the protagonist for the specified patient or doctor. PRESERVE IDENTITY: face identity, facial structure, skin tone, base hairstyle, body proportions, body build, age appearance, distinctive traits and core character design language. APPLY SCENE APPEARANCE: use only the outfit, shoes, accessories, props, emotion, pose and temporary condition explicitly required by this scene.`;
    const videoAspectRatioDirective = aspectRatio === "16:9" ? "OUTPUT REQUIREMENT: Create the video in a 16:9 landscape aspect ratio." : "OUTPUT REQUIREMENT: Create the video in a vertical 9:16 aspect ratio.";
    const selected = onlySceneNumbers?.length ? new Set(onlySceneNumbers) : null;
    const sceneSlots: VideoSlot[] = project.scenes.filter((scene) => (!selected || selected.has(scene.sceneNumber)) && !existingVideos[`scene-${scene.sceneNumber}`]).map((scene) => ({
      sceneNumber: scene.sceneNumber,
      sceneId: scene.id,
      label: `Video cảnh ${scene.sceneNumber}`,
      visualBlock: scene.visualBlock,
      actionBlock: scene.actionBlock,
      audioBlock: scene.audioBlock,
      englishPrompt: `${identityPrompt}\n${videoAspectRatioDirective}\n${compileStrictModelingConstraints(strictSpec, scene.sourceSceneId ?? undefined)}\n${scene.englishPrompt?.trim() || `Create one 4-second video starting from the approved start image for scene ${scene.sceneNumber}. Preserve the character, background, composition, story meaning, and ending, and animate only the specified primary action with synchronized sound.`}`,
      aspectRatio,
    }));
    if (!sceneSlots.length) {
      setGeneratedVideos(existingVideos);
      return existingVideos;
    }
    const missingImages = [
      ...(!images["background-0"] ? ["background-0"] : []),
      ...sceneSlots.filter((scene) => !images[`scene-${scene.sceneNumber}`]).map((scene) => `scene-${scene.sceneNumber}`),
    ];
    if (missingImages.length) {
      throw new Error(`STAGE4_REFERENCE_IMAGES_MISSING: thiếu ${missingImages.join(", ")}. Kiểm tra thư mục dữ liệu ảnh của phiên chạy trước khi gửi Gemini.`);
    }
    if (!onlySceneNumbers?.length) {
      const imageHashes = new Map<string, string>();
      for (const scene of project.scenes.sort((left, right) => left.sceneNumber - right.sceneNumber)) {
        const imageUrl = images[`scene-${scene.sceneNumber}`];
        if (!imageUrl) throw new Error(`IMAGE_CONTINUITY_GATE: thiếu ảnh cảnh ${scene.sceneNumber}.`);
        const response = await fetch(imageUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`IMAGE_CONTINUITY_GATE: không đọc được ảnh cảnh ${scene.sceneNumber}.`);
        const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
        const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
        const previousScene = imageHashes.get(hash);
        if (previousScene) {
          throw new Error(`IMAGE_CONTINUITY_GATE: ảnh cảnh ${scene.sceneNumber} trùng hoàn toàn ảnh cảnh ${previousScene}; chưa được phép chạy Stage 4.`);
        }
        imageHashes.set(hash, String(scene.sceneNumber));
      }
    }
    setIsGeneratingVideos(true);
    setContentProjectError("");
    setGeminiVideoProgress({ processed: 0, total: sceneSlots.length });
    const providerAtStart = videoProvider;
    setGeminiVideoMessage(providerAtStart === "flow" ? "Đang tạo video bằng Flow qua CDP..." : "Đang xếp hàng tạo video bằng Gemini qua CDP...");
    try {
      if (!selectedChannelId) throw new Error("Hãy chọn kênh trước khi tạo video.");
      setPromptFidelityStatus("NOT_EVALUATED");
      const preparedSceneSlots = await Promise.all(sceneSlots.map(async (slot) => { const prepared = await preparePromptForFlow(project.id, slot.englishPrompt, "VIDEO", slot.sceneNumber); return { ...slot, englishPrompt: prepared.validatedPrompt, promptId: prepared.promptId, validatedPrompt: prepared.validatedPrompt, validatedPromptHash: prepared.promptHash }; }));
      setPromptFidelityStatus("PASS");
      let result: { status: string; videos: Record<string, string> } | null = null;
      if (providerAtStart === "gemini") {
        const response = await fetch(`/api/v1/projects/${encodeURIComponent(project.id)}/videos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "gemini", channelId: selectedChannelId, slots: preparedSceneSlots }) });
        const body = await response.json() as { data?: { queueJobId?: string; status?: string; videos?: Record<string, string>; error?: string | null }; error?: { message?: string } };
        if (!response.ok || !body.data?.queueJobId) throw new Error(body.error?.message ?? "Không thể xếp hàng video bằng Gemini qua CDP.");
        const queueJobId = body.data.queueJobId;
        let completedVideos: Record<string, string> = {};
        for (let poll = 0; poll < 2_400; poll += 1) {
          const statusResponse = await fetch(`/api/v1/projects/${encodeURIComponent(project.id)}/videos?status=1&queueJobId=${encodeURIComponent(queueJobId)}`, { cache: "no-store" });
          const statusBody = await statusResponse.json() as { data?: { status?: string; videos?: Record<string, string>; error?: string | null }; error?: { message?: string } };
          if (!statusResponse.ok || !statusBody.data) throw new Error(statusBody.error?.message ?? "Không thể đọc tiến trình Gemini qua CDP.");
          completedVideos = statusBody.data.videos ?? {};
          const processed = preparedSceneSlots.filter((slot) => Boolean(completedVideos[`scene-${slot.sceneNumber}`])).length;
          setGeminiVideoProgress({ processed, total: preparedSceneSlots.length });
          setGeminiVideoMessage(`Gemini qua CDP đang tạo video — ${processed}/${preparedSceneSlots.length}`);
          if (statusBody.data.status === "completed") { result = { status: "completed", videos: completedVideos }; break; }
          if (statusBody.data.status === "failed") throw new Error(statusBody.data.error ?? "Gemini qua CDP không tạo được video.");
          await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        }
        if (!result) throw new Error("Gemini qua CDP vượt quá thời gian chờ cho phép.");
      } else {
        const flow = (window as Window & { desktopFlow?: DesktopFlow }).desktopFlow;
        if (!flow) throw new Error("Không tìm thấy cầu nối Google Flow trên trình duyệt. Hãy chạy app desktop.");
        result = await flow.runVideoJob(project.id, selectedChannelId, preparedSceneSlots, (progress) => {
          setGeminiVideoProgress({ processed: progress.processed, total: progress.total });
          setGeminiVideoMessage(`Đang tạo ${progress.label} — ${progress.processed}/${progress.total}`);
        });
      }
      if (!result) throw new Error("Không nhận được kết quả tạo video.");
      setGeminiVideoProgress({ processed: preparedSceneSlots.length, total: preparedSceneSlots.length });
      setGeminiVideoMessage(providerAtStart === "flow" ? "Đã tạo và lưu video bằng Flow qua CDP." : "Đã tạo và lưu video bằng Gemini qua CDP.");
      const mergedVideos = { ...existingVideos, ...result.videos };
      setGeneratedVideos(mergedVideos);
      setShowGeneratedVideos(true);
      setGeminiVideoMessage("Đã tạo và lưu toàn bộ video 4 giây theo đúng thứ tự phân cảnh.");
      return mergedVideos;
    } catch (caught) {
      notifyRuntimeFailure(caught, { operation: "generate-project-videos", projectId: project.id, stage: "SCENES" });
      setContentProjectError(isFlowProviderUnusualActivityError(caught) ? FLOW_PROVIDER_UNUSUAL_ACTIVITY_MESSAGE : caught instanceof Error ? caught.message : providerAtStart === "flow" ? "Không thể tạo video bằng Flow qua CDP." : "Không thể tạo video bằng Gemini qua CDP.");
      throw caught;
    } finally {
      setIsGeneratingVideos(false);
    }
  }

  async function loadPersistedProjectImages(projectId: string, scenes: Array<{ sceneNumber: number }>) {
    const slots = [{ key: "background-0", url: `/api/v1/projects/${projectId}/images?kind=background&sceneNumber=0` }, ...scenes.map((scene) => ({ key: `scene-${scene.sceneNumber}`, url: `/api/v1/projects/${projectId}/images?kind=scene&sceneNumber=${scene.sceneNumber}` }))];
    const loaded = await Promise.all(slots.map(async (slot) => {
      const response = await fetch(slot.url, { cache: "no-store" });
      return response.ok ? [slot.key, slot.url] as const : null;
    }));
    return Object.fromEntries(loaded.filter((entry): entry is readonly [string, string] => Boolean(entry)));
  }

  async function loadPersistedProjectVideos(projectId: string, scenes: Array<{ sceneNumber: number }>) {
    const loaded = await Promise.all(scenes.map(async (scene) => {
      const url = `/api/v1/projects/${projectId}/videos?sceneNumber=${scene.sceneNumber}`;
      const response = await fetch(url, { cache: "no-store" });
      return response.ok ? [`scene-${scene.sceneNumber}`, url] as [string, string] : null;
    }));
    return Object.fromEntries(loaded.filter((entry): entry is [string, string] => Boolean(entry)));
  }

  async function resumeManualFlowSubmission(sceneNumber: number) {
    if (!contentProject) return;
    const flow = (window as Window & { desktopFlow?: DesktopFlow }).desktopFlow;
    if (!flow) { setContentProjectError("Không tìm thấy cầu nối Google Flow trên trình duyệt."); return; }
    const checkpointId = `manual-flow:${contentProject.id}:scene-${sceneNumber}`;
    setGeminiVideoMessage(`Đang kiểm tra video Cảnh ${sceneNumber} đã submit thủ công trên Flow...`);
    try {
      const result = await flow.resumeAfterManualSubmission(checkpointId);
      if (result.status === "MANUAL_SUBMISSION_NOT_COMPLETED") {
        setGeminiVideoMessage(`MANUAL_SUBMISSION_NOT_COMPLETED — mở đúng Flow project, xác nhận start-frame, điền prompt và bấm Generate, rồi Resume lại.`);
        return;
      }
      const resumedVideo = result.video;
      if (typeof resumedVideo === "string") {
        setGeneratedVideos((current) => ({ ...current, [`scene-${sceneNumber}`]: resumedVideo }));
        setShowGeneratedVideos(true);
      }
      setGeminiVideoMessage(`MANUAL_HANDOFF_RESUME = PASS — đã tải và lưu video Cảnh ${sceneNumber}.`);
    } catch (caught) {
      setContentProjectError(caught instanceof Error ? caught.message : "Không thể resume video đã submit thủ công.");
    }
  }

  async function prepareManualFlowSubmission(sceneNumber: number) {
    if (!contentProject) return;
    const flow = (window as Window & { desktopFlow?: DesktopFlow }).desktopFlow;
    const selectedChannelId = channelId || dashboard?.channel?.id || channels[0]?.id;
    const scene = contentProject.scenes.find((item) => item.sceneNumber === sceneNumber);
    if (!flow || !selectedChannelId || !scene) { setContentProjectError("Không thể chuẩn bị Flow thủ công cho phân cảnh này."); return; }
    try {
    const identityPack = channels.find((channel) => channel.id === selectedChannelId)?.characterIdentityPack;
    if (!selectedChannelId || !identityPack?.active || !identityPack.referenceImages.some((reference) => reference.active)) { setContentProjectError("MAIN_CHARACTER_IDENTITY_MISSING: Hãy lưu Character Identity Pack cho Channel trước khi chuẩn bị Flow."); return; }
    const strictSpec = assertStrictModelingReady({ sourceVideoId: contentProject.sourceVideoId, sourceVideoUrl: contentProject.sourceVideoUrl, sourceDuration: contentProject.sourceDuration, modelingPolicy: contentProject.modelingPolicy ?? "STRICT_MODELING", sourceModelingSpec: contentProject.sourceModelingSpec, generatedScenes: contentProject.scenes.map((item) => ({ sceneNumber: item.sceneNumber, sourceSceneId: item.sourceSceneId, targetDuration: item.targetDuration })) });
    const identityDraft = `PRESERVE IDENTITY: use the approved Character Identity Pack ${identityPack.name}. LOCKED TRAITS: ${JSON.stringify(identityPack.lockedTraits)}. PRESERVE IDENTITY: face identity, facial structure, skin tone, base hairstyle, body proportions, body build, age appearance, distinctive traits and core character design language. APPLY SCENE APPEARANCE: use only the outfit, shoes, accessories, props, emotion, pose and temporary condition explicitly required by this scene.`;
    const draftPrompt = `${identityDraft}\n${compileStrictModelingConstraints(strictSpec, scene.sourceSceneId ?? undefined)}\n${scene.englishPrompt ?? scene.actionBlock}`;
    const promptResponse = await fetch(`/api/v1/projects/${contentProject.id}/prompt-fidelity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sceneNumber, promptType: "VIDEO", draftPrompt }) });
    const promptBody = await promptResponse.json() as { data?: { promptId: string; validatedPrompt: string; promptHash: string }; error?: { message?: string } };
    if (!promptResponse.ok || !promptBody.data) throw new Error(promptBody.error?.message ?? "Prompt Fidelity Gate không cho phép chuẩn bị Flow.");
    setPromptFidelityStatus("PASS");
    const slot: VideoSlot = { sceneNumber, sceneId: scene.id, label: `Video cảnh ${sceneNumber}`, visualBlock: scene.visualBlock, actionBlock: scene.actionBlock, audioBlock: scene.audioBlock, englishPrompt: promptBody.data.validatedPrompt, validatedPrompt: promptBody.data.validatedPrompt, validatedPromptHash: promptBody.data.promptHash, promptId: promptBody.data.promptId, aspectRatio };
      const result = await flow.prepareManualSubmission(contentProject.id, selectedChannelId, slot);
      setGeminiVideoMessage(`WAITING_FOR_MANUAL_FLOW_SUBMISSION — Flow project đã mở. Xác nhận start-frame, điền prompt, bấm Generate, rồi Resume Flow thủ công · Cảnh ${sceneNumber}.`);
      setContentProjectError("");
      void result;
    } catch (caught) { setContentProjectError(caught instanceof Error ? caught.message : "Không thể tạo checkpoint Flow thủ công."); }
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
      notifyRuntimeFailure(caught, { operation: "select-video-audio" });
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
      notifyRuntimeFailure(caught, { operation: "render-final-video" });
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
      { key: "images", label: "Tạo và kiểm tra ảnh Gemini bằng trình duyệt", status: "pending" },
      { key: "videos", label: "Tạo video phân cảnh bằng Flow Veo 3", status: "pending" },
      { key: "final-video", label: "Ghép và xuất video hoàn chỉnh", status: "pending" },
    ];
  }
  async function createAutomationRun(settings: AutomationSettings, steps: AutomationStep[]): Promise<AutomationRunResult> {
    const response = await fetch("/api/v1/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceVideoId: analysisVideoId, settings, steps }) });
    const body = await response.json() as { data?: AutomationRunResult; error?: { message?: string } };
    if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể tạo phiên chạy tự động.");
    return body.data;
  }
  async function updateAutomationRun(runId: string, steps: AutomationStep[], fields: { status?: "RUNNING" | "SUCCEEDED" | "FAILED" | "PAUSED"; ideaId?: string | null; modelingIdeaId?: string | null; channelId?: string | null; projectId?: string | null; error?: string | null; settings?: AutomationSettings; lastCompletedStage?: number; failedStage?: number | null; resumeTarget?: string | null; failureFingerprint?: string | null; attemptCount?: number; incidentHistory?: unknown[]; checkpoint?: Record<string, unknown>; sourceModelingSpecVersion?: string | null } = {}) {
    const execution = automaticExecutionRef.current;
    const terminal = fields.status === "PAUSED" || fields.status === "SUCCEEDED" || fields.status === "FAILED";
    const executionCheckpoint = execution?.runId === runId
      ? { ...(fields.checkpoint ?? {}), executionLease: terminal ? null : { ...execution, heartbeatAt: new Date().toISOString() } }
      : fields.checkpoint;
    const response = await fetch("/api/v1/automations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: runId, steps, ...fields, ...(executionCheckpoint !== undefined ? { checkpoint: executionCheckpoint } : {}) }) });
    const body = await response.json() as { data?: AutomationRunResult; error?: { message?: string } };
    if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể cập nhật lịch sử chạy.");
    return body.data;
  }
  async function runAutomaticPipeline() {
    if (!analysisVideoId || isAutomaticRunning || automaticRunLockRef.current) return;
    automaticRunLockRef.current = true;
    const settings: AutomationSettings = { artStyle: ideaArtStyle.trim() || "Hoạt hình 3D", aspectRatio };
    let currentSteps = createAutomationSteps();
    let runId = "";
    let activeStep = "";
    let currentIdea: ModelingIdeaResult | null = null;
    let createdProject: ContentProjectResult | null = null;
    let runAttemptCount = 0;
    let incidentHistory: unknown[] = [];
    let resumedFromCheckpoint = false;
    let resumeStage: 1 | 2 | 3 | 4 | 5 | null = null;
    let heartbeatTimer: number | undefined;
    const selectedChannelId = channelId || dashboard?.channel?.id || channels[0]?.id;
    setExecutionMode("automatic");
    setIsAutomaticRunning(true);
    setAutomationSteps(currentSteps);
    setAutomationRunId("");
    setContentProjectError("");
    setError("");
    try {
      if (!selectedChannelId) throw new Error("NEEDS_REVIEW: Chưa xác định được Channel cho checkpoint.");
      // A Stage-1 validation explicitly starts a new run, leaving an older
      // checkpoint for the same source untouched.
      let decision: ResumeDecision = resumeSelection.stopAfterStage === 1 ? { status: "NONE" } : resumableDecision;
      if (decision.status === "NONE" && resumeSelection.stopAfterStage !== 1) {
        const response = await fetch(`/api/v1/automations?sourceVideoId=${encodeURIComponent(analysisVideoId)}&channelId=${encodeURIComponent(selectedChannelId)}`);
        const body = await response.json() as { data?: AutomationRunResult[]; error?: { message?: string } };
        if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể kiểm tra checkpoint tự động.");
        decision = resolveResumableRun(body.data, { sourceVideoId: analysisVideoId, channelId: selectedChannelId, runId: resumeSelection.runId || undefined, modelingIdeaId: resumeSelection.modelingIdeaId || undefined });
        setResumableDecision(decision);
      }
      if (decision.status === "NEEDS_REVIEW") throw new Error(`NEEDS_REVIEW: ${decision.reason}`);
      if (decision.status === "ACTIVE_RUN_IN_PROGRESS") throw new Error(`ACTIVE_RUN_IN_PROGRESS: ${decision.runId}`);
      if (decision.status === "RESUME") {
        resumedFromCheckpoint = true;
        resumeStage = decision.failedStage;
        runId = decision.run.id;
        currentIdea = decision.modelingIdea as ModelingIdeaResult;
        runAttemptCount = (decision.run.attemptCount ?? decision.checkpoint.attemptCount ?? 0) + 1;
        incidentHistory = Array.isArray(decision.run.incidentHistory) ? decision.run.incidentHistory : Array.isArray(decision.checkpoint.incidentHistory) ? decision.checkpoint.incidentHistory : [];
        currentSteps = prepareResumeSteps(decision.run.steps ?? []).map((step) => ({ ...step })) as AutomationStep[];
        if (!appSessionIdRef.current) appSessionIdRef.current = crypto.randomUUID();
        const resumeStepKey = resumeStage === 2 ? "content-project" : resumeStage === 3 ? "images" : resumeStage === 4 ? "videos" : "final-video";
        automaticExecutionRef.current = { runId, executionId: crypto.randomUUID(), appSessionId: appSessionIdRef.current, startedAt: new Date().toISOString(), activeStage: resumeStepKey };
        setModelingIdea(currentIdea);
        setAutomationSteps(currentSteps);
        const resumeLastCompletedStage = Math.max(0, (resumeStage ?? 2) - 1) as 0 | 1 | 2 | 3 | 4;
        await updateAutomationRun(runId, currentSteps, {
          status: "RUNNING",
          ideaId: decision.modelingIdeaId,
          modelingIdeaId: decision.modelingIdeaId,
          channelId: selectedChannelId,
          attemptCount: runAttemptCount,
          lastCompletedStage: resumeLastCompletedStage,
          failedStage: resumeStage,
          resumeTarget: resumeTargetForStage(resumeStage ?? 2),
          incidentHistory,
          failureFingerprint: decision.run.failureFingerprint ?? null,
          checkpoint: checkpointPatch(decision.checkpoint, { lastCompletedStage: resumeLastCompletedStage, failedStage: resumeStage, resumeTarget: resumeTargetForStage(resumeStage ?? 2), attemptCount: runAttemptCount, incidentHistory, failureFingerprint: decision.run.failureFingerprint ?? null }),
        });
        setMessage(`Đang tiếp tục phiên chạy từ ${resumeStepKey}.`);
      } else {
        const run = await createAutomationRun(settings, currentSteps);
        runId = run.id;
        runAttemptCount = run.attemptCount ?? 0;
        if (!appSessionIdRef.current) appSessionIdRef.current = crypto.randomUUID();
        automaticExecutionRef.current = { runId, executionId: crypto.randomUUID(), appSessionId: appSessionIdRef.current, startedAt: new Date().toISOString(), activeStage: "modeling-idea" };
      }
      setAutomationRunId(runId);
      heartbeatTimer = window.setInterval(() => {
        if (automaticExecutionRef.current?.runId === runId) void updateAutomationRun(runId, currentSteps).catch(() => {});
      }, 10_000);
      if (resumedFromCheckpoint && decision.status === "RESUME") assertNoWrongStageRestart(decision.checkpoint, decision.failedStage);
      const changeStep = async (key: string, status: AutomationStep["status"], detail?: string, stepError?: string, fields: AutomationPersistenceFields = {}) => {
        if (automaticExecutionRef.current?.runId === runId) automaticExecutionRef.current.activeStage = key;
        const timestamp = new Date().toISOString();
        currentSteps = currentSteps.map((step) => step.key === key
          ? { ...step, status, ...(detail ? { detail } : {}), ...(stepError ? { error: stepError } : {}), ...(status === "running" ? { startedAt: timestamp } : {}), ...(status === "completed" || status === "failed" ? { completedAt: timestamp } : {}) }
          : step);
        setAutomationSteps(currentSteps);
        await updateAutomationRun(runId, currentSteps, fields);
      };
      if (!currentIdea) {
        if (resumedFromCheckpoint) throw new Error("RESUME_STATE_INCONSISTENT");
        activeStep = "modeling-idea";
        await changeStep(activeStep, "running", "Đang tạo một Modeling Idea từ kết quả phân tích...");
        currentIdea = await generateModelingIdea(runId);
        if (!currentIdea) throw new Error("Không tạo được Modeling Idea.");
        await changeStep(activeStep, "completed", `Đã tạo: ${currentIdea.title}`, undefined, {
          ideaId: currentIdea.id,
          modelingIdeaId: currentIdea.id,
          channelId: selectedChannelId,
          lastCompletedStage: 1,
          failedStage: null,
          resumeTarget: null,
          attemptCount: runAttemptCount,
          incidentHistory,
          checkpoint: { version: 1, runId, lastCompletedStage: 1, failedStage: null, resumeTarget: null, modelingIdeaId: currentIdea.id, sourceVideoId: analysisVideoId, channelId: selectedChannelId, attemptCount: runAttemptCount, incidentHistory },
        });
        const selectedChannel = channels.find((channel) => channel.id === selectedChannelId);
        const publishingSettings: AutomationSettings = {
          ...settings,
          postText: currentIdea.postText,
          hashtags: selectedChannel?.hashtags?.trim() ?? "",
          language: selectedChannel?.language ?? "",
          targetCountry: selectedChannel?.targetCountry ?? "",
        };
        await updateAutomationRun(runId, currentSteps, {
          ideaId: currentIdea.id,
          modelingIdeaId: currentIdea.id,
          channelId: selectedChannelId,
          settings: publishingSettings,
          lastCompletedStage: 1,
          failedStage: null,
          resumeTarget: null,
          attemptCount: runAttemptCount,
          incidentHistory,
          checkpoint: { version: 1, runId, lastCompletedStage: 1, failedStage: null, resumeTarget: null, modelingIdeaId: currentIdea.id, sourceVideoId: analysisVideoId, channelId: selectedChannelId, attemptCount: runAttemptCount, incidentHistory, failureFingerprint: null },
        });
        if (resumeSelection.stopAfterStage === 1) {
          await updateAutomationRun(runId, currentSteps, {
            status: "PAUSED",
            ideaId: currentIdea.id,
            modelingIdeaId: currentIdea.id,
            channelId: selectedChannelId,
            error: null,
            lastCompletedStage: 1,
            failedStage: null,
            resumeTarget: null,
            checkpoint: { version: 1, runId, lastCompletedStage: 1, failedStage: null, resumeTarget: null, modelingIdeaId: currentIdea.id, sourceVideoId: analysisVideoId, channelId: selectedChannelId, attemptCount: runAttemptCount, incidentHistory, failureFingerprint: null },
          });
          setMessage("Đã dừng sau Stage 1 để kiểm tra Modeling Idea.");
          return;
        }
      }

      if (!resumedFromCheckpoint || (resumeStage ?? 2) <= 2) {
        activeStep = "content-project";
        await changeStep(activeStep, "running", "Đang phát triển ý tưởng thành Content Project...", undefined, resumedFromCheckpoint ? {
          ideaId: currentIdea.id,
          modelingIdeaId: currentIdea.id,
          channelId: selectedChannelId,
          lastCompletedStage: 1,
          failedStage: 2,
          resumeTarget: "CONTENT_PROJECT_CREATION",
          attemptCount: runAttemptCount,
          incidentHistory,
        } : {});
        createdProject = await createContentProject(currentIdea, true, runId);
        const project = createdProject;
        if (!project) throw new Error("Không tạo được Content Project và phân cảnh.");
        await changeStep(activeStep, "completed", `Đã tạo ${project.scenes.length} phân cảnh.`);
        await updateAutomationRun(runId, currentSteps, { projectId: project.id, ideaId: currentIdea.id, modelingIdeaId: currentIdea.id, channelId: selectedChannelId, error: null, lastCompletedStage: 2, failedStage: null, resumeTarget: null, failureFingerprint: null, attemptCount: runAttemptCount, incidentHistory, sourceModelingSpecVersion: project.sourceModelingSpecVersion ?? null, checkpoint: { version: 1, runId, lastCompletedStage: 2, failedStage: null, resumeTarget: null, modelingIdeaId: currentIdea.id, sourceVideoId: analysisVideoId, channelId: selectedChannelId, attemptCount: runAttemptCount, incidentHistory, failureFingerprint: null, contentProjectId: project.id, sourceModelingSpecVersion: project.sourceModelingSpecVersion ?? null } });
        if (resumeSelection.stopAfterStage === 2) {
          await updateAutomationRun(runId, currentSteps, { status: "PAUSED", projectId: project.id, ideaId: currentIdea.id, modelingIdeaId: currentIdea.id, channelId: selectedChannelId, error: null, lastCompletedStage: 2, failedStage: null, resumeTarget: null, failureFingerprint: null, attemptCount: runAttemptCount, incidentHistory, sourceModelingSpecVersion: project.sourceModelingSpecVersion ?? null, checkpoint: { version: 1, runId, lastCompletedStage: 2, failedStage: null, resumeTarget: null, modelingIdeaId: currentIdea.id, sourceVideoId: analysisVideoId, channelId: selectedChannelId, attemptCount: runAttemptCount, incidentHistory, failureFingerprint: null, contentProjectId: project.id, sourceModelingSpecVersion: project.sourceModelingSpecVersion ?? null } });
          setMessage("Validation đã dừng sau Stage 2.");
          return;
        }
      }

      if (!createdProject && resumedFromCheckpoint && resumeStage !== null && resumeStage >= 3 && decision.status === "RESUME") {
        const projectId = decision.run.projectId ?? decision.checkpoint.contentProjectId;
        if (!projectId) throw new Error("RESUME_STATE_INCONSISTENT: thiếu Content Project cho Stage 3.");
        const response = await fetch(`/api/v1/projects/${encodeURIComponent(String(projectId))}`);
        const body = await response.json() as { data?: ContentProjectResult; error?: { message?: string } };
        if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể tải lại Content Project để tiếp tục Stage 3.");
        createdProject = body.data;
        setContentProject(body.data);
      }

      const project = createdProject;
      if (!project) throw new Error("Không tạo được Content Project và phân cảnh.");

      const targetStage = resumedFromCheckpoint ? (resumeStage ?? 2) : 1;
      let images = generatedImages;
      if (targetStage <= 3) {
        activeStep = "images";
        await changeStep(activeStep, "running", "Đang tạo ảnh bằng Gemini qua trình duyệt...");
        const generated = await generateAllProjectImages(project, undefined, generatedImages, runId);
        if (!generated) throw new Error("Không tạo đủ ảnh bằng Gemini.");
        images = generated;
        await changeStep(activeStep, "completed", `Đã tạo ${Object.keys(images).length} ảnh và lưu vào app.`);
        if (resumeSelection.stopAfterStage === 3) {
          // Stop the heartbeat before the terminal persistence write so an
          // in-flight RUNNING heartbeat cannot restore the execution lease.
          if (heartbeatTimer) {
            window.clearInterval(heartbeatTimer);
            heartbeatTimer = undefined;
          }
          if (automaticExecutionRef.current?.runId === runId) automaticExecutionRef.current = null;
          await updateAutomationRun(runId, currentSteps, { status: "PAUSED", projectId: project.id, ideaId: currentIdea.id, modelingIdeaId: currentIdea.id, channelId: selectedChannelId, error: null, lastCompletedStage: 3, failedStage: null, resumeTarget: null, failureFingerprint: null, attemptCount: runAttemptCount, incidentHistory, sourceModelingSpecVersion: project.sourceModelingSpecVersion ?? null, checkpoint: { version: 1, runId, lastCompletedStage: 3, failedStage: null, resumeTarget: null, modelingIdeaId: currentIdea.id, sourceVideoId: analysisVideoId, channelId: selectedChannelId, attemptCount: runAttemptCount, incidentHistory, failureFingerprint: null, contentProjectId: project.id, sourceModelingSpecVersion: project.sourceModelingSpecVersion ?? null, executionLease: null } });
          setMessage("Validation đã dừng sau Stage 3.");
          return;
        }
      } else {
        images = await loadPersistedProjectImages(project.id, project.scenes);
        setGeneratedImages(images);
        setShowGeneratedImages(Object.keys(images).length > 0);
      }

      let videos = generatedVideos;
      if (targetStage <= 4) {
        const persistedVideos = await loadPersistedProjectVideos(project.id, project.scenes);
        videos = { ...persistedVideos, ...generatedVideos };
        setGeneratedVideos(videos);
        activeStep = "videos";
        await changeStep(activeStep, "running", "Đang tạo video cho từng phân cảnh...");
        const generated = await generateAllProjectVideos(project, images, undefined, videos);
        if (!generated) throw new Error(videoProvider === "flow" ? "Không tạo đủ video bằng Flow qua CDP." : "Không tạo đủ video bằng Gemini qua CDP.");
        videos = generated;
        await changeStep(activeStep, "completed", `Đã tạo ${Object.keys(videos).length} video phân cảnh.`);
        if (resumeSelection.stopAfterStage === 4) {
          if (heartbeatTimer) {
            window.clearInterval(heartbeatTimer);
            heartbeatTimer = undefined;
          }
          if (automaticExecutionRef.current?.runId === runId) automaticExecutionRef.current = null;
          await updateAutomationRun(runId, currentSteps, { status: "PAUSED", projectId: project.id, ideaId: currentIdea.id, modelingIdeaId: currentIdea.id, channelId: selectedChannelId, error: null, lastCompletedStage: 4, failedStage: null, resumeTarget: null, failureFingerprint: null, attemptCount: runAttemptCount, incidentHistory, sourceModelingSpecVersion: project.sourceModelingSpecVersion ?? null, checkpoint: { version: 1, runId, lastCompletedStage: 4, failedStage: null, resumeTarget: null, modelingIdeaId: currentIdea.id, sourceVideoId: analysisVideoId, channelId: selectedChannelId, attemptCount: runAttemptCount, incidentHistory, failureFingerprint: null, contentProjectId: project.id, sourceModelingSpecVersion: project.sourceModelingSpecVersion ?? null, executionLease: null } });
          setMessage("Validation đã dừng sau Stage 4.");
          return;
        }
      } else {
        videos = await loadPersistedProjectVideos(project.id, project.scenes);
        setGeneratedVideos(videos);
        setShowGeneratedVideos(Object.keys(videos).length > 0);
      }

      activeStep = "final-video";
      await changeStep(activeStep, "running", "Đang ghép video hoàn chỉnh...");
      const finalVideo = await renderFinalProjectVideo(project, videos);
      if (!finalVideo) throw new Error("Không xuất được video hoàn chỉnh.");
      await changeStep(activeStep, "completed", "Đã nhận video hoàn chỉnh và lưu vào app.");
      await updateAutomationRun(runId, currentSteps, { status: "SUCCEEDED", ideaId: currentIdea.id, modelingIdeaId: currentIdea.id, channelId: selectedChannelId, projectId: project.id, lastCompletedStage: 5, failedStage: null, resumeTarget: null, error: null, attemptCount: runAttemptCount, incidentHistory, checkpoint: { version: 1, runId, lastCompletedStage: 5, failedStage: null, resumeTarget: null, modelingIdeaId: currentIdea.id, sourceVideoId: analysisVideoId, channelId: selectedChannelId, attemptCount: runAttemptCount, incidentHistory, contentProjectId: project.id, sourceModelingSpecVersion: project.sourceModelingSpecVersion ?? null } });
      setMessage("Đã chạy tự động toàn bộ quy trình và tạo video hoàn chỉnh. Có thể xem lại tại Lịch sử hoạt động.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Quy trình tự động không hoàn tất.";
      if (!contentProjectTroubleshootingHandled.current) notifyRuntimeFailure(caught, { operation: "automatic-pipeline", stage: activeStep, automationRunId: runId });
      const providerBlocked = isFlowProviderUnusualActivityError(caught);
      setContentProjectError(providerBlocked ? FLOW_PROVIDER_UNUSUAL_ACTIVITY_MESSAGE : message);
      if (providerBlocked) setGeminiVideoMessage("FLOW_PROVIDER_UNUSUAL_ACTIVITY · Tạm dừng để tránh retry liên tục.");
      setError(message);
      if (resumedFromCheckpoint && !activeStep) return;
      if (runId) {
        try {
          if (heartbeatTimer) {
            window.clearInterval(heartbeatTimer);
            heartbeatTimer = undefined;
          }
          if (automaticExecutionRef.current?.runId === runId) automaticExecutionRef.current = null;
          const timestamp = new Date().toISOString();
          currentSteps = currentSteps.map((step) => step.key === activeStep && step.status !== "completed" ? { ...step, status: "failed", error: message, completedAt: timestamp } : step);
          setAutomationSteps(currentSteps);
          const failedStage = activeStep === "modeling-idea" ? 1 : activeStep === "content-project" ? 2 : activeStep === "images" ? 3 : activeStep === "videos" ? 4 : 5;
          await updateAutomationRun(runId, currentSteps, {
            status: "FAILED",
            error: message,
            modelingIdeaId: currentIdea?.id ?? null,
            channelId: selectedChannelId,
            lastCompletedStage: Math.max(0, failedStage - 1),
            failedStage,
            resumeTarget: resumeTargetForStage(failedStage),
            attemptCount: runAttemptCount,
            incidentHistory,
            failureFingerprint: failedStage === 2 ? "content_project_scene_creation_failed_after_modeling_idea_success" : null,
            checkpoint: { version: 1, runId, lastCompletedStage: Math.max(0, failedStage - 1), failedStage, resumeTarget: resumeTargetForStage(failedStage), modelingIdeaId: currentIdea?.id ?? null, sourceVideoId: analysisVideoId, channelId: selectedChannelId, attemptCount: runAttemptCount, incidentHistory, contentProjectId: createdProject?.id ?? null, sourceModelingSpecVersion: createdProject?.sourceModelingSpecVersion ?? null, failureFingerprint: failedStage === 2 ? "content_project_scene_creation_failed_after_modeling_idea_success" : null, executionLease: null },
          });
        } catch {
          setError(`${message} Không thể lưu đầy đủ lịch sử hoạt động.`);
        }
      }
    } finally {
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      if (automaticExecutionRef.current?.runId === runId) automaticExecutionRef.current = null;
      setIsAutomaticRunning(false);
      automaticRunLockRef.current = false;
    }
  }
  function showCodexProgress(job: CodexJobResult) {
    setCodexJobId(job.id);
    setAutomationRunId(job.automationRunId ?? job.id);
    setAutomationSteps(job.stages.map((stage) => ({
      key: stage.stage.toLowerCase(),
      label: stage.stage === "ANALYSIS" ? "Phân tích Source Video" : stage.stage === "MODELING" ? "Tạo Modeling Idea" : stage.stage === "PROJECT" ? "Tạo Content Project và phân cảnh" : stage.stage === "ASSETS" ? "Tạo và kiểm tra ảnh" : stage.stage === "SCENES" ? "Tạo và kiểm tra video phân cảnh" : stage.stage === "FINAL_ASSEMBLY" ? "Ghép video hoàn chỉnh" : stage.stage === "FINAL_AUDIT" ? "Final Audit" : "Post-Run Review",
      status: stage.status === "COMPLETED" || stage.status === "SKIPPED" ? "completed" : stage.status === "RUNNING" || stage.status === "RETRYING" ? "running" : stage.status === "FAILED" ? "failed" : "pending",
      detail: stage.validationResult ? `Validation: ${stage.validationResult}` : undefined,
    })));
    const latestDiagnosis = [...(job.events ?? [])].reverse().find((event) => event.type === "ERROR_DIAGNOSED");
    const diagnosisPayload = latestDiagnosis?.payload ?? {};
    const activeStage = job.stages.find((stage) => stage.stage === (job.currentStage ?? job.nextAction.stage));
    const finalAuditStage = job.stages.find((stage) => stage.stage === "FINAL_AUDIT");
    const completionStatus = finalAuditStage?.validationResult === "PASS"
      ? "VIDEO COMPLETE — Final Audit PASS"
      : finalAuditStage?.validationResult
        ? `VIDEO COMPLETE — Final Audit ${finalAuditStage.validationResult} (chỉ ghi nhận cải tiến)`
        : "VIDEO COMPLETE — Final Audit đã chạy";
    const targetIds = Array.isArray(diagnosisPayload.targetIds) ? diagnosisPayload.targetIds.filter((value): value is string => typeof value === "string") : job.nextAction.targetIds ?? [];
    const recoveryDetail = [
      latestDiagnosis?.reasoningSummary ? `Chẩn đoán: ${latestDiagnosis.reasoningSummary}` : null,
      `Strategy: ${String(diagnosisPayload.selectedStrategy ?? job.nextAction.strategy ?? "đang chọn")}`,
      `Tool: ${String(diagnosisPayload.selectedTool ?? job.nextAction.name)}`,
      targetIds.length ? `Mục tiêu: ${targetIds.join(", ")}` : null,
      activeStage ? `Retry: ${activeStage.retryCount}/${job.status === "RECOVERING" ? "∞" : activeStage.maxRetries ?? 3}` : null,
    ].filter(Boolean).join(" · ");
    setCodexStatus(job.status === "RECOVERING" ? recoveryDetail : job.status === "NEEDS_ENGINEERING" ? `NEEDS_ENGINEERING: ${job.nextAction.reason ?? "Codex đang xử lý lỗi code trong workspace được bảo vệ."}` : job.status === "NEEDS_HUMAN" ? `Cần kiểm tra thủ công: ${job.nextAction.reason ?? "đã hết giới hạn recovery"}` : job.status === "COMPLETED" ? completionStatus : job.status === "PLANNING" ? "Worker nền đang tạo Execution Plan..." : `Bước tiếp theo: ${job.nextAction.stage ?? job.nextAction.name}`);
    const latestResumeEvent = [...(job.events ?? [])].reverse().find((event) => event.type === "JOB_AUTO_RESUMED" || event.type === "RUNTIME_REPAIR_VERIFIED");
    if (latestResumeEvent?.type === "JOB_AUTO_RESUMED") {
      setCodexErrorDeliveryStatus(`Bản sửa đã được nạp · Codex đã tự tiếp tục stage ${latestResumeEvent.stage ?? job.nextAction.stage ?? "đang lỗi"}`);
      return;
    }
    const latestFailure = job.runtimeFailures?.[0];
    if (latestFailure) {
      const delivery = latestFailure.status === "SENT_TO_CODEX" || latestFailure.status === "RECOVERY_REQUESTED"
        ? "Đã gửi lỗi về Codex"
        : latestFailure.status === "QUEUED" || latestFailure.status === "SENDING"
          ? "Đang gửi lỗi về Codex..."
          : latestFailure.status === "PENDING"
            ? "Đã ghi nhận lỗi; đang chờ gửi về Codex"
            : latestFailure.status === "NEEDS_USER_CONTEXT"
              ? "Chưa gửi được lỗi về Codex: cần thêm ngữ cảnh"
              : "Chưa gửi được lỗi về Codex";
      setCodexErrorDeliveryStatus(`${delivery} · ${latestFailure.code}`);
      return;
    }
    const latestEvent = [...(job.events ?? [])].reverse().find((event) => ["RUNTIME_FAILURE_REPORTED", "CODEX_WAKE_REQUESTED", "CODEX_WAKE_FAILED", "TOOL_FAILED"].includes(event.type));
    setCodexErrorDeliveryStatus(latestEvent?.type === "CODEX_WAKE_FAILED" ? "Chưa gửi được lỗi về Codex" : latestEvent ? "Đã gửi lỗi về Codex · Codex đang chẩn đoán" : "");
  }
  async function createCodexRun(settings: AutomationSettings) {
    const response = await fetch("/api/v1/codex/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceVideoId: analysisVideoId, idempotencyKey: `codex:${analysisVideoId}:${crypto.randomUUID()}`, settings }) });
    const body = await response.json() as { data?: CodexJobResult; error?: { message?: string } };
    if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể tạo Codex job.");
    return body.data;
  }
  async function runWithCodex() {
    if (!analysisVideoId || isAutomaticRunning) return;
    const settings: AutomationSettings = { artStyle: ideaArtStyle.trim() || "Hoạt hình 3D", aspectRatio };
    setExecutionMode("codex");
    setIsAutomaticRunning(true);
    setCodexStatus("Đang giao job cho worker nền...");
    setContentProjectError("");
    setError("");
    try {
      let job = await createCodexRun(settings);
      showCodexProgress(job);
      for (let poll = 0; poll < 3_600 && !["COMPLETED", "FAILED", "NEEDS_HUMAN", "NEEDS_ENGINEERING"].includes(job.status); poll += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        const response = await fetch(`/api/v1/codex/jobs/${job.id}`);
        const body = await response.json() as { data?: CodexJobResult; error?: { message?: string } };
        if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không đọc được trạng thái Codex job.");
        job = body.data;
        showCodexProgress(job);
      }
      if (job.status !== "COMPLETED") throw new Error(job.nextAction.reason ?? (job.status === "NEEDS_ENGINEERING" ? "Codex phát hiện lỗi code cần sửa." : "Codex job chưa đạt Final Audit PASS."));
      const auditVerdict = job.stages.find((stage) => stage.stage === "FINAL_AUDIT")?.validationResult ?? "đã chạy";
      setMessage(`Codex đã hoàn thành video ở bước Final Assembly. Final Audit ${auditVerdict} được lưu để cải tiến, không chặn phát hành.`);
    } catch (caught) {
      const failure = caught instanceof Error ? caught.message : "Codex job chưa hoàn tất.";
      notifyRuntimeFailure(caught, { operation: "codex-pipeline", codexJobId });
      setContentProjectError(failure);
      setError(failure);
      setCodexStatus(failure);
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
      notifyRuntimeFailure(caught, { operation: "save-manual-video" });
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
      {contentProject && <SourceFidelityStatus project={contentProject} promptFidelityStatus={promptFidelityStatus} />}
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
              <label className="mt-3 block text-sm font-semibold text-[#0b3262]">Luồng tạo video trước khi chạy tự động<select aria-label="Luồng tạo video trước khi chạy tự động" value={videoProvider} onChange={(event) => setVideoProvider(event.target.value as VideoProvider)} disabled={isAutomaticRunning || isGeneratingVideos} className="mt-1 w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-2.5 font-normal"><option value="flow">Luồng 1 · Google Flow qua CDP</option><option value="gemini">Luồng 2 · Gemini qua CDP</option></select></label>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" onClick={() => void runAutomaticPipeline()} disabled={isAutomaticRunning || resumableDecision.status === "NEEDS_REVIEW" || resumableDecision.status === "ACTIVE_RUN_IN_PROGRESS"} className="rounded-lg bg-[#7c3aed] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60">{isAutomaticRunning ? "Đang chạy tự động..." : resumableDecision.status === "RESUME" ? "Tiếp tục phiên chạy" : resumableDecision.status === "ACTIVE_RUN_IN_PROGRESS" ? "Phiên chạy đang hoạt động" : resumableDecision.status === "NEEDS_REVIEW" ? "Cần xem xét checkpoint" : "Chạy tự động đến khi video hoàn chỉnh"}</button>
              </div>
              {automationSteps.length > 0 && <div className="mt-4 space-y-2 rounded-lg border border-violet-200 bg-white p-3">{automationSteps.map((step) => <div key={step.key} className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold text-[#0b3262]">{step.label}</span><span className={step.status === "completed" ? "font-bold text-emerald-700" : step.status === "failed" ? "font-bold text-rose-700" : step.status === "running" ? "font-bold text-amber-700" : "text-[#7990b0]"}>{step.status === "completed" ? "Đã xong" : step.status === "failed" ? "Lỗi" : step.status === "running" ? "Đang chạy" : "Chờ chạy"}</span></div>)}</div>}
              {automationRunId && <p className="mt-2 text-xs text-[#7990b0]">Mã phiên: {automationRunId}. Có thể xem lại tại Lịch sử hoạt động.</p>}
              {codexJobId && <div className="mt-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800"><p>CODEX AGENT · {codexStatus} · Job {codexJobId}</p>{codexErrorDeliveryStatus && <p className="mt-1 font-bold">{codexErrorDeliveryStatus}</p>}</div>}
            </div>
            <div className="mt-6 rounded-xl border border-[#d8e3f1] bg-[#f7f9fc] p-4">
              <p className="font-extrabold text-[#0b3262]">Tạo Modeling Idea</p>
              <p className="mt-1 text-sm text-[#6883aa]">Tạo đúng 1 ý tưởng mới dựa trên cơ chế thành công của video gốc.</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex-1 text-sm font-semibold text-[#0b3262]">Phong cách mỹ thuật<select value={ideaArtStyle} onChange={(event) => setIdeaArtStyle(event.target.value)} className="mt-1 w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-2.5 font-normal"><option>Hoạt hình 3D</option><option>Hoạt hình 2D</option><option>Stop motion đất sét</option><option>Anime</option><option>Điện ảnh chân thực</option><option>Truyện tranh</option><option>Pixel art</option></select></label>
                <p className="self-end rounded-lg border border-[#cbd9ea] bg-white px-4 py-2.5 text-sm font-semibold text-[#6883aa]">Tự động trong phiên chạy</p>
              </div>
              {modelingIdeaError && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{modelingIdeaError}</p>}
              {contentProjectRecoveryStatus && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">{contentProjectRecoveryStatus}{contentProjectIncidentId && <span className="ml-2">· Incident: {contentProjectIncidentId.slice(0, 12)}</span>}</p>}
              {contentProjectError && isFlowProviderUnusualActivityError(contentProjectError) && <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900"><p className="whitespace-pre-line font-bold">{FLOW_PROVIDER_UNUSUAL_ACTIVITY_MESSAGE}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { const flow = (window as Window & { desktopFlow?: DesktopFlow }).desktopFlow; if (flow) void flow.open(); }} className="rounded-lg border border-amber-700 bg-white px-3 py-2 font-bold text-amber-800">Mở Flow</button>{resumableDecision.status === "RESUME" && <button type="button" onClick={() => { void runAutomaticPipeline(); }} className="rounded-lg bg-emerald-700 px-3 py-2 font-bold text-white">Resume</button>}</div></div>}
               {modelingIdea && <div className="mt-5 space-y-4 border-t border-[#d8e3f1] pt-4 text-sm leading-6 text-[#0b3262]"><AnalysisBlock label="Ý tưởng" value={`${modelingIdea.title}\n${modelingIdea.coreConcept}`} /><AnalysisBlock label="Kịch bản" value={modelingIdea.script} /><AnalysisBlock label="Xây dựng hình tượng nhân vật" value={modelingIdea.characterDesign} /><AnalysisBlock label="Bối cảnh" value={modelingIdea.setting} /><AnalysisBlock label="Phong cách mỹ thuật" value={modelingIdea.artStyle} />
                  <div className="rounded-xl border border-[#d8e3f1] bg-[#f7f9fc] p-4"><p className="font-extrabold text-[#0b3262]">Tạo hình và phân cảnh</p><p className="mt-1 text-sm text-[#6883aa]">Giữ nhân vật và bối cảnh đồng nhất trong toàn bộ video.</p><div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"><label className="flex-1 text-sm font-semibold text-[#0b3262]">Kích thước khung hình<select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AutomationSettings["aspectRatio"])} disabled={isAutomaticRunning} className="mt-1 w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-2.5 font-normal"><option value="9:16">9:16 · Dọc</option><option value="16:9">16:9 · Ngang</option><option value="1:1">1:1 · Vuông</option><option value="4:5">4:5 · Dọc mạng xã hội</option></select></label><span className="self-end rounded-lg border border-[#cbd9ea] bg-white px-4 py-2.5 text-sm font-semibold text-[#6883aa]">Tự động trong phiên chạy</span></div>{contentProjectError && <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{contentProjectError}</p>}{contentProject && <div className="mt-5 space-y-4 border-t border-[#d8e3f1] pt-4"><div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-[#0b3262]"><p className="font-extrabold">SOURCE VIDEO MODELING</p><p className="mt-1"><strong>Chế độ:</strong> {contentProject.modelingPolicy === "STRICT_MODELING" ? "STRICT MODELING" : contentProject.modelingPolicy ?? "STRICT MODELING"} · <strong>Mục tiêu:</strong> {Math.round((contentProject.modelingFidelityTarget ?? 0.9) * 100)}–100%</p><p className="mt-1"><strong>Source video:</strong> {contentProject.sourceVideoUrl ? <a href={contentProject.sourceVideoUrl} target="_blank" rel="noreferrer" className="underline">{contentProject.sourceVideoUrl}</a> : "STRICT_SOURCE_VIDEO_MISSING"}</p>{contentProject.sourceModelingSpecVersion ? <p className="mt-1"><strong>Spec:</strong> v{contentProject.sourceModelingSpecVersion}</p> : <p className="mt-1 font-bold text-amber-700">SOURCE_MODELING_SPEC_MISSING — chưa được phép chạy strict generation.</p>}<p className="mt-2 font-semibold">Scene mapping:</p><div className="mt-1 flex flex-wrap gap-2">{contentProject.scenes.map((scene) => <span key={`mapping-${scene.sceneNumber}`} className="rounded bg-white px-2 py-1 text-xs font-semibold">Scene {scene.sceneNumber} → {scene.sourceSceneId ?? "SOURCE_SCENE_MAPPING_MISSING"}</span>)}</div></div><AnalysisBlock label="Thiết kế nhân vật đồng nhất" value={JSON.stringify(contentProject.characterDesign, null, 2)} /><AnalysisBlock label="Bối cảnh đồng nhất" value={JSON.stringify(contentProject.backgroundDesign, null, 2)} /><AnalysisBlock label="Khung hình" value={String(contentProject.artDirection.aspectRatio ?? aspectRatio)} /><div><p className="font-extrabold text-[#0b3262]">Các phân cảnh</p><div className="mt-2 space-y-3">{contentProject.scenes.map((scene) => <div key={scene.sceneNumber} className="rounded-lg border border-[#d8e3f1] bg-white p-3"><p className="font-bold text-[#0b5799]">Cảnh {scene.sceneNumber}{scene.sourceSceneId ? ` · ${scene.sourceSceneId}` : ""}</p>{scene.cameraSpec && <p className="mt-1"><strong>Camera source:</strong> {JSON.stringify(scene.cameraSpec)}</p>}{scene.actionSequence?.length ? <p className="mt-1"><strong>Action sequence:</strong> {scene.actionSequence.map((action, index) => `${index + 1}. ${action}`).join(" · ")}</p> : null}<p className="mt-1"><strong>Hình ảnh:</strong> {scene.visualBlock}</p><p className="mt-1"><strong>Hành động:</strong> {scene.actionBlock}</p><p className="mt-1"><strong>Âm thanh:</strong> {scene.audioBlock}</p><p className="mt-1"><strong>Prompt ảnh bắt đầu:</strong> {scene.startFramePrompt ?? "Chưa có; app sẽ dùng prompt dự phòng cho ảnh bắt đầu."}</p><p className="mt-1"><strong>Prompt video 4 giây:</strong> {scene.englishPrompt ?? "Chưa có; app sẽ dùng prompt dự phòng cho video."}</p>{scene.timingStatus === "SOURCE_TIMING_DRIFT" && <p className="mt-1 font-bold text-amber-700">SOURCE_TIMING_DRIFT</p>}</div>)}</div></div></div>}</div>
              </div>}
              {contentProject && <div className="mt-4 space-y-3">
                {flowImageSlots.length > 0 && <div className="rounded-xl border border-[#d8e3f1] bg-[#f7f9fc] p-4"><p className="font-extrabold text-[#0b3262]">Quy trình Google Flow qua trình duyệt</p><p className="mt-1 text-sm leading-6 text-[#6883aa]">App dùng Character Identity Pack đã khóa của Channel làm source-of-truth, sau đó tạo ảnh bối cảnh và ảnh bắt đầu từng phân cảnh với Scene Appearance State tương ứng.</p>{flowImageMessage && <p className="mt-2 text-sm font-semibold text-[#0b5799]">{flowImageMessage}</p>}<p className="mt-2 text-xs text-[#6883aa]">Cần đăng nhập Google Flow trong cửa sổ mở ra. Không xử lý CAPTCHA tự động.</p></div>}
                {Object.keys(generatedImages).length > 0 && <button type="button" onClick={() => setShowGeneratedImages((visible) => !visible)} className="ml-2 rounded-lg border border-[#0b5799] px-4 py-2.5 text-sm font-bold text-[#0b5799]">{showGeneratedImages ? "Ẩn ảnh" : "Xem ảnh"}</button>}
                {showGeneratedImages && <div className="mt-4 grid gap-4 sm:grid-cols-2">{generatedImages["character-0"] && <figure><img src={generatedImages["character-0"]} alt="Hình tượng nhân vật" className="w-full rounded-lg border border-[#d8e3f1]" /><figcaption className="mt-1 text-sm font-semibold">Nhân vật</figcaption></figure>}{generatedImages["background-0"] && <figure><img src={generatedImages["background-0"]} alt="Bối cảnh đồng nhất" className="w-full rounded-lg border border-[#d8e3f1]" /><figcaption className="mt-1 text-sm font-semibold">Bối cảnh</figcaption></figure>}{contentProject.scenes.map((scene) => generatedImages[`scene-${scene.sceneNumber}`] && <figure key={`image-${scene.sceneNumber}`}><img src={generatedImages[`scene-${scene.sceneNumber}`]} alt={`Ảnh cảnh ${scene.sceneNumber}`} className="w-full rounded-lg border border-[#d8e3f1]" /><figcaption className="mt-1 text-sm font-semibold">Cảnh {scene.sceneNumber}</figcaption></figure>)}</div>}
              </div>}
              {contentProject && contentProject.scenes.every((scene) => generatedImages[`scene-${scene.sceneNumber}`]) && (
                <div className="mt-5 border-t border-[#d8e3f1] pt-4">
                  <p className="text-sm font-semibold text-[#6883aa]">Video từng phân cảnh sẽ được tạo tự động trong phiên chạy.</p>
                  <div className="mt-3 rounded-xl border border-[#d8e3f1] bg-[#f7f9fc] p-4">
                    <p className="font-extrabold text-[#0b3262]">Chọn luồng tạo video</p>
                    <p className="mt-1 text-sm leading-6 text-[#6883aa]">Chọn một nhà cung cấp cho Stage tạo video. Lựa chọn này áp dụng cho phiên chạy tiếp theo và không làm lại video đã lưu.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Luồng tạo video">
                      <label className={`cursor-pointer rounded-lg border p-3 ${videoProvider === "flow" ? "border-[#0b5799] bg-white ring-2 ring-[#0b5799]/20" : "border-[#cbd9ea] bg-white"}`}>
                        <span className="flex items-start gap-3"><input type="radio" name="video-provider" value="flow" checked={videoProvider === "flow"} onChange={() => setVideoProvider("flow")} disabled={isAutomaticRunning || isGeneratingVideos} className="mt-1" /><span><span className="block font-bold text-[#0b3262]">Luồng 1 · Google Flow</span><span className="mt-1 block text-xs leading-5 text-[#6883aa]">Tạo qua trình duyệt Flow, giữ nguyên thao tác và checkpoint Flow hiện có.</span></span></span>
                      </label>
                      <label className={`cursor-pointer rounded-lg border p-3 ${videoProvider === "gemini" ? "border-[#6d28d9] bg-white ring-2 ring-[#6d28d9]/20" : "border-[#cbd9ea] bg-white"}`}>
                        <span className="flex items-start gap-3"><input type="radio" name="video-provider" value="gemini" checked={videoProvider === "gemini"} onChange={() => setVideoProvider("gemini")} disabled={isAutomaticRunning || isGeneratingVideos} className="mt-1" /><span><span className="block font-bold text-[#0b3262]">Luồng 2 · Gemini qua CDP</span><span className="mt-1 block text-xs leading-5 text-[#6883aa]">Tạo bằng trình duyệt Gemini/CDP qua hàng đợi Electron; không cần khóa API Veo.</span></span></span>
                      </label>
                    </div>
                  </div>
                  {geminiVideoMessage && <p className="mt-2 text-sm font-semibold text-[#6d28d9]">{geminiVideoMessage}</p>}
                  {Object.keys(generatedVideos).length > 0 && <button type="button" onClick={() => setShowGeneratedVideos((visible) => !visible)} className="ml-2 rounded-lg border border-[#7c3aed] px-4 py-2.5 text-sm font-bold text-[#6d28d9]">{showGeneratedVideos ? "Ẩn video" : "Xem video"}</button>}
                  {contentProject.scenes.every((scene) => generatedVideos[`scene-${scene.sceneNumber}`]) && <>
                    {false && showVideoEditor && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
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
          <label className="block"><span className="mb-2 block text-sm text-[#6883aa]">Khoảng thời gian</span><select value={periodHours} onChange={(event) => setPeriodHours(event.target.value)} className="w-full rounded-lg border border-[#cbd9ea] bg-white px-3 py-3 text-sm font-semibold text-[#0b3262]"><option value="24">24 giờ gần nhất</option><option value="72">3 ngày gần nhất</option><option value="168">7 ngày gần nhất</option><option value="336">14 ngày gần nhất</option></select></label>
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
            {appliedFilters.periodHours === "24" ? "24 giờ gần nhất" : `${appliedFilters.periodHours === "72" ? "3" : appliedFilters.periodHours === "336" ? "14" : "7"} ngày gần nhất`}
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
  return value === "24" ? "24 giờ" : value === "72" ? "3 ngày" : value === "336" ? "14 ngày" : "7 ngày";
}
