import { mkdir, mkdtemp, utimes, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const { cleanupManagedTemporaryFiles } = require("./temp-cleanup.cjs") as { cleanupManagedTemporaryFiles: (userData: string, options?: { maxAgeMs?: number }) => string[] };

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
});
