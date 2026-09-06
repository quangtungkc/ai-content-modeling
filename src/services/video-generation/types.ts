export type VideoFrame = { uri: string; mimeType: string };
export type ReferenceImage = VideoFrame & { role?: "character" | "background" | "prop" };
export type VeoPromptInput = { sceneId: string; scene: Record<string, unknown>; characterData: Record<string, unknown>; assetReferences: ReferenceImage[]; background: Record<string, unknown>; camera: Record<string, unknown>; action: Record<string, unknown>; audio: Record<string, unknown>; duration: 4 | 6 | 8; constraints: string[]; aspectRatio?: "16:9" | "9:16"; resolution?: "720p" | "1080p" | "4k"; firstFrame?: VideoFrame; lastFrame?: VideoFrame; audioEnabled?: boolean };
export type VeoRequest = { sceneId: string; prompt: string; referenceImages?: ReferenceImage[]; aspectRatio: "16:9" | "9:16"; resolution: "720p" | "1080p" | "4k"; duration: 4 | 6 | 8; firstFrame?: VideoFrame; lastFrame?: VideoFrame; audioEnabled?: boolean };
export type SceneGenerationInput = VeoRequest;
export type GenerationOperation = { provider: string; operationId: string; status: "queued" | "running" | "succeeded" | "failed"; previewUrl?: string; error?: string };

export interface VideoGenerationProvider {
  readonly name: string;
  generateScene(input: SceneGenerationInput): Promise<GenerationOperation>;
  getOperation(operationId: string): Promise<GenerationOperation>;
}
