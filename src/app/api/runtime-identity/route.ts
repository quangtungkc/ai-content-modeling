import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

function sourceRootId(root: string) {
  return `worktree-${createHash("sha256").update(path.resolve(root).replace(/\\/g, "/").toLowerCase()).digest("hex").slice(0, 16)}`;
}

function sourceCommit(root: string) {
  try {
    const value = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return /^[0-9a-f]{40}$/i.test(value) ? value : "unknown";
  } catch {
    return "unknown";
  }
}

export async function GET() {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const root = process.cwd();
  return Response.json({
    app: "ai-content-modeling",
    mode: "development",
    sourceRootId: process.env.MODELING_SOURCE_ROOT_ID || sourceRootId(root),
    sourceCommit: process.env.MODELING_SOURCE_COMMIT || sourceCommit(root),
    runtimeRevision: process.env.MODELING_RUNTIME_REVISION || "worktree-dev",
  }, { headers: { "Cache-Control": "no-store" } });
}
