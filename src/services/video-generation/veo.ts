import { VideoProviderError, VideoProviderNotConfiguredError } from "./errors";
import type { GenerationOperation, VeoRequest, VideoFrame, VideoGenerationProvider } from "./types";

export class VeoProvider implements VideoGenerationProvider {
  readonly name = "veo";
  private readonly endpoint = "https://generativelanguage.googleapis.com/v1beta/models";
  private readonly operationsEndpoint = "https://generativelanguage.googleapis.com/v1beta";
  constructor(private readonly apiKey = process.env.GEMINI_API_KEY, private readonly model = process.env.VEO_MODEL ?? "veo-3.1-generate-preview") {}

  async generateScene(input: VeoRequest): Promise<GenerationOperation> {
    if (!this.apiKey) throw new VideoProviderNotConfiguredError(this.name);
    if ((input.referenceImages?.length ?? 0) > 3) throw new VideoProviderError(this.name, "Veo 3.1 chỉ nhận tối đa 3 reference images.");
    if (input.lastFrame && !input.firstFrame) throw new VideoProviderError(this.name, "lastFrame cần đi cùng firstFrame.");
    const response = await fetch(`${this.endpoint}/${this.model}:predictLongRunning`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey }, body: JSON.stringify({ instances: [{ prompt: input.prompt, ...(input.firstFrame ? { image: toImage(input.firstFrame) } : {}), ...(input.lastFrame ? { lastFrame: toImage(input.lastFrame) } : {}), ...(input.referenceImages?.length ? { referenceImages: input.referenceImages.map(toReferenceImage) } : {}) }], parameters: { aspectRatio: input.aspectRatio, resolution: input.resolution, durationSeconds: input.duration, ...(input.audioEnabled === false ? { generateAudio: false } : {}) } }) });
    if (!response.ok) throw new VideoProviderError(this.name, `Không thể tạo generation operation: ${await readProviderError(response)}`, { status: response.status });
    const body = await response.json() as { name?: string };
    if (!body.name) throw new VideoProviderError(this.name, "Provider không trả về operation id.");
    return { provider: this.name, operationId: body.name, status: "queued" };
  }

  async getOperation(operationId: string): Promise<GenerationOperation> {
    if (!this.apiKey) throw new VideoProviderNotConfiguredError(this.name);
    const response = await fetch(`${this.operationsEndpoint}/${operationId}`, { headers: { "x-goog-api-key": this.apiKey } });
    if (!response.ok) throw new VideoProviderError(this.name, `Không thể lấy trạng thái operation: ${await readProviderError(response)}`, { status: response.status });
    const body = await response.json() as { done?: boolean; error?: { message?: string }; response?: { generatedVideos?: Array<{ video?: { uri?: string } }>; generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } } };
    if (body.error) return { provider: this.name, operationId, status: "failed", error: body.error.message ?? "Generation failed" };
    if (!body.done) return { provider: this.name, operationId, status: "running" };
    const previewUrl = body.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ?? body.response?.generatedVideos?.[0]?.video?.uri;
    if (!previewUrl) return { provider: this.name, operationId, status: "failed", error: "Veo operation hoàn tất nhưng không có video trả về." };
    return { provider: this.name, operationId, status: "succeeded", previewUrl };
  }
}

function toImage(frame: VideoFrame) {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(frame.uri);
  return match ? { bytesBase64Encoded: match[2], mimeType: match[1] } : { gcsUri: frame.uri, mimeType: frame.mimeType };
}
function toReferenceImage(frame: VideoFrame & { role?: string }) { return { image: toImage(frame), referenceType: frame.role === "style" ? "style" : "asset" }; }

async function readProviderError(response: Response) {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? "Provider không trả về chi tiết lỗi.";
  } catch {
    return "Provider không trả về chi tiết lỗi.";
  }
}
