import { access, readFile, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { getEnv } from "@/lib/env";
import { CodexReasoner } from "./reasoner";
import type { CodexStage } from "./types";

const stageRoots: Record<CodexStage, string[]> = {
  ANALYSIS: ["src/modules/videos/analysis-service.ts", "src/services/ai"],
  MODELING: ["src/modules/ideas/service.ts", "src/services/ai"],
  PROJECT: ["src/modules/ideas/approval-service.ts", "src/services/ai"],
  ASSETS: ["src/modules/generation/google-api-pipeline.ts", "src/modules/assets/image-generation-service.ts", "src/services/ai/gemini.ts"],
  SCENES: ["src/modules/generation", "src/services/video-generation"],
  FINAL_ASSEMBLY: ["src/modules/generation/final-assembly-service.ts"],
  FINAL_AUDIT: ["src/modules/codex-orchestrator/quality-validator.ts", "src/modules/codex-orchestrator/policy.ts"],
  POST_RUN_REVIEW: ["src/modules/codex-orchestrator/service.ts"],
};

function run(command: string, args: string[], cwd: string, input?: string, timeout = 20 * 60_000) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"], timeout });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`${command} ${args.join(" ")} thất bại (${code}): ${output.slice(-2_000)}`)));
    child.stdin.end(input);
  });
}

function normalizeRepoPath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isAllowedRepairPath(file: string, roots: string[]) {
  const normalized = normalizeRepoPath(file);
  if (/\.env|credential|secret|password|token|prisma\/|electron\/|package(?:-lock)?\.json|release|dist\//i.test(normalized)) return false;
  if (normalized.endsWith(".test.ts") && normalized.startsWith("src/")) return true;
  return roots.some((root) => normalized === root || normalized.startsWith(`${root.replace(/\/$/, "")}/`));
}

async function collectContext(workspace: string, roots: string[]) {
  const files: Array<{ path: string; content: string }> = [];
  for (const root of roots) {
    const target = path.join(workspace, root);
    try {
      const metadata = await stat(target);
      if (metadata.isFile()) files.push({ path: root, content: (await readFile(target, "utf8")).slice(0, 40_000) });
      else if (metadata.isDirectory()) {
        const names = (await readdir(target)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).slice(0, 8);
        for (const name of names) files.push({ path: `${root}/${name}`, content: (await readFile(path.join(target, name), "utf8")).slice(0, 30_000) });
      }
    } catch { /* Optional context path. */ }
  }
  return files.slice(0, 10);
}

export async function attemptGuardedProductionRepair(userId: string, stage: CodexStage, diagnostic: Record<string, unknown>) {
  const env = getEnv();
  if (!env.CODEX_SELF_REPAIR_ENABLED) throw new Error("Tự sửa code đang tắt bởi CODEX_SELF_REPAIR_ENABLED.");
  const workspace = path.resolve(env.CODEX_SELF_REPAIR_WORKSPACE || process.cwd());
  await access(path.join(workspace, "package.json"));
  await access(path.join(workspace, ".git"));
  const roots = stageRoots[stage];
  const context = await collectContext(workspace, roots);
  if (!context.length) throw new Error("Workspace tự sửa không chứa source phù hợp với stage lỗi.");
  const dirty = await run("git", ["status", "--porcelain", "--", ...roots], workspace);
  if (dirty.trim()) throw new Error("Từ chối tự sửa vì file liên quan đang có thay đổi chưa commit.");
  const proposal = await new CodexReasoner().proposeCodeRepair(userId, { stage, diagnostic, allowlist: roots, sourceFiles: context });
  const touched = [...proposal.patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((match) => normalizeRepoPath(match[2]));
  if (!touched.length || touched.some((file) => !isAllowedRepairPath(file, roots))) throw new Error("Patch Codex chạm file ngoài allowlist.");
  if (!touched.some((file) => file.endsWith(".test.ts"))) throw new Error("Patch Codex không có regression test.");
  await run("git", ["apply", "--check", "--whitespace=error-all", "-"], workspace, proposal.patch);
  await run("git", ["apply", "--whitespace=fix", "-"], workspace, proposal.patch);
  try {
    await run("npx.cmd", ["vitest", "run", ...touched.filter((file) => file.endsWith(".test.ts"))], workspace);
    await run("npm.cmd", ["run", "typecheck"], workspace);
    await run("npm.cmd", ["run", "build"], workspace);
  } catch (error) {
    await run("git", ["apply", "-R", "-"], workspace, proposal.patch);
    throw error;
  }
  return { summary: proposal.summary, rootCause: proposal.rootCause, regressionTest: proposal.regressionTest, touchedFiles: touched, workspace, requiresRestart: true };
}
