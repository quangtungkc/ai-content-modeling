import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "./gemini";

afterEach(() => vi.unstubAllGlobals());

describe("Gemini Image API", () => {
  it("sends character/background references server-side and reads the image output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_image: { mime_type: "image/png", data: "aW1hZ2U=" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new GeminiProvider("test-key").generateImage("one frozen start frame", "9:16", [{ mimeType: "image/png", data: "character" }, { mimeType: "image/png", data: "background" }]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { model: string; input: Array<{ type: string; data?: string }>; response_format: { aspect_ratio: string } };
    expect(result).toEqual({ mimeType: "image/png", data: "aW1hZ2U=" });
    expect(body.model).toBe("gemini-3.1-flash-image");
    expect(body.input.filter((part) => part.type === "image")).toHaveLength(2);
    expect(body.response_format.aspect_ratio).toBe("9:16");
  });
});
