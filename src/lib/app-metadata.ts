import packageJson from "../../package.json";

export const APP_METADATA = Object.freeze({
  name: packageJson.name,
  displayName: "Modeling AI",
  version: packageJson.version,
  description: "AI Content Modeling workspace",
});

export type RuntimeEnvironment = "development" | "test" | "production";
export type RuntimeMode = "web" | "desktop";

export function getRuntimeMetadata(): Readonly<{
  app: typeof APP_METADATA;
  environment: RuntimeEnvironment;
  mode: RuntimeMode;
  build: { revision: string; sourceRootId: string };
}> {
  const environment = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test" ? process.env.NODE_ENV : "development";
  return {
    app: APP_METADATA,
    environment,
    mode: process.env.DESKTOP_MODE === "1" ? "desktop" : "web",
    build: {
      revision: process.env.MODELING_RUNTIME_REVISION || "worktree-dev",
      sourceRootId: process.env.MODELING_SOURCE_ROOT_ID || "unknown",
    },
  };
}
