import { rm } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

const appDataRoot = () => path.join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "ai-content-modeling");
const legacyAppDataRoot = () => path.join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "Modeling AI");

async function removeProjectMedia(projectIds: string[]) {
  const roots = [
    path.join(appDataRoot(), "generated-images"),
    path.join(appDataRoot(), "generated-videos"),
    path.join(legacyAppDataRoot(), "generated-images"),
    path.join(legacyAppDataRoot(), "generated-videos"),
  ];
  await Promise.all(projectIds.flatMap((projectId) => roots.map((root) => rm(path.join(root, projectId), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }))));
}

export async function deleteContentProjects(projectIds: string[], userId: string) {
  const uniqueIds = [...new Set(projectIds)].filter(Boolean);
  if (!uniqueIds.length) return { deletedProjects: 0 };
  if (uniqueIds.some((id) => !/^[A-Za-z0-9_-]+$/.test(id))) throw new AppError("VALIDATION_ERROR", "Mã project không hợp lệ.", 400);
  const projects = await db.contentProject.findMany({
    where: { id: { in: uniqueIds }, channel: { userId } },
    select: { id: true, scenes: { select: { id: true } }, assets: { select: { id: true } } },
  });
  if (projects.length !== uniqueIds.length) throw new AppError("PROJECT_NOT_FOUND", "Không tìm thấy project modeling thuộc tài khoản.", 404);
  const ownedIds = projects.map(({ id }) => id);
  const sceneIds = projects.flatMap((project) => project.scenes.map(({ id }) => id));
  const assetIds = projects.flatMap((project) => project.assets.map(({ id }) => id));
  await db.$transaction([
    db.sceneGenerationVersion.deleteMany({ where: { sceneId: { in: sceneIds } } }),
    db.videoGenerationJob.deleteMany({ where: { sceneId: { in: sceneIds } } }),
    db.videoGeneration.deleteMany({ where: { sceneId: { in: sceneIds } } }),
    db.sceneAsset.deleteMany({ where: { OR: [{ sceneId: { in: sceneIds } }, { assetId: { in: assetIds } }] } }),
    db.assetValidation.deleteMany({ where: { assetId: { in: assetIds } } }),
    db.asset.deleteMany({ where: { projectId: { in: ownedIds } } }),
    db.projectReview.deleteMany({ where: { projectId: { in: ownedIds } } }),
    db.usageEvent.deleteMany({ where: { projectId: { in: ownedIds } } }),
    db.storyboardScene.deleteMany({ where: { projectId: { in: ownedIds } } }),
    db.automationRun.updateMany({ where: { projectId: { in: ownedIds } }, data: { projectId: null } }),
    db.contentProject.deleteMany({ where: { id: { in: ownedIds } } }),
  ]);
  await removeProjectMedia(ownedIds);
  return { deletedProjects: ownedIds.length };
}

export async function deleteSourceVideoWithModeling(videoId: string, userId: string) {
  const video = await db.competitorVideo.findFirst({
    where: { id: videoId, competitor: { channel: { userId } } },
    select: { id: true },
  });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy video thuộc tài khoản.", 404);
  const ideas = await db.modelingIdea.findMany({
    where: { sourceVideoId: videoId },
    select: { id: true, project: { select: { id: true } } },
  });
  const projectIds = ideas.flatMap((idea) => idea.project ? [idea.project.id] : []);
  await deleteContentProjects(projectIds, userId);
  await db.$transaction([
    db.automationRun.deleteMany({ where: { userId, sourceVideoId: videoId } }),
    db.modelingIdea.deleteMany({ where: { sourceVideoId: videoId } }),
    db.sourceAnalysis.deleteMany({ where: { sourceVideoId: videoId } }),
    db.reportItem.deleteMany({ where: { sourceVideoId: videoId } }),
    db.videoMetricSnapshot.deleteMany({ where: { videoId } }),
    db.competitorVideo.delete({ where: { id: videoId } }),
  ]);
  return { deletedVideoId: videoId, deletedProjects: projectIds.length };
}

export async function deleteAutomationRunWithProject(runId: string, userId: string) {
  const run = await db.automationRun.findFirst({ where: { id: runId, userId }, select: { id: true, projectId: true } });
  if (!run) throw new AppError("AUTOMATION_NOT_FOUND", "Không tìm thấy dự án trong lịch sử hoạt động.", 404);
  const ownedProject = run.projectId
    ? await db.contentProject.findFirst({ where: { id: run.projectId, channel: { userId } }, select: { id: true } })
    : null;
  if (ownedProject) await deleteContentProjects([ownedProject.id], userId);
  await db.automationRun.delete({ where: { id: run.id } });
  return { deletedRunId: run.id, deletedProjectId: run.projectId };
}
