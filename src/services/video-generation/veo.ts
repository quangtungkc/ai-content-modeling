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
    const response = await fetch(`${this.endpoint}/${this.model}:predictLongRunning?key=${this.apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instances: [{ prompt: input.prompt, ...(input.firstFrame ? { image: toImage(input.firstFrame) } : {}) }], parameters: { aspectRatio: input.aspectRatio, resolution: input.resolution, durationSeconds: input.duration, ...(input.lastFrame ? { lastFrame: toImage(input.lastFrame) } : {}), ...(input.referenceImages?.length ? { referenceImages: input.referenceImages.map(toReferenceImage) } : {}), ...(input.audioEnabled === false ? { generateAudio: false } : {}) } }) });
    if (!response.ok) throw new VideoProviderError(this.name, "Không thể tạo generation operation.", { status: response.status });
    const body = await response.json() as { name?: string };
    if (!body.name) throw new VideoProviderError(this.name, "Provider không trả về operation id.");
    return { provider: this.name, operationId: body.name, status: "queued" };
  }

  async getOperation(operationId: string): Promise<GenerationOperation> {
    if (!this.apiKey) throw new VideoProviderNotConfiguredError(this.name);
    const response = await fetch(`${this.operationsEndpoint}/${operationId}?key=${this.apiKey}`);
    if (!response.ok) throw new VideoProviderError(this.name, "Không thể lấy trạng thái operation.", { status: response.status });
    const body = await response.json() as { done?: boolean; error?: { message?: string }; response?: { generatedVideos?: Array<{ video?: { uri?: string } }> } };
    if (body.error) return { provider: this.name, operationId, status: "failed", error: body.error.message ?? "Generation failed" };
    if (!body.done) return { provider: this.name, operationId, status: "running" };
    return { provider: this.name, operationId, status: "succeeded", previewUrl: body.response?.generatedVideos?.[0]?.video?.uri };
  }
}

function toImage(frame: VideoFrame) { return { gcsUri: frame.uri, mimeType: frame.mimeType }; }
function toReferenceImage(frame: VideoFrame & { role?: string }) { return { image: toImage(frame), referenceType: frame.role === "style" ? "STYLE" : "SUBJECT" }; }
