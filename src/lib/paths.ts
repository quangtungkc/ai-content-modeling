import path from "node:path";
import { applicationDataDirectory } from "./app-data";

export type AppPaths = Readonly<{
  userData: string;
  database: string;
  temporary: string;
  downloads: string;
  generated: string;
  logs: string;
}>;

export function getAppPaths(baseDirectory = applicationDataDirectory(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd())): AppPaths {
  const userData = path.resolve(baseDirectory);
  return Object.freeze({
    userData,
    database: path.join(userData, "modeling-ai.db"),
    temporary: path.join(userData, "temporary"),
    downloads: path.join(userData, "downloads"),
    generated: path.join(userData, "generated"),
    logs: path.join(userData, "logs"),
  });
}
