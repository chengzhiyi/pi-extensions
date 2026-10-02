export const PLUGIN_ID = "@chengzhiyi/pi-plan-mode";
export const STATE_KIND = `${PLUGIN_ID}/state`;
export const PLAN_KIND = `${PLUGIN_ID}/plan`;
export const REVIEW_KIND = `${PLUGIN_ID}/review`;
export const EXECUTION_KIND = `${PLUGIN_ID}/execution`;
export const PLAN_TOOL = "submit_plan";
export const QUESTION_TOOL = "ask_user";
export const QUESTIONS_KIND = `${PLUGIN_ID}/questions`;
export const ANSWERS_KIND = `${PLUGIN_ID}/answers`;
export const READ_TOOLS = new Set(["read", "grep", "find", "ls", PLAN_TOOL, QUESTION_TOOL]);

export interface StateEntry { type: string; customType?: string; data?: unknown }
export interface PlanState { enabled: boolean }
export interface PlanDocument { schemaVersion: 2; planId: string; revision: number; callId: string; title: string; markdown: string }
export type ReviewDecision = { decision: "approve" } | { decision: "cancel" } | { decision: "discuss"; feedback?: string };
export type ExecutionOutcome = "started" | "completed" | "aborted" | "error" | "interrupted";
export type PlanStatus = "waiting" | "revising" | "superseded" | "approved" | "executing" | "finished" | "cancelled" | "interrupted" | "failed";
export interface PlanArtifact extends PlanDocument { status: PlanStatus; feedback?: string; canResubmit: boolean; canResume: boolean }

export function planState(entries: readonly StateEntry[]): PlanState {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== STATE_KIND) continue;
    return { enabled: (entry.data as { enabled?: unknown } | undefined)?.enabled === true };
  }
  return { enabled: false };
}

export function planDocuments(entries: readonly StateEntry[]): PlanDocument[] {
  return entries.flatMap((entry) => {
    if (entry.type !== "custom" || entry.customType !== PLAN_KIND || !entry.data || typeof entry.data !== "object") return [];
    const data = entry.data as Record<string, unknown>;
    if (typeof data.callId !== "string" || typeof data.title !== "string" || typeof data.markdown !== "string") return [];
    if (data.schemaVersion !== undefined && (data.schemaVersion !== 2 || typeof data.planId !== "string" || !data.planId || !Number.isSafeInteger(data.revision) || Number(data.revision) < 1)) return [];
    return [{ schemaVersion: 2, planId: typeof data.planId === "string" ? data.planId : data.callId,
      revision: typeof data.revision === "number" ? data.revision : 1, callId: data.callId, title: data.title, markdown: data.markdown }];
  });
}

/** Live requests are authoritative. A logged document alone never restores approval. */
export function planArtifacts(entries: readonly StateEntry[], options: { pendingCallIds?: readonly string[]; running?: boolean } = {}): PlanArtifact[] {
  const documents = planDocuments(entries);
  const reviews = new Map<string, ReviewDecision>();
  const executions = new Map<string, ExecutionOutcome>();
  for (const entry of entries) {
    if (entry.type !== "custom" || !entry.data || typeof entry.data !== "object") continue;
    const data = entry.data as Record<string, unknown>;
    if (typeof data.callId !== "string") continue;
    if (entry.customType === REVIEW_KIND) {
      try { reviews.set(data.callId, parseReviewDecision(data)); } catch { /* Ignore malformed historical records. */ }
    } else if (entry.customType === EXECUTION_KIND && ["started", "completed", "aborted", "error", "interrupted"].includes(String(data.outcome))) {
      executions.set(data.callId, data.outcome as ExecutionOutcome);
    }
  }
  const latestRevision = new Map<string, number>();
  for (const doc of documents) latestRevision.set(doc.planId, Math.max(latestRevision.get(doc.planId) ?? 0, doc.revision));
  return documents.map(doc => {
    const review = reviews.get(doc.callId);
    const execution = executions.get(doc.callId);
    let status: PlanStatus = "interrupted";
    if (options.pendingCallIds?.includes(doc.callId)) status = "waiting";
    else if (execution === "started" && options.running) status = "executing";
    else if (execution === "completed") status = "finished";
    else if (execution === "error") status = "failed";
    else if (execution) status = "interrupted";
    else if (review?.decision === "cancel") status = "cancelled";
    else if (review?.decision === "approve") status = "approved";
    else if (review?.decision === "discuss") status = "revising";
    if ((latestRevision.get(doc.planId) ?? 1) > doc.revision) status = "superseded";
    return { ...doc, status, ...(review?.decision === "discuss" && review.feedback ? { feedback: review.feedback } : {}),
      canResubmit: status === "interrupted" && !review && !execution && !options.running,
      canResume: (status === "interrupted" || status === "failed") && review?.decision === "approve" && !!execution && !options.running };
  });
}

export function parseReviewDecision(value: unknown): ReviewDecision {
  if (!value || typeof value !== "object") throw new Error("Invalid plan review decision");
  const data = value as Record<string, unknown>;
  if (data.decision === "approve" || data.decision === "cancel") return { decision: data.decision };
  if (data.decision !== "discuss") throw new Error("Invalid plan review decision");
  if (data.feedback === undefined) return { decision: "discuss" };
  if (typeof data.feedback !== "string" || !data.feedback.trim() || data.feedback.trim().length > 4000) throw new Error("Revision feedback must contain 1–4000 characters");
  return { decision: "discuss", feedback: data.feedback.trim() };
}

export function mayCallTool(readOnly: boolean, name: string): boolean {
  return !readOnly || READ_TOOLS.has(name);
}
