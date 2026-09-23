const fs = require("node:fs");
const path = require("node:path");

function cleanupManagedTemporaryFiles(userData, options = {}) {
  if (typeof userData !== "string" || !path.isAbsolute(userData)) throw new Error("USER_DATA_PATH_INVALID");
  const root = path.resolve(userData);
  const temporary = path.join(root, "temporary");
  if (!fs.existsSync(temporary)) return [];
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? Math.max(0, options.maxAgeMs) : 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - maxAgeMs;
  const removed = [];
  for (const entry of fs.readdirSync(temporary, { withFileTypes: true })) {
    const candidate = path.join(temporary, entry.name);
    const relative = path.relative(temporary, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    const stat = fs.statSync(candidate);
    if (stat.mtimeMs >= cutoff) continue;
    fs.rmSync(candidate, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

function assertSafeProjectId(projectId) {
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error("PROJECT_ID_INVALID");
  return projectId;
}

function cleanupCompletedProjectArtifacts(userData, projectId) {
  if (typeof userData !== "string" || !path.isAbsolute(userData)) throw new Error("USER_DATA_PATH_INVALID");
  const root = path.resolve(userData);
  const safeProjectId = assertSafeProjectId(projectId);
  const removed = [];
  const remove = (candidate, label) => {
    const resolved = path.resolve(candidate);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("CLEANUP_PATH_OUTSIDE_USER_DATA");
    if (!fs.existsSync(resolved)) return;
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    removed.push(label);
  };

  // These directories contain only app-owned generated/intermediate media.
  remove(path.join(root, "generated-images", safeProjectId), `generated-images/${safeProjectId}`);
  const videoDirectory = path.join(root, "generated-videos", safeProjectId);
  if (fs.existsSync(videoDirectory)) {
    for (const entry of fs.readdirSync(videoDirectory, { withFileTypes: true })) {
      if (entry.name.toLowerCase() === "final.mp4") continue;
      remove(path.join(videoDirectory, entry.name), `generated-videos/${safeProjectId}/${entry.name}`);
    }
  }
  return { status: "completed", preserved: [path.join(root, "generated-videos", safeProjectId, "final.mp4")], removed };
}

module.exports = { cleanupManagedTemporaryFiles, cleanupCompletedProjectArtifacts };
