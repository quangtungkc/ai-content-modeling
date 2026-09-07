import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

const output = "electron/dist";
await rm(output, { recursive: true, force: true });
await mkdir(`${output}/app/.next`, { recursive: true });
await cp(".next/standalone", `${output}/app`, { recursive: true });
await cp(".next/static", `${output}/app/.next/static`, { recursive: true });
await cp("electron/assets/modeling-ai-template.db", `${output}/modeling-ai-template.db`);
await cp("prisma/schema.prisma", `${output}/schema.prisma`);

await build({
  entryPoints: ["src/workers/worker.ts"],
  outfile: `${output}/app/worker.cjs`,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  external: ["@prisma/client", ".prisma/client"],
});
