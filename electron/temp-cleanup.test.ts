import { mkdir, mkdtemp, utimes, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const { cleanupManagedTemporaryFiles, cleanupCompletedProjectArtifacts } = require("./temp-cleanup.cjs") as { cleanupManagedTemporaryFiles: (userData: string, options?: { maxAgeMs?: number }) => string[]; cleanupCompletedProjectArtifacts: (userData: string, projectId: string) => { status: string; preserved: string[]; removed: string[] } };

describe("managed temporary cleanup", () => {
  it("removes only stale entries inside the managed temporary directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "modeling-temp-cleanup-"));
    const temporary = path.join(root, "temporary");
    await mkdir(temporary, { recursive: true });
    const stale = path.join(temporary, "stale-job");
    const fresh = path.join(temporary, "fresh-job");
    await mkdir(stale); await writeFile(path.join(stale, "a.tmp"), "x");
    await mkdir(fresh); await writeFile(path.join(fresh, "b.tmp"), "x");
    const old = new Date(Date.now() - 60_000);
    await utimes(stale, old, old);
    expect(cleanupManagedTemporaryFiles(root, { maxAgeMs: 1_000 })).toEqual(["stale-job"]);
    await expect(import("node:fs/promises").then(({ access }) => access(fresh))).resolves.toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });

  it("removes completed project media but preserves only final.mp4", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "modeling-project-cleanup-"));
    const project = "project-1";
    await mkdir(path.join(root, "generated-images", project), { recursive: true });
    await mkdir(path.join(root, "generated-videos", project, "output-versions"), { recursive: true });
    await writeFile(path.join(root, "generated-images", project, "scene-1.png"), "image");
    await writeFile(path.join(root, "generated-videos", project, "scene-1.mp4"), "scene");
    await writeFile(path.join(root, "generated-videos", project, "final.mp4"), "final");
    await writeFile(path.join(root, "generated-videos", project, "output-versions", "candidate.mp4"), "candidate");
    await mkdir(path.join(root, "generated-videos", "another-project"), { recursive: true });
    await writeFile(path.join(root, "generated-videos", "another-project", "scene-1.mp4"), "other project");
    await mkdir(path.join(root, "temporary", "source-analysis"), { recursive: true });
    await writeFile(path.join(root, "downloads", "downloaded.mp4"), "download").catch(async () => { await mkdir(path.join(root, "downloads"), { recursive: true }); await writeFile(path.join(root, "downloads", "downloaded.mp4"), "download"); });

    const result = cleanupCompletedProjectArtifacts(root, project);
    expect(result.status).toBe("completed");
    await expect(import("node:fs/promises").then(({ access }) => access(path.join(root, "generated-videos", project, "final.mp4")))).resolves.toBeUndefined();
    await expect(import("node:fs/promises").then(({ access }) => access(path.join(root, "generated-videos", project, "scene-1.mp4")))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(import("node:fs/promises").then(({ access }) => access(path.join(root, "generated-images", project)))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(import("node:fs/promises").then(({ access }) => access(path.join(root, "temporary", "source-analysis")))).resolves.toBeUndefined();
    await expect(import("node:fs/promises").then(({ access }) => access(path.join(root, "downloads", "downloaded.mp4")))).resolves.toBeUndefined();
    await expect(import("node:fs/promises").then(({ access }) => access(path.join(root, "generated-videos", "another-project", "scene-1.mp4")))).resolves.toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });
});
