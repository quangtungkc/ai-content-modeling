export const FINAL_DURATION_TOLERANCE_SEC = 0.25;

export function resolveSceneAssemblyDuration(input: {
  sourceDuration: number;
  trimStart: number;
  trimEnd: number;
  targetDuration?: number | null;
}) {
  const availableDuration = input.sourceDuration - input.trimStart - input.trimEnd;
  if (!Number.isFinite(availableDuration) || availableDuration < 0.2) {
    throw new Error("FINAL_SCENE_DURATION_UNDERFLOW");
  }
  if (input.targetDuration == null) return availableDuration;
  if (!Number.isFinite(input.targetDuration) || input.targetDuration < 0.2 || input.targetDuration > availableDuration + 0.05) {
    throw new Error("FINAL_SCENE_DURATION_UNDERFLOW");
  }
  return Math.min(input.targetDuration, availableDuration);
}

export function expectedAssembledDuration(input: {
  durations: number[];
  transition: "none" | "fade";
  transitionDuration: number;
}) {
  const total = input.durations.reduce((sum, value) => sum + value, 0);
  const overlap = input.transition === "fade" ? input.transitionDuration * Math.max(0, input.durations.length - 1) : 0;
  return Math.max(0, total - overlap);
}

export function assertFinalDuration(actualDuration: number, expectedDuration: number, tolerance = FINAL_DURATION_TOLERANCE_SEC) {
  if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - expectedDuration) > tolerance) {
    throw new Error(`FINAL_MEDIA_DURATION_MISMATCH: expected=${expectedDuration.toFixed(3)} actual=${Number.isFinite(actualDuration) ? actualDuration.toFixed(3) : "invalid"}`);
  }
  return actualDuration;
}
