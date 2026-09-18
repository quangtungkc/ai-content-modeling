const MEDIA_DISCOVERY_TIMEOUT_MS = 10_000;
const MAX_DURATION_WAIT_MS = 2_000;
const DURATION_POLL_INTERVAL_MS = 100;

function normalizeDurationSeconds(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function selectBoundMediaCandidate(candidates) {
  const eligible = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.boundToItem !== false && candidate?.relationVerified !== false && candidate?.isAd !== true && candidate?.visible === true && candidate?.attached !== false && candidate?.hidden !== true && candidate?.zeroSize !== true)
    .map((candidate) => ({ ...candidate, durationSec: normalizeDurationSeconds(candidate.durationSec ?? candidate.duration) }))
    .filter((candidate) => candidate.durationSec !== null);
  const exact = eligible.filter((candidate) => candidate.sourceMatch === true);
  if (exact.length === 1) return { status: "BOUND", candidate: exact[0], eligibleCount: eligible.length, exactMatchCount: exact.length, reason: "EXACT_SOURCE_MATCH" };
  if (exact.length > 1) return { status: "AMBIGUOUS", candidate: null, eligibleCount: eligible.length, exactMatchCount: exact.length, reason: "MULTIPLE_EXACT_SOURCE_MATCHES" };
  if (eligible.length === 1) return { status: "BOUND", candidate: eligible[0], eligibleCount: eligible.length, exactMatchCount: exact.length, reason: eligible[0].relationReason || "VERIFIED_REEL_RELATION" };
  return { status: eligible.length === 0 ? "NOT_FOUND" : "AMBIGUOUS", candidate: null, eligibleCount: eligible.length, exactMatchCount: exact.length, reason: eligible.length === 0 ? "NO_VERIFIED_REEL_MEDIA" : "MULTIPLE_VERIFIED_REEL_MEDIA" };
}

function selectBoundMediaRelation(candidates) {
  const eligible = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.boundToItem !== false && candidate?.relationVerified !== false && candidate?.isAd !== true && candidate?.visible === true && candidate?.attached !== false && candidate?.hidden !== true && candidate?.zeroSize !== true);
  const exact = eligible.filter((candidate) => candidate.sourceMatch === true);
  if (exact.length === 1) return { status: "BOUND", candidate: exact[0], eligibleCount: eligible.length, exactMatchCount: exact.length, reason: "EXACT_SOURCE_MATCH" };
  if (exact.length > 1) return { status: "AMBIGUOUS", candidate: null, eligibleCount: eligible.length, exactMatchCount: exact.length, reason: "MULTIPLE_EXACT_SOURCE_MATCHES" };
  if (eligible.length === 1) return { status: "BOUND", candidate: eligible[0], eligibleCount: eligible.length, exactMatchCount: exact.length, reason: eligible[0].relationReason || "VERIFIED_REEL_RELATION" };
  return { status: eligible.length === 0 ? "NOT_FOUND" : "AMBIGUOUS", candidate: null, eligibleCount: eligible.length, exactMatchCount: exact.length, reason: eligible.length === 0 ? "NO_VERIFIED_REEL_MEDIA" : "MULTIPLE_VERIFIED_REEL_MEDIA" };
}

async function waitForBoundMediaDiscovery(readCandidates, { timeoutMs = MEDIA_DISCOVERY_TIMEOUT_MS, pollMs = DURATION_POLL_INTERVAL_MS, wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) } = {}) {
  const startedAt = Date.now();
  let pollCount = 0;
  let latest = [];
  while (Date.now() - startedAt <= timeoutMs) {
    latest = await readCandidates();
    pollCount += 1;
    const relation = selectBoundMediaRelation(latest);
    if (relation.status === "BOUND") return { ...relation, elapsedMs: Date.now() - startedAt, pollCount, timedOut: false };
    await wait(pollMs);
  }
  return { ...selectBoundMediaRelation(latest), elapsedMs: Date.now() - startedAt, pollCount, timedOut: true };
}

function selectBoundMediaDuration(candidates) {
  const result = selectBoundMediaCandidate(candidates);
  return result.status === "BOUND" ? result.candidate.durationSec : null;
}

async function waitForBoundMediaDuration(readCandidates, { timeoutMs = MAX_DURATION_WAIT_MS, pollMs = DURATION_POLL_INTERVAL_MS, wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const duration = selectBoundMediaDuration(await readCandidates());
    if (duration !== null) return duration;
    await wait(pollMs);
  }
  return null;
}

module.exports = { MEDIA_DISCOVERY_TIMEOUT_MS, MAX_DURATION_WAIT_MS, DURATION_POLL_INTERVAL_MS, normalizeDurationSeconds, selectBoundMediaCandidate, selectBoundMediaRelation, selectBoundMediaDuration, waitForBoundMediaDiscovery, waitForBoundMediaDuration };
