import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {
  competitorVideo: { findFirst: vi.fn(), update: vi.fn() },
  sourceAnalysis: { findFirst: vi.fn(), create: vi.fn() },
} }));

const analysis = {
  schemaVersion: "1.0",
  summary: "Video source được quan sát.", hook: "Cảnh mở đầu.", setup: "Bối cảnh.", conflict: "Mâu thuẫn.", escalation: "Leo thang.", twist: "Bất ngờ.", payoff: "Kết quả.", theGag: "Mảng hài.", cameraPattern: "Máy quay.", editingRhythm: "Nhịp dựng.", soundPattern: "Âm thanh.", retentionMechanism: "Giữ chân.", characterInteractions: [], whyItWorks: [],
  analysisEvidence: { sourceVideoAttached: true, observationMethod: "attached-video-file", observedDurationSec: 10.4 },
};

describe("authoritative captured source duration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("replaces the guessed Page-scan duration after Gemini receives the identity-bound source file", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.competitorVideo.findFirst).mockResolvedValue({ id: "video-1", duration: 25.4 } as never);
    vi.mocked(db.sourceAnalysis.findFirst).mockResolvedValue(null as never);
    vi.mocked(db.sourceAnalysis.create).mockResolvedValue({ id: "analysis-1", createdAt: new Date() } as never);
    const { storeCompetitorVideoAnalysis } = await import("./analysis-service");
    await storeCompetitorVideoAnalysis("video-1", "user-1", analysis, "gemini-browser");
    expect(db.competitorVideo.update).toHaveBeenCalledWith({ where: { id: "video-1" }, data: { duration: 10.4 } });
  });

  it("does not promote an unverified duration", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.competitorVideo.findFirst).mockResolvedValue({ id: "video-1" } as never);
    vi.mocked(db.sourceAnalysis.findFirst).mockResolvedValue(null as never);
    vi.mocked(db.sourceAnalysis.create).mockResolvedValue({ id: "analysis-1", createdAt: new Date() } as never);
    const { storeCompetitorVideoAnalysis } = await import("./analysis-service");
    await storeCompetitorVideoAnalysis("video-1", "user-1", { ...analysis, analysisEvidence: { sourceVideoAttached: false, observationMethod: "url-only" } }, "gemini-browser");
    expect(db.competitorVideo.update).not.toHaveBeenCalled();
  });
});
