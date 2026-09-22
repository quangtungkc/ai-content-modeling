import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it } from "vitest";

const { isValidFileChooserEvent, uploadWithEdgeFileChooser } = require("./gemini-edge-file-chooser.cjs") as {
  isValidFileChooserEvent: (params: Record<string, unknown>, context: { mainFrameId: string; targetId: string }) => boolean;
  uploadWithEdgeFileChooser: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const fixture = path.resolve(__dirname, "../scripts/production-validation/fixtures/gemini-neutral-reference.svg");

class FakeCdp extends EventEmitter {
  commands: Array<{ method: string; params: Record<string, unknown> }> = [];

  async sendCommand(method: string, params: Record<string, unknown> = {}) {
    this.commands.push({ method, params });
    return {};
  }
}

function input(cdp: FakeCdp, emitChooser: () => void, overrides: Record<string, unknown> = {}) {
  const window = { webContents: { id: "target-1" }, isDestroyed: () => false };
  return uploadWithEdgeFileChooser({
    window,
    cdp,
    filePath: fixture,
    getMainFrameId: async () => "frame-main",
    targetIsCurrent: () => true,
    openToolbar: async () => emitChooser(),
    findUploadAction: async () => ({ tag: "button", name: "Tệp" }),
    clickUploadAction: async () => undefined,
    confirmPreview: async () => ({ confirmed: true, previewCount: 1 }),
    chooserWaitMs: 50,
    previewWaitMs: 50,
    ...overrides,
  });
}

describe("Gemini Edge CDP file chooser upload", () => {
  it("accepts only a current main-frame chooser with a fresh backend node", () => {
    expect(isValidFileChooserEvent({ frameId: "frame-main", backendNodeId: 8193, mode: "selectMultiple" }, { mainFrameId: "frame-main", targetId: "target-1" })).toBe(true);
    expect(isValidFileChooserEvent({ frameId: "child", backendNodeId: 8193, mode: "selectMultiple" }, { mainFrameId: "frame-main", targetId: "target-1" })).toBe(false);
    expect(isValidFileChooserEvent({ frameId: "frame-main", backendNodeId: 0, mode: "selectMultiple" }, { mainFrameId: "frame-main", targetId: "target-1" })).toBe(false);
  });

  it("arms the listener before the menu action, sets the event node and cleans up", async () => {
    const cdp = new FakeCdp();
    const resultPromise = input(cdp, () => cdp.emit("message", null, "Page.fileChooserOpened", { frameId: "frame-main", backendNodeId: 9001, mode: "selectMultiple" }));
    const result = await resultPromise;
    expect(result.backendNodeId).toBe(9001);
    expect(cdp.commands.some((command) => command.method === "DOM.setFileInputFiles" && command.params.backendNodeId === 9001)).toBe(true);
    expect(cdp.listenerCount("message")).toBe(0);
    expect(cdp.commands.at(-1)?.method).toBe("Page.setInterceptFileChooserDialog");
    expect(cdp.commands.at(-1)?.params).toEqual({ enabled: false });
  });

  it("ignores child-frame chooser events and accepts the next main-frame event", async () => {
    const cdp = new FakeCdp();
    const resultPromise = input(cdp, () => {
      cdp.emit("message", null, "Page.fileChooserOpened", { frameId: "child", backendNodeId: 7001, mode: "selectMultiple" });
      cdp.emit("message", null, "Page.fileChooserOpened", { frameId: "frame-main", backendNodeId: 7002, mode: "selectSingle" });
    });
    await expect(resultPromise).resolves.toMatchObject({ backendNodeId: 7002, mode: "selectSingle" });
    expect(cdp.commands.some((command) => command.params.backendNodeId === 7001)).toBe(false);
  });

  it("fails before menu interaction for a missing file", async () => {
    const cdp = new FakeCdp();
    let opened = false;
    await expect(uploadWithEdgeFileChooser({
      window: { webContents: { id: "target-1" }, isDestroyed: () => false },
      cdp,
      filePath: "C:\\does-not-exist\\reference.png",
      getMainFrameId: async () => "frame-main",
      targetIsCurrent: () => true,
      openToolbar: async () => { opened = true; },
      findUploadAction: async () => null,
      clickUploadAction: async () => undefined,
      confirmPreview: async () => ({ confirmed: true }),
      chooserWaitMs: 10,
      previewWaitMs: 10,
    })).rejects.toThrow("EDGE_REFERENCE_FILE_NOT_READABLE");
    expect(opened).toBe(false);
    expect(cdp.commands).toHaveLength(0);
  });

  it("fails bounded when no chooser event arrives and still disables interception", async () => {
    const cdp = new FakeCdp();
    await expect(input(cdp, () => undefined, { chooserWaitMs: 10 })).rejects.toThrow("EDGE_FILE_CHOOSER_NOT_OPENED");
    expect(cdp.listenerCount("message")).toBe(0);
    expect(cdp.commands.at(-1)?.params).toEqual({ enabled: false });
  });

  it("fails when setFileInputFiles succeeds but preview confirmation does not", async () => {
    const cdp = new FakeCdp();
    await expect(input(cdp, () => cdp.emit("message", null, "Page.fileChooserOpened", { frameId: "frame-main", backendNodeId: 9002, mode: "selectMultiple" }), { confirmPreview: async () => ({ confirmed: false }) })).rejects.toThrow("EDGE_REFERENCE_PREVIEW_NOT_CONFIRMED");
    expect(cdp.listenerCount("message")).toBe(0);
  });

  it("passes every requested file to the same current chooser node", async () => {
    const cdp = new FakeCdp();
    const result = await uploadWithEdgeFileChooser({
      window: { webContents: { id: "target-1" }, isDestroyed: () => false },
      cdp,
      filePaths: [fixture, fixture],
      getMainFrameId: async () => "frame-main",
      targetIsCurrent: () => true,
      openToolbar: async () => cdp.emit("message", null, "Page.fileChooserOpened", { frameId: "frame-main", backendNodeId: 9010, mode: "selectMultiple" }),
      findUploadAction: async () => ({ tag: "button", name: "Tệp" }),
      clickUploadAction: async () => undefined,
      confirmPreview: async (paths: unknown[]) => ({ confirmed: paths.length === 2 }),
      chooserWaitMs: 50,
      previewWaitMs: 50,
    });
    expect(result.backendNodeId).toBe(9010);
    expect(cdp.commands.find((command) => command.method === "DOM.setFileInputFiles")?.params.files).toHaveLength(2);
  });
});
