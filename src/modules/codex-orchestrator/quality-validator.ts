import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";
import { readProjectImage, readProjectVideo, readProjectFinalVideo } from "@/modules/assets/image-generation-service";
import { redactSecrets } from "./policy";
import type { CodexStage, ExpectedState, SceneExpectedState, ValidationIssue, ValidationOutput } from "./types";

type GeminiFile = { name?: string; uri?: string; state?: string; mimeType?: string };
type ProviderVerdict = { verdict?: string; issues?: ValidationIssue[]; summary?: string };

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function parseJson(text: string): ProviderVerdict {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned) as ProviderVerdict;
}

async function geminiKey(userId: string) {
  const connection = await db.aIConnection.findFirst({ where: { userId, provider: "GEMINI", kind: "AI", revokedAt: null }, orderBy: { updatedAt: "desc" } });
  return connection ? decryptSecret(connection.encryptedKey) : null;
}

async function uploadFile(apiKey: string, data: Buffer, mimeType: string, displayName: string) {
  const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    signal: AbortSignal.timeout(5 * 60_000),
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(data.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!start.ok) throw new Error(`GEMINI_FILE_UPLOAD_START_${start.status}`);
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("GEMINI_FILE_UPLOAD_URL_MISSING");
  const uploaded = await fetch(uploadUrl, { method: "POST", signal: AbortSignal.timeout(5 * 60_000), headers: { "Content-Length": String(data.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: new Uint8Array(data) });
  if (!uploaded.ok) throw new Error(`GEMINI_FILE_UPLOAD_${uploaded.status}`);
  let file = ((await uploaded.json()) as { file?: GeminiFile }).file;
  if (!file?.name) throw new Error("GEMINI_FILE_METADATA_MISSING");
  for (let attempt = 0; file.state === "PROCESSING" && attempt < 30; attempt += 1) {
    await delay(2_000);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, { signal: AbortSignal.timeout(5 * 60_000), headers: { "x-goog-api-key": apiKey } });
    if (!response.ok) throw new Error(`GEMINI_FILE_STATUS_${response.status}`);
    file = await response.json() as GeminiFile;
  }
  if (file.state === "FAILED" || file.state === "PROCESSING" || !file.uri) throw new Error(`GEMINI_FILE_NOT_ACTIVE_${file.state ?? "UNKNOWN"}`);
  return file;
}

async function deleteFile(apiKey: string, file?: GeminiFile) {
  if (!file?.name) return;
  try { await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, { method: "DELETE", headers: { "x-goog-api-key": apiKey } }); } catch { /* Files expire automatically; do not hide the validation result. */ }
}

async function generateVerdict(apiKey: string, parts: Array<Record<string, unknown>>, instruction: string): Promise<ProviderVerdict> {
  const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    signal: AbortSignal.timeout(5 * 60_000),
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ parts: [...parts, { text: instruction }] }], generationConfig: { responseMimeType: "application/json" } }),
  });
  if (!response.ok) throw new Error(`GEMINI_QUALITY_VALIDATION_${response.status}`);
  const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return parseJson(body.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text ?? "{}");
}

function normalizeProviderVerdict(value: ProviderVerdict): ValidationOutput {
  const verdict = value.verdict === "PASS" || value.verdict === "FAIL" || value.verdict === "UNCERTAIN" ? value.verdict : "UNCERTAIN";
  return { verdict, ...(verdict !== "PASS" ? { failureKind: "SEMANTIC_FAILURE" as const } : {}), issues: Array.isArray(value.issues) ? redactSecrets(value.issues) : verdict === "PASS" ? [] : [{ code: "QUALITY_VALIDATOR_UNCERTAIN", message: value.summary ?? "Quality Validator chưa thể kết luận." }] };
}

async function validateScene(apiKey: string, userId: string, projectId: string, scene: SceneExpectedState) {
  let file: GeminiFile | undefined;
  try {
    file = await uploadFile(apiKey, await readProjectVideo(projectId, userId, scene.sceneNumber), "video/mp4", `scene-${scene.sceneNumber}.mp4`);
    const result = await generateVerdict(apiKey, [{ file_data: { file_uri: file.uri, mime_type: "video/mp4" } }], `You are a strict video quality validator. Compare the actual 4-second scene with Expected State. Check character identity, background, required props, primary action, camera, duration, dialogue/audio intent, emotion, continuity, forbidden elements, source modeling intent, and whether the gag/action actually occurs. Return JSON only: {"verdict":"PASS|FAIL|UNCERTAIN","issues":[{"code":"...","message":"...","sceneNumber":${scene.sceneNumber},"expected":"...","actual":"..."}],"summary":"..."}. Do not pass merely because the file renders. Expected State: ${JSON.stringify(scene)}`);
    return normalizeProviderVerdict(result);
  } finally {
    await deleteFile(apiKey, file);
  }
}

export async function validateQuality(userId: string, stage: CodexStage, expected: ExpectedState): Promise<ValidationOutput> {
  const apiKey = await geminiKey(userId);
  if (!apiKey) return { verdict: "UNCERTAIN", failureKind: "SEMANTIC_FAILURE", issues: [{ code: "GEMINI_QUALITY_CONNECTION_REQUIRED", message: "Cần kết nối Gemini để kiểm tra chất lượng hình/video thực tế." }] };
  if (!expected.projectId) return { verdict: "UNCERTAIN", failureKind: "SEMANTIC_FAILURE", issues: [{ code: "PROJECT_ID_MISSING", message: "Expected State thiếu projectId." }] };
  try {
    if (stage === "ASSETS") {
      const results: ValidationOutput[] = [];
      const background = await readProjectImage(expected.projectId, userId, "background", 0);
      results.push(normalizeProviderVerdict(await generateVerdict(apiKey, [{ inline_data: { mime_type: background.mimeType, data: background.data.toString("base64") } }], `Validate this approved background plate. It must be one coherent empty full-frame environment, preserve the expected location, layout, lighting and landmarks, and contain no character, collage, storyboard, split panel, caption, label or logo. Return JSON only with verdict PASS|FAIL|UNCERTAIN and issues. Expected backgrounds: ${JSON.stringify((expected.scenes ?? []).map((scene) => scene.expectedBackground))}`)));
      for (const scene of expected.scenes ?? []) {
        const image = await readProjectImage(expected.projectId, userId, "scene", scene.sceneNumber);
        const verdict = normalizeProviderVerdict(await generateVerdict(apiKey, [{ inline_data: { mime_type: image.mimeType, data: image.data.toString("base64") } }], `Validate this scene start-frame against Expected State. It must be one full-frame image, use the approved character/background, show the exact frozen initial state before motion, include required props, and contain no collage, storyboard, split panels, labels, captions, logos, or unrelated elements. Return JSON only with verdict PASS|FAIL|UNCERTAIN and issues. Expected State: ${JSON.stringify(scene)}`));
        results.push({ ...verdict, issues: verdict.issues.map((issue) => ({ ...issue, sceneNumber: scene.sceneNumber })) });
      }
      const issues = results.flatMap((result) => result.issues);
      if (results.some((result) => result.verdict === "FAIL")) return { verdict: "FAIL", failureKind: "SEMANTIC_FAILURE", issues };
      if (results.some((result) => result.verdict === "UNCERTAIN")) return { verdict: "UNCERTAIN", failureKind: "SEMANTIC_FAILURE", issues };
      return { verdict: "PASS", issues: [] };
    }
    if (stage === "SCENES") {
      const sceneResults: ValidationOutput[] = [];
      // Provider-aware batch size: two independent validations in parallel. Flow
      // generation itself remains sequential because it uses one browser session.
      for (let index = 0; index < (expected.scenes ?? []).length; index += 2) sceneResults.push(...await Promise.all((expected.scenes ?? []).slice(index, index + 2).map((scene) => validateScene(apiKey, userId, expected.projectId!, scene))));
      const issues = sceneResults.flatMap((result) => result.issues);
      if (sceneResults.some((result) => result.verdict === "FAIL")) return { verdict: "FAIL", failureKind: "SEMANTIC_FAILURE", issues };
      if (sceneResults.some((result) => result.verdict === "UNCERTAIN")) return { verdict: "UNCERTAIN", failureKind: "SEMANTIC_FAILURE", issues };
      return { verdict: "PASS", issues: [] };
    }
    if (stage === "FINAL_AUDIT") {
      let file: GeminiFile | undefined;
      try {
        file = await uploadFile(apiKey, await readProjectFinalVideo(expected.projectId, userId), "video/mp4", "final-modeling-video.mp4");
        return normalizeProviderVerdict(await generateVerdict(apiKey, [{ file_data: { file_uri: file.uri, mime_type: "video/mp4" } }], `Perform the mandatory Final Audit of this modeling video. Verify technical playability, all scenes and correct order, no duplicate scene, character/background/prop continuity, action and audio, expected pacing and ending, source fidelity, modeling mechanism, core gag, and final storytelling goal. Do not pass only because rendering succeeded. Return JSON only with verdict PASS|FAIL|UNCERTAIN and concrete issues including sceneNumber when known. Expected State: ${JSON.stringify(expected)}`));
      } finally {
        await deleteFile(apiKey, file);
      }
    }
    return { verdict: "PASS", issues: [] };
  } catch (error) {
    return { verdict: "UNCERTAIN", failureKind: "TECHNICAL_FAILURE", issues: [{ code: "QUALITY_PROVIDER_FAILURE", message: redactSecrets(error instanceof Error ? error.message : "Quality provider failed.") }] };
  }
}
