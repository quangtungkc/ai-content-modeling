import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MEDIA_DISCOVERY_TIMEOUT_MS, MAX_DURATION_WAIT_MS, normalizeDurationSeconds, selectBoundMediaCandidate, selectBoundMediaRelation, selectBoundMediaDuration, waitForBoundMediaDiscovery, waitForBoundMediaDuration } = require("./facebook-duration.cjs") as {
  MEDIA_DISCOVERY_TIMEOUT_MS: number;
  MAX_DURATION_WAIT_MS: number;
  normalizeDurationSeconds: (value: unknown) => number | null;
  selectBoundMediaCandidate: (candidates: Array<Record<string, unknown>>) => { status: string; candidate: Record<string, unknown> | null; reason: string };
  selectBoundMediaRelation: (candidates: Array<Record<string, unknown>>) => { status: string; candidate: Record<string, unknown> | null; reason: string };
  selectBoundMediaDuration: (candidates: Array<Record<string, unknown>>) => number | null;
  waitForBoundMediaDiscovery: (readCandidates: () => Promise<Array<Record<string, unknown>>>, options?: Record<string, unknown>) => Promise<{ status: string; candidate: Record<string, unknown> | null; pollCount: number; timedOut: boolean }>;
  waitForBoundMediaDuration: (readCandidates: () => Promise<Array<Record<string, unknown>>>, options?: Record<string, unknown>) => Promise<number | null>;
};

describe("Facebook browser duration binding", () => {
  it("CASE 1/2 extracts finite HTML media duration in seconds without rounding", () => {
    expect(selectBoundMediaDuration([{ duration: 13, visible: true, attached: true, boundToItem: true }])).toBe(13);
    expect(selectBoundMediaDuration([{ duration: 13.42, visible: true, attached: true, boundToItem: true }])).toBe(13.42);
    expect(normalizeDurationSeconds(13.42)).toBe(13.42);
  });

  it("CASE 3 waits only for a bounded metadata window", async () => {
    let polls = 0;
    const started = Date.now();
    const value = await waitForBoundMediaDuration(async () => { polls += 1; return []; }, { timeoutMs: 8, pollMs: 1 });
    expect(value).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
    expect(polls).toBeGreaterThan(0);
    expect(MAX_DURATION_WAIT_MS).toBe(2_000);
  });

  it("waits for lazy media discovery and returns as soon as one relation is valid", async () => {
    let polls = 0;
    const result = await waitForBoundMediaDiscovery(async () => { polls += 1; return polls < 3 ? [] : [{ visible: true, attached: true, relationVerified: true, readyState: 0 }]; }, { timeoutMs: 100, pollMs: 1 });
    expect(result.status).toBe("BOUND");
    expect(result.pollCount).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(MEDIA_DISCOVERY_TIMEOUT_MS).toBe(10_000);
  });

  it("treats a discovered readyState=0 media element as bound without waiting for duration", async () => {
    const result = selectBoundMediaRelation([{ visible: true, attached: true, relationVerified: true, readyState: 0, duration: Number.NaN }]);
    expect(result.status).toBe("BOUND");
    expect(result.candidate?.readyState).toBe(0);
  });

  it("accepts a unique structurally related offscreen candidate", () => {
    const result = selectBoundMediaRelation([{ visible: true, attached: true, relationVerified: true, viewportIntersecting: false, boundingBox: { y: -825 } }]);
    expect(result.status).toBe("BOUND");
    expect(result.candidate?.viewportIntersecting).toBe(false);
  });

  it("re-queries candidates after a detached first result", async () => {
    let polls = 0;
    const result = await waitForBoundMediaDiscovery(async () => { polls += 1; return polls === 1 ? [{ visible: true, attached: false, relationVerified: true }] : [{ visible: true, attached: true, relationVerified: true }]; }, { timeoutMs: 100, pollMs: 1 });
    expect(result.status).toBe("BOUND");
    expect(result.candidate?.attached).toBe(true);
  });

  it("keeps polling when the card exists before media and returns at the media deadline", async () => {
    let polls = 0;
    const result = await waitForBoundMediaDiscovery(async () => { polls += 1; return polls < 5 ? [] : [{ visible: true, attached: true, relationVerified: true }]; }, { timeoutMs: 100, pollMs: 1 });
    expect(result.status).toBe("BOUND");
    expect(polls).toBe(5);
  });

  it("returns bounded NOT_FOUND when media never appears", async () => {
    let polls = 0;
    const result = await waitForBoundMediaDiscovery(async () => { polls += 1; return []; }, { timeoutMs: 8, pollMs: 1 });
    expect(result.status).toBe("NOT_FOUND");
    expect(result.timedOut).toBe(true);
    expect(polls).toBeGreaterThan(0);
  });

  it("preserves the uniqueness guard for multiple related media candidates", async () => {
    const result = await waitForBoundMediaDiscovery(async () => [
      { visible: true, attached: true, relationVerified: true },
      { visible: true, attached: true, relationVerified: true },
    ], { timeoutMs: 8, pollMs: 1 });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.timedOut).toBe(true);
  });

  it("CASE 4/5 does not use unavailable metadata or caption text", () => {
    expect(selectBoundMediaDuration([{ duration: Number.NaN, visible: true, attached: true, boundToItem: true, caption: "0:13" }])).toBeNull();
    expect(selectBoundMediaDuration([])).toBeNull();
    expect(normalizeDurationSeconds("13")).toBeNull();
    expect(normalizeDurationSeconds(0)).toBeNull();
    expect(normalizeDurationSeconds(-1)).toBeNull();
    expect(normalizeDurationSeconds(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("CASE 6 binds one Reel card and rejects ambiguous unrelated media", () => {
    expect(selectBoundMediaDuration([
      { duration: 99, visible: true, attached: true, boundToItem: false },
      { duration: 13, visible: true, attached: true, boundToItem: true, sourceMatch: true },
    ])).toBe(13);
    expect(selectBoundMediaDuration([
      { duration: 13, visible: true, attached: true, boundToItem: true },
      { duration: 20, visible: true, attached: true, boundToItem: true },
    ])).toBeNull();
  });

  it("binds a verified sibling/common-scope media candidate without requiring src", () => {
    const result = selectBoundMediaCandidate([
      { duration: 13.5, visible: true, attached: true, relationVerified: true, relationReason: "COMMON_ANCESTOR_AND_SPATIAL", currentSrc: null, src: null },
    ]);
    expect(result.status).toBe("BOUND");
    expect(result.reason).toBe("COMMON_ANCESTOR_AND_SPATIAL");
    expect(selectBoundMediaDuration([{ duration: 13.5, visible: true, attached: true, relationVerified: true, currentSrc: null, src: null }])).toBe(13.5);
  });

  it("rejects unrelated document media and preserves direct card binding", () => {
    expect(selectBoundMediaDuration([
      { duration: 99, visible: true, attached: true, relationVerified: false },
      { duration: 13, visible: true, attached: true, relationVerified: true, relationReason: "DIRECT_CARD_DESCENDANT" },
    ])).toBe(13);
    expect(selectBoundMediaDuration([
      { duration: 13, visible: true, attached: true, relationVerified: true, sourceMatch: true },
      { duration: 99, visible: true, attached: true, relationVerified: true, sourceMatch: false },
    ])).toBe(13);
  });

  it("returns an explicit ambiguous result for two verified Reel candidates", () => {
    const result = selectBoundMediaCandidate([
      { duration: 13, visible: true, attached: true, relationVerified: true },
      { duration: 14, visible: true, attached: true, relationVerified: true },
    ]);
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.candidate).toBeNull();
  });

  it("returns an explicit not-found result when no verified candidate exists", () => {
    const result = selectBoundMediaCandidate([]);
    expect(result.status).toBe("NOT_FOUND");
    expect(result.reason).toBe("NO_VERIFIED_REEL_MEDIA");
  });

  it("CASE 3 waits for loaded media then returns the exact duration", async () => {
    let polls = 0;
    const value = await waitForBoundMediaDuration(async () => { polls += 1; return polls < 2 ? [{ duration: Number.NaN, visible: true, attached: true, boundToItem: true }] : [{ duration: 13.42, visible: true, attached: true, boundToItem: true }]; }, { timeoutMs: 100, pollMs: 1 });
    expect(value).toBe(13.42);
  });
});
