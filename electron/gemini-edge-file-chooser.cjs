const fs = require("node:fs");
const path = require("node:path");

const EDGE_FILE_CHOOSER_WAIT_MS = 10_000;
const EDGE_REFERENCE_PREVIEW_WAIT_MS = 15_000;
const EDGE_FILE_CHOOSER_MODES = new Set(["selectSingle", "selectMultiple"]);

function assertReadableAbsoluteFile(filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) throw new Error("EDGE_REFERENCE_FILE_PATH_NOT_ABSOLUTE");
  try {
    const metadata = fs.statSync(filePath);
    fs.accessSync(filePath, fs.constants.R_OK);
    if (!metadata.isFile()) throw new Error("EDGE_REFERENCE_FILE_NOT_FILE");
  } catch (error) {
    if (error?.message === "EDGE_REFERENCE_FILE_NOT_FILE") throw error;
    throw new Error("EDGE_REFERENCE_FILE_NOT_READABLE");
  }
  return filePath;
}

function isValidFileChooserEvent(params, { mainFrameId, targetId }) {
  return Boolean(params
    && typeof params.frameId === "string"
    && params.frameId === mainFrameId
    && Number.isInteger(params.backendNodeId)
    && params.backendNodeId > 0
    && EDGE_FILE_CHOOSER_MODES.has(params.mode)
    && targetId !== null
    && targetId !== undefined);
}

function waitForMainFrameChooser(cdp, { mainFrameId, targetId, timeoutMs = EDGE_FILE_CHOOSER_WAIT_MS }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cdp.removeListener("message", onMessage);
      callback(value);
    };
    const onMessage = (_event, method, params) => {
      if (method !== "Page.fileChooserOpened") return;
      if (isValidFileChooserEvent(params, { mainFrameId, targetId })) return finish(resolve, params);
    };
    const timer = setTimeout(() => finish(reject, new Error("EDGE_FILE_CHOOSER_NOT_OPENED")), timeoutMs);
    cdp.on("message", onMessage);
  });
}

async function uploadWithEdgeFileChooser({
  window,
  cdp,
  filePath,
  filePaths,
  getMainFrameId,
  targetIsCurrent,
  openToolbar,
  findUploadAction,
  clickUploadAction,
  confirmPreview,
  chooserWaitMs = EDGE_FILE_CHOOSER_WAIT_MS,
  previewWaitMs = EDGE_REFERENCE_PREVIEW_WAIT_MS,
}) {
  const selectedFiles = Array.isArray(filePaths) && filePaths.length ? filePaths : [filePath];
  selectedFiles.forEach(assertReadableAbsoluteFile);
  if (!window || !cdp || typeof getMainFrameId !== "function" || typeof targetIsCurrent !== "function") throw new Error("EDGE_FILE_CHOOSER_CONTEXT_INVALID");
  if (typeof openToolbar !== "function" || typeof findUploadAction !== "function" || typeof clickUploadAction !== "function" || typeof confirmPreview !== "function") throw new Error("EDGE_FILE_CHOOSER_CONTROLS_INVALID");
  const mainFrameId = await getMainFrameId();
  if (!mainFrameId || !targetIsCurrent()) throw new Error("EDGE_GEMINI_TARGET_NOT_CURRENT");
  let interceptionEnabled = false;
  let chooserPromise = null;
  try {
    try { await cdp.sendCommand("Page.enable", { enableFileChooserOpenedEvent: true }); }
    catch { await cdp.sendCommand("Page.enable"); }
    await cdp.sendCommand("DOM.enable");
    await cdp.sendCommand("Page.setInterceptFileChooserDialog", { enabled: true });
    interceptionEnabled = true;
    chooserPromise = waitForMainFrameChooser(cdp, { mainFrameId, targetId: window.webContents.id, timeoutMs: chooserWaitMs }).then((value) => ({ value, error: null }), (error) => ({ value: null, error }));
    await openToolbar();
    const uploadAction = await findUploadAction();
    if (!uploadAction) throw new Error("EDGE_UPLOAD_ACTION_NOT_FOUND");
    await clickUploadAction(uploadAction);
    const chooserOutcome = await chooserPromise;
    if (chooserOutcome.error) throw chooserOutcome.error;
    const chooser = chooserOutcome.value;
    const currentFrameId = await getMainFrameId();
    if (currentFrameId !== mainFrameId || !targetIsCurrent()) throw new Error("EDGE_FILE_CHOOSER_TARGET_CHANGED");
    await cdp.sendCommand("DOM.setFileInputFiles", { backendNodeId: chooser.backendNodeId, files: selectedFiles });
    const preview = await confirmPreview(selectedFiles, previewWaitMs);
    if (!preview?.confirmed) throw new Error("EDGE_REFERENCE_PREVIEW_NOT_CONFIRMED");
    return { status: "uploaded", frameId: chooser.frameId, backendNodeId: chooser.backendNodeId, mode: chooser.mode, files: selectedFiles.map((item) => path.basename(item)), preview };
  } catch (error) {
    await chooserPromise?.catch(() => {});
    throw error;
  } finally {
    if (interceptionEnabled) await cdp.sendCommand("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {});
  }
}

module.exports = { EDGE_FILE_CHOOSER_WAIT_MS, EDGE_REFERENCE_PREVIEW_WAIT_MS, assertReadableAbsoluteFile, isValidFileChooserEvent, waitForMainFrameChooser, uploadWithEdgeFileChooser };
