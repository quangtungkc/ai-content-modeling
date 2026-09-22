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

module.exports = { cleanupManagedTemporaryFiles };
