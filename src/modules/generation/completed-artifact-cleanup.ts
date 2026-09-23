import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { applicationDataDirectory } from "@/lib/app-data";

const appDataRoot = () => applicationDataDirectory(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd());
const legacyAppDataRoot = () => applicationDataDirectory(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "Modeling AI");
const generatedMediaRoot = () => process.env.MODELING_AI_GENERATED_MEDIA_ROOT ? path.resolve(process.env.MODELING_AI_GENERATED_MEDIA_ROOT) : appDataRoot();

function assertSafeProjectId(projectId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error("PROJECT_ID_INVALID");
}

function uniqueRoots() {
  return [...new Set([generatedMediaRoot(), appDataRoot(), legacyAppDataRoot()].map((root) => path.resolve(root)))];
}

async function removeManaged(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("CLEANUP_PATH_OUTSIDE_APP_DATA");
  await rm(resolvedCandidate, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/**
 * Removes app-owned intermediate media only after final.mp4 is valid.
 * The database, run checkpoint and browser profiles are intentionally preserved.
 */
export async function cleanupCompletedProjectArtifacts(projectId: string) {
  assertSafeProjectId(projectId);
  const removed: string[] = [];
  const preserved: string[] = [];
  for (const root of uniqueRoots()) {
    const imageDirectory = path.join(root, "generated-images", projectId);
    await removeManaged(root, imageDirectory);
    removed.push(imageDirectory);

    const videoDirectory = path.join(root, "generated-videos", projectId);
    let entries: Array<{ name: string }> = [];
    try { entries = await readdir(videoDirectory, { withFileTypes: true }) as Array<{ name: string }>; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const entry of entries) {
      if (entry.name.toLowerCase() === "final.mp4") {
        preserved.push(path.join(videoDirectory, entry.name));
        continue;
      }
      await removeManaged(root, path.join(videoDirectory, entry.name));
      removed.push(path.join(videoDirectory, entry.name));
    }

  }
  return { status: "completed" as const, removed, preserved };
}
