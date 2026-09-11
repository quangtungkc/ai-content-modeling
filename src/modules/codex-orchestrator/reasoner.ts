import { z } from "zod";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";
import { getEnv } from "@/lib/env";
import { HIGH_LEVEL_TOOLS, isAllowedTool } from "./tools";
import { redactSecrets } from "./policy";
import type { CodexDecision, CodexStage } from "./types";

const decisionSchema = z.object({
  selectedTool: z.string(),
  targetStage: z.string().optional(),
  targetIds: z.array(z.string()).default([]),
  strategy: z.string().optional(),
  shortReason: z.string().min(1).max(500),
  evidence: z.array(z.string().max(500)).max(10).default([]),
  externalReferences: z.array(z.string().url().max(1_000)).max(10).default([]),
  alternativeSolutions: z.array(z.string().max(1_000)).max(10).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
});
const repairSchema = z.object({
  summary: z.string().min(1).max(500),
  rootCause: z.string().min(1).max(1_000),
  patch: z.string().min(1).max(120_000),
  regressionTest: z.string().min(1).max(500),
});

export type ReasonerRequest = {
  purpose: "PLAN" | "RECOVERY" | "UNCERTAIN_VALIDATION" | "FINAL_AUDIT" | "POST_RUN_REVIEW" | "RUNTIME_FAILURE";
  stage?: CodexStage;
  state: Record<string, unknown>;
  allowedTools?: string[];
};

export type ReasonerResult = { decision: CodexDecision; responseId: string | null };

export const CODEX_REQUEST_TIMEOUT_MS = 5 * 60 * 1_000;

function outputDecision(body: Record<string, unknown>) {
  if (typeof body.output_text === "string") return body.output_text;
  const output = Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type === "function_call" && typeof record.arguments === "string" && typeof record.name === "string") {
      const args = JSON.parse(record.arguments) as Record<string, unknown>;
      return JSON.stringify({ ...args, selectedTool: record.name });
    }
    const content = Array.isArray(record.content) ? record.content : [];
    for (const part of content) if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") return String((part as Record<string, unknown>).text);
  }
  return "";
}

export class CodexReasoner {
  async proposeCodeRepair(userId: string, state: Record<string, unknown>) {
    const env = getEnv();
    const connection = await db.aIConnection.findFirst({ where: { userId, provider: "OPENAI", kind: "AI", revokedAt: null }, orderBy: { updatedAt: "desc" } });
    if (!connection) throw new Error("CODEX_OPENAI_CONNECTION_REQUIRED");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(CODEX_REQUEST_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${decryptSecret(connection.encryptedKey)}` },
      body: JSON.stringify({
        model: env.CODEX_MODEL,
        instructions: [
          "Diagnose one confirmed application-code failure and return the smallest safe unified git diff.",
          "Modify only files explicitly included in the supplied allowlist. Never modify environment files, credentials, authentication, database files, migrations, package manifests, lockfiles, release configuration, Electron bootstrap, or generated output.",
          "The patch must include or update a regression test. Do not refactor unrelated code. Return JSON only.",
        ].join("\n"),
        input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(redactSecrets(state)) }] }],
        text: { format: { type: "json_schema", name: "guarded_code_repair", strict: true, schema: { type: "object", additionalProperties: false, properties: { summary: { type: "string" }, rootCause: { type: "string" }, patch: { type: "string" }, regressionTest: { type: "string" } }, required: ["summary", "rootCause", "patch", "regressionTest"] } } },
        store: false,
      }),
    });
    if (!response.ok) throw new Error(`CODEX_REPAIR_RESPONSE_FAILED_${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    return repairSchema.parse(JSON.parse(outputDecision(body)));
  }

  async decide(userId: string, request: ReasonerRequest, previousResponseId?: string | null): Promise<ReasonerResult> {
    const env = getEnv();
    const connection = await db.aIConnection.findFirst({ where: { userId, provider: "OPENAI", kind: "AI", revokedAt: null }, orderBy: { updatedAt: "desc" } });
    if (!connection) throw new Error("CODEX_OPENAI_CONNECTION_REQUIRED");
    const allowed = new Set(request.allowedTools ?? HIGH_LEVEL_TOOLS.map((tool) => tool.name));
    const toolNames = HIGH_LEVEL_TOOLS.map((tool) => tool.name).filter((name) => allowed.has(name));
    const safeState = redactSecrets(request.state);
    const instructions = [
      "You are the Codex orchestration brain for an existing video-modeling application.",
      "Select only one whitelisted high-level tool. Never request credentials, deploy, merge, or arbitrary shell. Production-code repair is allowed only through repairProductionCode and its guarded allowlist/test/build gate.",
      "Prefer deterministic recovery and a previously successful experience. Never repeat an identical failed strategy.",
      request.purpose === "RECOVERY" ? "Identify the most likely root cause from Expected State, Actual State, exact error, same-signature attempts, and experience. If the listed candidate strategies do not address that root cause, propose one new specific strategy but execute it only through an allowed high-level tool. Target only the failed asset or scene whenever evidence identifies it. Treat provider availability failures separately from semantic content failures." : "",
      request.purpose === "POST_RUN_REVIEW" ? "For external research, evaluate license, maintenance, security, complexity, compatibility, migration cost, performance, and long-term impact. Create proposals only; never modify, merge, or deploy production." : "",
      request.purpose === "RUNTIME_FAILURE" ? "This is a runtime interruption report. Diagnose from the supplied evidence, do not invent missing facts, and choose only a read-only diagnostic or waitForHuman action unless this report is attached to an active Codex Job." : "",
      "Do not output chain-of-thought. Return only a concise decision with selectedTool, targetStage, targetIds, strategy, shortReason, evidence, externalReferences, alternativeSolutions, confidence.",
      `Allowed tools: ${toolNames.join(", ")}.`,
    ].join("\n");
    const toolDefinitions = HIGH_LEVEL_TOOLS.filter((tool) => toolNames.includes(tool.name)).map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      strict: false,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          targetStage: { type: "string", enum: ["ANALYSIS", "MODELING", "PROJECT", "ASSETS", "SCENES", "FINAL_ASSEMBLY", "FINAL_AUDIT", "POST_RUN_REVIEW"] },
          targetIds: { type: "array", items: { type: "string" } },
          strategy: { type: "string" },
          shortReason: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          externalReferences: { type: "array", items: { type: "string", format: "uri" } },
          alternativeSolutions: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["targetIds", "shortReason", "evidence", "externalReferences", "alternativeSolutions", "confidence"],
      },
    }));
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(CODEX_REQUEST_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${decryptSecret(connection.encryptedKey)}` },
      body: JSON.stringify({
        model: env.CODEX_MODEL,
        instructions,
        input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ purpose: request.purpose, stage: request.stage, state: safeState }) }] }],
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        store: true,
        reasoning: { effort: "medium" },
        tools: [...toolDefinitions, ...(request.purpose === "POST_RUN_REVIEW" && env.CODEX_EXTERNAL_RESEARCH_ENABLED ? [{ type: "web_search_preview" }] : [])],
        tool_choice: "required",
        prompt_cache_key: `viral-modeling-codex:${userId}`,
      }),
    });
    if (!response.ok) throw new Error(`CODEX_RESPONSE_FAILED_${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    const parsed = decisionSchema.parse(JSON.parse(outputDecision(body)));
    if (!isAllowedTool(parsed.selectedTool) || !allowed.has(parsed.selectedTool)) throw new Error("CODEX_TOOL_NOT_ALLOWED");
    return {
      decision: { ...parsed, selectedTool: parsed.selectedTool as CodexDecision["selectedTool"], targetStage: parsed.targetStage as CodexStage | undefined },
      responseId: typeof body.id === "string" ? body.id : null,
    };
  }
}
