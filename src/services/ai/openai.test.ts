import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./openai";
import type { VideoAnalysis } from "./types";

afterEach(() => vi.unstubAllGlobals());

const analysis: VideoAnalysis = {
  schemaVersion: "1.0",
  summary: "summary",
  hook: "hook",
  setup: "setup",
  conflict: "conflict",
  escalation: "escalation",
  twist: "twist",
  payoff: "payoff",
  theGag: "gag",
  cameraPattern: "static",
  editingRhythm: "fast",
  characterInteractions: ["main character reacts"],
  soundPattern: "foley",
  retentionMechanism: "surprise",
  whyItWorks: ["clear gag"],
};

describe("OpenAI Responses API", () => {
  it("reads structured JSON from output content and sends a strict JSON schema", async () => {
    const modelingIdeas = {
      schemaVersion: "1.0",
      modelingDirections: [{
        title: "Ý tưởng",
        coreConcept: "Khái niệm",
        script: "Kịch bản",
        characterDesign: "Nhân vật",
        setting: "Bối cảnh",
        artStyle: "Hoạt hình 2D",
        sourceMechanism: "Cơ chế gốc",
        whatIsPreserved: ["Điểm gây cười"],
        whatIsChanged: ["Phong cách"],
        targetMarketAdaptation: "Việt Nam",
        similarityRisk: "low",
        whyWorthDeveloping: "Rõ ràng",
        postText: "Một ngày thật bất ngờ.",
      }],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(modelingIdeas) }] }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAIProvider("test-key", "gpt-4.1-mini").generateIdeas({
      channelDNA: { name: "Kênh", topic: "Hài", targetCountry: "Việt Nam", language: "Tiếng Việt", audience: "Đại chúng", contentStyle: "Hài", visualStyle: "2D", hasDialogue: false, timezone: "Asia/Bangkok" },
      video: { id: "video-1", url: "https://example.test/video" },
      analysis,
      artStyle: "Hoạt hình 2D",
    });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { text: { format: { type: string; strict: boolean; schema: Record<string, unknown> } } };
    expect(request.text.format.type).toBe("json_schema");
    expect(request.text.format.strict).toBe(true);
    expect(request.text.format.schema).not.toHaveProperty("$schema");
    expect(result).toEqual(modelingIdeas);
  });

  it("dùng strict schema cho gói storyboard và giữ đủ prompt start frame/video", async () => {
    const developedIdea = {
      schemaVersion: "1.0",
      deconstruction: { description: "Gag gốc" },
      artDirection: { description: "Hoạt hình 2D" },
      characterDesign: { description: "Nhân vật chính cố định" },
      backgroundDesign: { description: "Phòng ngủ" },
      storyboard: [{
        sceneNumber: 1,
        visualBlock: "Nhân vật nằm trên giường cạnh đồng hồ.",
        actionBlock: "Đồng hồ rung, nhân vật mở mắt.",
        audioBlock: "Tiếng báo thức.",
        startFramePrompt: "A single frozen vertical 9:16 bedroom still.",
        englishPrompt: "Animate one 4-second alarm-clock reaction from the exact still.",
      }],
      safetyReview: { description: "An toàn" },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(developedIdea) }] }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAIProvider("test-key", "gpt-4.1-mini").developIdea({
      channelDNA: { name: "Kênh", topic: "Hài", targetCountry: "Việt Nam", language: "Tiếng Việt", audience: "Đại chúng", contentStyle: "Hài", visualStyle: "2D", hasDialogue: false, timezone: "Asia/Bangkok" },
      video: { id: "video-1", url: "https://example.test/video" },
      analysis,
      idea: { title: "Ý tưởng", coreConcept: "Khái niệm", script: "Kịch bản", characterDesign: "Nhân vật", setting: "Bối cảnh", artStyle: "Hoạt hình 2D", sourceMechanism: "Gag", whatIsPreserved: ["Gag"], whatIsChanged: ["Phong cách"], targetMarketAdaptation: "Việt Nam", similarityRisk: "low", whyWorthDeveloping: "Rõ ràng", postText: "Caption" },
      aspectRatio: "9:16",
    });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { text: { format: { type: string; strict: boolean; schema: Record<string, unknown> } } };
    expect(request.text.format.type).toBe("json_schema");
    expect(request.text.format.strict).toBe(true);
    expect(request.text.format.schema).toHaveProperty("properties.storyboard");
    expect(result.storyboard[0]).toMatchObject({ sceneNumber: 1, startFramePrompt: expect.any(String), englishPrompt: expect.any(String) });
  });
});
