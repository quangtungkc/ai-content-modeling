import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("clean install smoke package preflight", () => {
  it("requires every local main-process module before launching an installer", () => {
    const source = readFileSync(path.resolve(process.cwd(), "scripts/production-validation/clean-install-smoke.cjs"), "utf8");
    for (const moduleName of ["temp-cleanup.cjs", "ipc-contract.cjs", "dev-runtime-identity.cjs", "gemini-error-transport.cjs"]) {
      expect(source).toContain(`"${moduleName}"`);
    }
    expect(source).toContain("PACKAGED_MAIN_MODULE_MISSING");
  });

  it("includes every required local main-process module in the release file allowlist", () => {
    const manifest = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as { build?: { files?: string[] } };
    for (const moduleName of ["temp-cleanup.cjs", "ipc-contract.cjs", "dev-runtime-identity.cjs", "gemini-error-transport.cjs"]) {
      expect(manifest.build?.files).toContain(`electron/${moduleName}`);
    }
  });
});
