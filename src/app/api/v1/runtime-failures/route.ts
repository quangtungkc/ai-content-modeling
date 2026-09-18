import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { reportRuntimeFailure } from "@/modules/codex-orchestrator/runtime-failure";
import { ProductionRuntimeIncidentBridge } from "@/modules/troubleshooting/runtime-bridge";

const schema = z.object({
  source: z.string().trim().min(1).max(120),
  code: z.string().trim().max(120).optional(),
  message: z.string().trim().min(1).max(4_000),
  stack: z.string().max(12_000).optional(),
  stage: z.enum(["ANALYSIS", "MODELING", "PROJECT", "ASSETS", "SCENES", "FINAL_ASSEMBLY", "FINAL_AUDIT", "POST_RUN_REVIEW"]).optional(),
  codexJobId: z.string().max(120).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const input = schema.parse(await request.json());
    const runtimeError = new Error(input.message);
    if (input.stack) runtimeError.stack = input.stack;
    const failure = await reportRuntimeFailure({
      userId: session.userId,
      codexJobId: input.codexJobId,
      source: input.source,
      stage: input.stage,
      code: input.code,
      error: runtimeError,
      context: { ...input.context, clientStack: input.stack, requestId },
      dispatch: input.stage === "PROJECT" && !input.codexJobId ? false : undefined,
    });
    let troubleshooting: unknown;
    if (input.stage === "PROJECT" && !input.codexJobId) {
      try {
        const context = input.context ?? {};
        const result = await new ProductionRuntimeIncidentBridge().handleStandalone({
          userId: session.userId,
          stage: "PROJECT",
          error: runtimeError,
          projectId: typeof context.projectId === "string" ? context.projectId : null,
          sourceVideoId: typeof context.sourceVideoId === "string" ? context.sourceVideoId : null,
          runId: typeof context.automationRunId === "string" ? context.automationRunId : null,
          actualState: { ...context, component: "content-project-creation", errorCode: input.code },
          checkpoint: context.checkpoint && typeof context.checkpoint === "object" && !Array.isArray(context.checkpoint) ? context.checkpoint as Record<string, unknown> : { stage: "PROJECT", ...context },
          context: { ...context, component: "content-project-creation", errorCode: input.code },
          provider: input.source,
        });
        troubleshooting = {
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
      } catch (bridgeError) {
        troubleshooting = { bridge: "failed", bridgeError: bridgeError instanceof Error ? { name: bridgeError.name, message: bridgeError.message, stack: bridgeError.stack } : { message: String(bridgeError) } };
      }
    }
    return Response.json({ data: { id: failure.id, status: failure.status, troubleshooting }, requestId }, { status: 202 });
  } catch (error) {
    const normalized = error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error;
    return toErrorResponse(error instanceof z.ZodError ? new AppError("VALIDATION_ERROR", "Dữ liệu lỗi runtime không hợp lệ.", 400, error.flatten()) : normalized, requestId);
  }
}
