import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { db } from "@/lib/db";
import { AppError, toErrorResponse } from "@/lib/errors";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    const project = await db.contentProject.findFirst({
      where: { id, channel: { userId: session.userId } },
      select: {
        id: true,
        sourceVideoId: true,
        sourceVideoUrl: true,
        sourceDuration: true,
        sourcePlatform: true,
        modelingPolicy: true,
        modelingFidelityTarget: true,
        sourceModelingSpecVersion: true,
        sourceModelingSpec: true,
        artDirection: true,
        characterDesign: true,
        backgroundDesign: true,
        scenes: {
          orderBy: { sceneNumber: "asc" },
          select: {
            sceneNumber: true,
            sourceSceneId: true,
            sourceSceneOrder: true,
            sourceSceneStartTime: true,
            sourceSceneEndTime: true,
            targetDuration: true,
            timingStatus: true,
            cameraSpec: true,
            actionSequence: true,
            visualBlock: true,
            actionBlock: true,
            audioBlock: true,
            startFramePrompt: true,
            englishPrompt: true,
          },
        },
      },
    });
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "Không tìm thấy content project.", 404);
    return Response.json({ data: project, requestId });
  } catch (error) {
    return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId);
  }
}
