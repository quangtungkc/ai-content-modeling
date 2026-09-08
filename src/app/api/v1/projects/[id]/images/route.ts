import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { generateProjectImage, readProjectImage, type GeneratedImageKind } from "@/modules/assets/image-generation-service";

type Context = { params: Promise<{ id: string }> };
const normalize = (error: unknown) => error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error;
const kinds = new Set<GeneratedImageKind>(["character", "background", "scene"]);

export async function POST(request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    const body = await request.json() as { kind?: GeneratedImageKind; sceneNumber?: number; prompt?: string; aspectRatio?: string };
    if (!body.kind || !kinds.has(body.kind) || !body.prompt?.trim()) throw new AppError("VALIDATION_ERROR", "Thiếu loại ảnh hoặc prompt.", 400);
    return Response.json({ data: await generateProjectImage(id, session.userId, { kind: body.kind, sceneNumber: body.sceneNumber, prompt: body.prompt.trim(), aspectRatio: body.aspectRatio ?? "9:16" }), requestId }, { status: 201 });
  } catch (error) { return toErrorResponse(normalize(error), requestId); }
}

export async function GET(request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    const query = new URL(request.url).searchParams;
    const kind = query.get("kind") as GeneratedImageKind | null;
    const sceneNumber = Number(query.get("sceneNumber") ?? "0");
    if (!kind || !kinds.has(kind)) throw new AppError("VALIDATION_ERROR", "Loại ảnh không hợp lệ.", 400);
    const image = await readProjectImage(id, session.userId, kind, sceneNumber);
    return new Response(image.data, { headers: { "Content-Type": image.mimeType, "Cache-Control": "private, max-age=3600" } });
  } catch (error) { return toErrorResponse(normalize(error), requestId); }
}
