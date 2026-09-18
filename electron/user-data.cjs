const fs = require("node:fs");
const path = require("node:path");

function initializeUserData(app, env = process.env) {
  const value = env.MODELING_AI_USER_DATA_DIR;
  if (value === undefined) {
    const directory = path.join(app.getPath("appData"), "ai-content-modeling");
    app.setPath("userData", directory);
    return directory;
  }
  try {
    if (typeof value !== "string" || !value.trim() || value.includes("\0") || !path.isAbsolute(value) || (process.platform === "win32" && !path.win32.parse(value).root.match(/^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+\\)$/))) throw new Error("Expected an absolute filesystem path");
    fs.mkdirSync(value, { recursive: true });
    const directory = fs.realpathSync(value);
    if (!fs.statSync(directory).isDirectory()) throw new Error("Not a directory");
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    app.setPath("userData", directory);
    env.MODELING_AI_USER_DATA_DIR = directory;
    return directory;
  } catch (error) {
    throw new Error(`MODELING_AI_USER_DATA_DIR_INVALID: ${error.message}`);
  }
}

module.exports = { initializeUserData };
