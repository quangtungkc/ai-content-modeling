import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const { acquireBuildLock } = require("./build-with-lock.cjs") as { acquireBuildLock: (lockPath: string) => Promise<{ release: () => Promise<void> }> };

function waitForOutput(child: ReturnType<typeof spawn>, expected: string) {
  return new Promise<void>((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer) => { output += String(chunk); if (output.includes(expected)) { child.stdout?.off("data", onData); resolve(); } };
    child.stdout?.on("data", onData);
    child.once("exit", (code) => reject(new Error(`lock child exited early: ${code}\n${output}`)));
    child.once("error", reject);
  });
}

describe("production build concurrency guard", () => {
  it("fails a second process without touching the shared Next output lock", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "modeling-build-lock-"));
    const lockPath = path.join(root, "next-build.lock");
    const modulePath = path.resolve(__dirname, "build-with-lock.cjs");
    const child = spawn(process.execPath, ["-e", `const {acquireBuildLock}=require(${JSON.stringify(modulePath)}); acquireBuildLock(${JSON.stringify(lockPath)}).then(lock=>{console.log("LOCK_HELD"); setTimeout(()=>lock.release().then(()=>process.exit(0)), 60000)}).catch(error=>{console.error(error); process.exit(1)})`], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    try {
      await waitForOutput(child, "LOCK_HELD");
      await expect(acquireBuildLock(lockPath)).rejects.toMatchObject({ code: "BUILD_ALREADY_RUNNING" });
      child.kill();
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      const nextLock = await acquireBuildLock(lockPath);
      await nextLock.release();
    } finally {
      child.kill();
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
