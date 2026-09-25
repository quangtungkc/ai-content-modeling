import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./main.cjs", import.meta.url), "utf8");
const start = source.indexOf("function readFacebookFollowingDocument(");
const end = source.indexOf('ipcMain.handle("facebook-browser:open"', start);
const functions = source.slice(start, end);

describe("Facebook Page following scan", () => {
  it("excludes navigation links and reads the Page's displayed count", () => {
    const anchors = [
      { href: "https://www.facebook.com/Sonhanqua/following/", innerText: "35 đang theo dõi", getAttribute: () => null },
      { href: "https://www.facebook.com/reel", innerText: "Reels", getAttribute: () => null },
      { href: "https://www.facebook.com/giftedartcartoon", innerText: "Giftedart cartoon", getAttribute: () => null },
      { href: "https://www.facebook.com/profile.php?id=61568787663568", innerText: "Sherishafe", getAttribute: () => null },
    ];
    const context = vm.createContext({ URL, window: { location: { href: "https://www.facebook.com/Sonhanqua/following/", origin: "https://www.facebook.com" } }, document: { body: { innerText: "35 đang theo dõi" }, querySelectorAll: () => anchors } });
    const result = vm.runInContext(`${functions}; readFacebookFollowingDocument("https://www.facebook.com/Sonhanqua")`, context);
    expect(result.expectedCount).toBe(35);
    expect(result.items.map((item: { url: string }) => item.url)).toEqual(["https://www.facebook.com/giftedartcartoon", "https://www.facebook.com/profile.php?id=61568787663568"]);
  });

  it("continues past the first loaded batch until all 35 Page links are collected", async () => {
    let batch = 0;
    let closed = false;
    const sizes = [9, 24, 35];
    const browser = {
      loadURL: async () => { batch = 0; },
      isDestroyed: () => false,
      close: () => { closed = true; },
      webContents: {
        executeJavaScript: async (script: string) => {
          if (script.includes("function readFacebookFollowingDocument")) return { needsLogin: false, currentUrl: "https://www.facebook.com/Sonhanqua/following", expectedCount: 35, items: Array.from({ length: sizes[batch] }, (_, index) => ({ url: `https://www.facebook.com/page${index + 1}`, displayName: `Page ${index + 1}` })) };
          if (script.includes("window.scrollTo")) { batch = Math.min(batch + 1, 2); return; }
          if (script.includes("document.documentElement.scrollHeight")) return [2000, 3000, 4100][batch];
          return true;
        },
      },
    };
    const context = vm.createContext({ URL, browser, delay: async () => undefined, normalizeFacebookPageUrl: (url: string) => url.replace(/\/$/, ""), createFacebookWindow: () => browser });
    const result = await vm.runInContext(`${functions}; scanFacebookFollowing("https://www.facebook.com/Sonhanqua/")`, context);
    expect(result.items).toHaveLength(35);
    expect(result.expectedCount).toBe(35);
    expect(result.error).toBeUndefined();
    expect(closed).toBe(true);
  });

  it("waits through a slow Facebook loading spinner instead of accepting the first batch", async () => {
    let scrolls = 0;
    const browser = {
      loadURL: async () => undefined,
      isDestroyed: () => false,
      close: () => undefined,
      webContents: {
        executeJavaScript: async (script: string) => {
          if (script.includes("function readFacebookFollowingDocument")) {
            const count = scrolls >= 7 ? 35 : 8;
            return { needsLogin: false, currentUrl: "https://www.facebook.com/Sonhanqua/following", expectedCount: 35, items: Array.from({ length: count }, (_, index) => ({ url: `https://www.facebook.com/page${index + 1}`, displayName: `Page ${index + 1}` })) };
          }
          if (script.includes("window.scrollTo")) { scrolls += 1; return; }
          if (script.includes("document.documentElement.scrollHeight")) return scrolls >= 7 ? 4100 : 2000;
          return true;
        },
      },
    };
    const context = vm.createContext({ URL, delay: async () => undefined, normalizeFacebookPageUrl: (url: string) => url.replace(/\/$/, ""), createFacebookWindow: () => browser });
    const result = await vm.runInContext(`${functions}; scanFacebookFollowing("https://www.facebook.com/Sonhanqua/")`, context);
    expect(scrolls).toBeGreaterThanOrEqual(7);
    expect(result.items).toHaveLength(35);
    expect(result.error).toBeUndefined();
  });
});
