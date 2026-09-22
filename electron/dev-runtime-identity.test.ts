import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { buildDevRuntimeIdentity, compareDevRuntimeIdentity } = require("./dev-runtime-identity.cjs");

describe("ISSUE-005 development runtime identity guard", () => {
  test("accepts the expected current worktree renderer", () => {
    const expected = buildDevRuntimeIdentity({ root: process.cwd(), env: { MODELING_SOURCE_ROOT_ID: "root-a", MODELING_SOURCE_COMMIT: "commit-a", MODELING_RUNTIME_REVISION: "revision-a" } });
    expect(compareDevRuntimeIdentity(expected, { ...expected })).toEqual({ match: true, mismatchedFields: [] });
  });

  test("rejects an old or unrelated renderer identity", () => {
    const expected = buildDevRuntimeIdentity({ root: process.cwd(), env: { MODELING_SOURCE_ROOT_ID: "root-a", MODELING_SOURCE_COMMIT: "commit-a", MODELING_RUNTIME_REVISION: "revision-a" } });
    const actual = { ...expected, sourceRootId: "installed-app", runtimeRevision: "old-bundle" };
    expect(compareDevRuntimeIdentity(expected, actual)).toEqual({ match: false, mismatchedFields: ["sourceRootId", "runtimeRevision"] });
  });

  test("rejects a port response without an identity payload", () => {
    const expected = buildDevRuntimeIdentity({ root: process.cwd(), env: { MODELING_SOURCE_ROOT_ID: "root-a", MODELING_SOURCE_COMMIT: "commit-a", MODELING_RUNTIME_REVISION: "revision-a" } });
    expect(compareDevRuntimeIdentity(expected, null).match).toBe(false);
  });
});
