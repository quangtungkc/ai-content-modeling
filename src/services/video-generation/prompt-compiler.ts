import { VideoProviderError } from "./errors";
import type { VeoPromptInput, VeoRequest } from "./types";

export function compileVeoPrompt(input: VeoPromptInput): VeoRequest {
  if (input.assetReferences.length > 3) throw new VideoProviderError("Veo prompt compiler", "Một scene chỉ được dùng tối đa 3 reference images.");
  if (input.lastFrame && !input.firstFrame) throw new VideoProviderError("Veo prompt compiler", "lastFrame cần đi cùng firstFrame.");
  const sections = [
    `SCENE: ${JSON.stringify(input.scene)}`,
    `CHARACTERS: ${JSON.stringify(input.characterData)}`,
    `BACKGROUND: ${JSON.stringify(input.background)}`,
    `CAMERA: ${JSON.stringify(input.camera)}`,
    `ACTION: ${JSON.stringify(input.action)}`,
    `AUDIO: ${JSON.stringify(input.audio)}`,
    `DURATION: ${input.duration} seconds`,
    `CONSTRAINTS: ${input.constraints.join("; ") || "None"}`,
  ];
  return { sceneId: input.sceneId, prompt: sections.join("\n"), referenceImages: input.assetReferences, aspectRatio: input.aspectRatio ?? "16:9", resolution: input.resolution ?? "1080p", duration: input.duration, firstFrame: input.firstFrame, lastFrame: input.lastFrame, audioEnabled: input.audioEnabled ?? true };
}
