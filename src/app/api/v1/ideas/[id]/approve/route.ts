import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { db } from "@/lib/db";
import { AppError, toErrorResponse } from "@/lib/errors";
import { getAuthoritativeSourceModelingSpec, setIdeaStatus } from "@/modules/ideas/approval-service";
import { ProductionRuntimeIncidentBridge, type StandaloneRuntimeBridgeResult } from "@/modules/troubleshooting/runtime-bridge";

type ApprovalRequestBody = { automationRunId?: string };

function errorInfo(error: unknown) {
  if (error instanceof Error) {
    const candidate = error as Error & { code?: unknown };
    return { name: error.name || "Error", message: error.message || "Unknown error.", stack: error.stack, code: typeof candidate.code === "string" ? candidate.code : undefined };
  }
  return { name: "RuntimeError", message: typeof error === "string" ? error : "Unknown error.", stack: undefined, code: undefined };
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function clientTroubleshooting(result: StandaloneRuntimeBridgeResult) {
  return {
    disposition: result.disposition,
    fingerprint: result.fingerprint,
    matchDecision: result.matchDecision,
    matchedRuleId: result.matchedRuleId,
    resumeStage: result.resumeStage,
    incidentId: result.repair.incidentId,
    repair: { status: result.repair.status, nextAction: result.repair.nextAction },
    jsonReportPath: result.jsonReportPath,
    markdownReportPath: result.markdownReportPath,
    reportWarning: result.reportWarning,
    userMessage: result.userMessage,
  };
}

async function sourceVideoForIdea(id: string, userId: string) {
  const idea = await db.modelingIdea.findFirst({
    where: { id, analysis: { sourceVideo: { competitor: { channel: { userId } } } } },
    select: { sourceVideoId: true },
  });
  return idea?.sourceVideoId ?? null;
}

function structuredFailure(error: unknown, troubleshooting: unknown) {
  const details = { originalError: errorInfo(error), troubleshooting };
  if (error instanceof AppError) return new AppError(error.code, error.message, error.status, { ...record(error.details), ...details });
  return new AppError("CONTENT_PROJECT_CREATION_FAILED", errorInfo(error).message || "Không tạo được Content Project và phân cảnh.", 409, details);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  let userId = "";
  let ideaId = "";
  let body: ApprovalRequestBody = {};
  try {
    const session = await getRequiredSession();
    userId = session.userId;
    ideaId = (await context.params).id;
    body = await request.json().catch(() => ({})) as ApprovalRequestBody;
    const data = await setIdeaStatus(ideaId, userId, "APPROVED");
    const sourceVideoId = await sourceVideoForIdea(ideaId, userId);
    const authoritativeSourceModelingSpec = sourceVideoId ? await getAuthoritativeSourceModelingSpec(sourceVideoId) : null;
    return Response.json({ data, authoritativeSourceModelingSpec, requestId });
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") return toErrorResponse(new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401), requestId);
    if (!userId || !ideaId) return toErrorResponse(structuredFailure(error, { bridge: "not-run", requestId }), requestId);
    let sourceVideoId: string | null = null;
    try { sourceVideoId = await sourceVideoForIdea(ideaId, userId); } catch { /* Keep the original approval error. */ }
    const details = errorInfo(error);
    let troubleshooting: unknown;
    try {
      const result = await new ProductionRuntimeIncidentBridge().handleStandalone({
        userId,
        stage: "PROJECT",
        error,
        sourceVideoId,
        runId: body.automationRunId ?? null,
        actualState: { operation: "approve-modeling-idea", ideaId, sourceVideoId },
        checkpoint: { stage: "PROJECT", ideaId, sourceVideoId, operation: "approve-modeling-idea" },
        context: { ideaId, sourceVideoId, automationRunId: body.automationRunId ?? null, component: "content-project-creation", errorCode: details.code, affectedFiles: ["src/modules/ideas/approval-service.ts", "src/app/api/v1/ideas/[id]/approve/route.ts"] },
        provider: "content-project-approval",
      });
      troubleshooting = clientTroubleshooting(result);
      if (result.disposition === "RESUME") {
        try {
          const data = await setIdeaStatus(ideaId, userId, "APPROVED");
          const retrySourceVideoId = await sourceVideoForIdea(ideaId, userId);
          const authoritativeSourceModelingSpec = retrySourceVideoId ? await getAuthoritativeSourceModelingSpec(retrySourceVideoId) : null;
          return Response.json({ data, authoritativeSourceModelingSpec, requestId, troubleshooting }, { status: 200 });
        } catch (retryError) {
          troubleshooting = { ...record(troubleshooting), retryError: errorInfo(retryError), recoveryRetry: "FAILED" };
          error = retryError;
        }
      }
    } catch (bridgeError) {
      troubleshooting = { bridge: "failed", bridgeError: errorInfo(bridgeError), requestId };
    }
    return toErrorResponse(structuredFailure(error, troubleshooting), requestId);
  }
}
