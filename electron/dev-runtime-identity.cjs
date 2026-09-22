const crypto = require("node:crypto");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function normalizeRoot(root) {
  return path.resolve(root).replace(/\\/g, "/").toLowerCase();
}

function sourceRootId(root) {
  return `worktree-${crypto.createHash("sha256").update(normalizeRoot(root)).digest("hex").slice(0, 16)}`;
}

function sourceCommit(root) {
  try {
    const value = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return /^[0-9a-f]{40}$/i.test(value) ? value : "unknown";
  } catch {
    return "unknown";
  }
}

function buildDevRuntimeIdentity({ root, env = process.env } = {}) {
  const resolvedRoot = path.resolve(root);
  return {
    app: "ai-content-modeling",
    mode: "development",
    sourceRootId: env.MODELING_SOURCE_ROOT_ID || sourceRootId(resolvedRoot),
    sourceCommit: env.MODELING_SOURCE_COMMIT || sourceCommit(resolvedRoot),
    runtimeRevision: env.MODELING_RUNTIME_REVISION || "worktree-dev",
  };
}

function compareDevRuntimeIdentity(expected, actual) {
  const fields = ["app", "mode", "sourceRootId", "sourceCommit", "runtimeRevision"];
  const mismatchedFields = fields.filter((field) => expected?.[field] !== actual?.[field]);
  return { match: mismatchedFields.length === 0, mismatchedFields };
}

module.exports = { buildDevRuntimeIdentity, compareDevRuntimeIdentity, normalizeRoot, sourceRootId, sourceCommit };
