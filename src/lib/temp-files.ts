import fs from "node:fs/promises";
import path from "node:path";
import { getAppPaths } from "./paths";

function assertManagedPath(candidate: string, root: string) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("TEMP_PATH_OUTSIDE_MANAGED_ROOT");
}

export async function createManagedTempDirectory(prefix = "job-") {
  const { temporary } = getAppPaths();
  await fs.mkdir(temporary, { recursive: true });
  return fs.mkdtemp(path.join(temporary, prefix));
}

export async function removeManagedTempPath(candidate: string) {
  const { temporary } = getAppPaths();
  const resolved = path.resolve(candidate);
  assertManagedPath(resolved, path.resolve(temporary));
  await fs.rm(resolved, { recursive: true, force: true });
}
