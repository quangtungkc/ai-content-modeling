import { describe, expect, it, vi } from "vitest";
import { pollGenerationOperation } from "./job-service";

describe("Veo generation polling", () => {
  it("polls queued/running operations until completion", async () => {
    const getOperation = vi.fn().mockResolvedValueOnce({ status: "queued" }).mockResolvedValueOnce({ status: "running" }).mockResolvedValueOnce({ status: "succeeded", previewUrl: "https://cdn/video.mp4" });
    const result = await pollGenerationOperation({ getOperation }, "operations/1", 0, async () => undefined);
    expect(result).toMatchObject({ status: "succeeded", previewUrl: "https://cdn/video.mp4" });
    expect(getOperation).toHaveBeenCalledTimes(3);
  });
  it("stops and returns provider failures", async () => {
    const result = await pollGenerationOperation({ getOperation: vi.fn().mockResolvedValue({ status: "failed", error: "quota" }) }, "operations/2", 0, async () => undefined);
    expect(result).toMatchObject({ status: "failed", error: "quota" });
  });
});
