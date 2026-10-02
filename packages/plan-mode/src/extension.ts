import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { notifyWebChanged, registerWebActions, requestWebInteraction, WebInteractionUnavailable } from "@chengzhiyi/pi-web-protocol";
import { EXECUTION_KIND, PLAN_KIND, PLAN_TOOL, PLUGIN_ID, READ_TOOLS, REVIEW_KIND, STATE_KIND, QUESTION_TOOL, QUESTIONS_KIND, ANSWERS_KIND, mayCallTool, parseReviewDecision, planArtifacts, planDocuments, planState, type ExecutionOutcome, type PlanDocument, type PlanArtifact } from "./state.js";

import { parseQuestions, parseQuestionDecision } from "./questions.js";

const PLAN_GUIDANCE = `PLAN MODE: Stay read-only. Explore only when the task needs workspace context; an empty directory does not block a learning plan.
First understand the requested outcome and preserve every explicit requirement. Clarify consequential choices BEFORE drafting: if the user has not specified the implementation/example technology stack, deployment direction, scope trade-offs, or time constraints and those choices materially change the deliverable, call ask_user. Do not silently choose these on the user's behalf just because a recommended default is available. A recommendation is an option for the user to confirm, not authorization to skip questions.
Ask only the unanswered decisions needed for this task, normally 1–3 concise questions in one batch, each with 2–5 distinct choices and a recommended index when helpful. Do not ask whether to include content the user already explicitly requested. For example, if the task requests working integration examples, underlying principles, and the uses of collected data, preserve all three; ask which example stack to use, not whether these deliverables are wanted. Do not ask unrelated workspace questions or repeat decisions already answered in this request/history. Never replace ask_user with plain-text questions.
When the critical choices are already specified, or the user explicitly delegates them or asks to use defaults, submit_plan directly without filler questions. After answers, continue in this same request, use the exact confirmed choices, and submit_plan with a concise title, concrete steps, requested deliverables and acceptance criteria. State only the remaining low-impact assumptions. Do not reinterpret an answer as execution approval.
Your response must lead to ask_user or submit_plan in this request. Approval permits implementation only for this request. Feedback requires revising and resubmitting while read-only. Cancellation means stop.`;

export default function planMode(pi: ExtensionAPI): void {
  let current: ExtensionContext | null = null;
  let previousTools: string[] | null = null;
  let grant: { sessionId: string; plan: PlanDocument; signal?: AbortSignal } | null = null;
  let executionOutcome: ExecutionOutcome = "completed";
  let revisionBase: PlanDocument | null = null;
  let planningSessionId: string | null = null;
  let needsPlan = false;
  let planningPaused = false;
  let completionNudges = 0;
  const beginPlanning = (ctx: ExtensionContext, recovery: PlanArtifact | null = null) => {
    revisionBase = recovery;
    planningSessionId = ctx.sessionManager.getSessionId();
    needsPlan = enabled();
    planningPaused = false;
    completionNudges = 0;
    return PLAN_GUIDANCE + (recovery ? `\n\nThe user clicked ${recovery.canResume ? 'Review and resume' : 'Resubmit for approval'} for this saved plan. Continue the original task in this conversation. ${recovery.canResume
      ? "Inspect existing progress using read-only tools and session history. Preserve completed work and confirmed answers; do not repeat completed steps or ask confirmed choices again. Submit a new revision describing progress and only the remaining work, and wait for fresh approval before implementing. The previous approval has expired. Original complete plan:"
      : "Resubmit this interrupted version with its complete content."} Title: ${recovery.title}\n\n${recovery.markdown}` : "");
  };
  const enabled = () => current ? planState(current.sessionManager.getBranch()).enabled : false;
  const authorized = (ctx: ExtensionContext) => grant?.sessionId === ctx.sessionManager.getSessionId()
    && planDocuments(ctx.sessionManager.getBranch()).some(plan => plan.callId === grant?.plan.callId);
  const readOnly = (ctx: ExtensionContext) => enabled() && !authorized(ctx);
  const changed = () => notifyWebChanged(pi, PLUGIN_ID);
  const applyTools = () => {
    if (enabled()) {
      previousTools ??= pi.getActiveTools();
      pi.setActiveTools(grant ? previousTools : [...READ_TOOLS]);
    } else if (previousTools) {
      pi.setActiveTools(previousTools);
      previousTools = null;
    }
  };
  const endExecution = (outcome: ExecutionOutcome) => {
    if (!grant) return;
    if (current && authorized(current)) pi.appendEntry(EXECUTION_KIND, { callId: grant.plan.callId, planId: grant.plan.planId, revision: grant.plan.revision, outcome });
    grant = null;
    applyTools();
    changed();
  };
  const setMode = (value: boolean, ctx: ExtensionContext) => {
    if (!ctx.isIdle()) throw new Error("Wait for the current turn to finish");
    if (enabled() === value) return;
    pi.appendEntry(STATE_KIND, { enabled: value });
    applyTools();
    changed();
  };
  const sessionContext = (sessionId: string) => {
    if (!current || current.sessionManager.getSessionId() !== sessionId) throw new Error("Session changed");
    return current;
  };

  let stopActions: (() => void) | null = null;
  pi.on("session_shutdown", () => {
    stopActions?.();
    stopActions = null;
    endExecution("interrupted");
    if (previousTools) pi.setActiveTools(previousTools);
    previousTools = null;
    revisionBase = null;
    planningSessionId = null;
    current = null;
  });
  pi.on("session_start", (_event, ctx) => {
    grant = null;
    if (previousTools) pi.setActiveTools(previousTools);
    previousTools = null;
    revisionBase = null;
    planningSessionId = null;
    current = ctx;
    stopActions?.();
    stopActions = registerActions();
    // A persisted start is evidence of an interrupted execution, never permission.
    for (const plan of planArtifacts(ctx.sessionManager.getBranch())) {
      const lastExecution = [...ctx.sessionManager.getBranch()].reverse().find(entry => entry.type === "custom" && entry.customType === EXECUTION_KIND && (entry.data as { callId?: string })?.callId === plan.callId);
      if (lastExecution?.type === "custom" && (lastExecution.data as { outcome?: string })?.outcome === "started") pi.appendEntry(EXECUTION_KIND, { callId: plan.callId, outcome: "interrupted" });
    }
    applyTools();
    changed();
  });
  pi.on("session_tree", (_event, ctx) => {
    current = ctx;
    endExecution("interrupted");
    revisionBase = null;
    planningSessionId = null;
    applyTools();
    changed();
  });
  pi.on("before_agent_start", (event, ctx) => {
    current = ctx;
    endExecution("interrupted");
    const guidance = beginPlanning(ctx);
    if (!enabled()) return;
    applyTools();
    event.systemPromptOptions.appendSystemPrompt = [event.systemPromptOptions.appendSystemPrompt, PLAN_GUIDANCE].filter(Boolean).join("\n\n");
    return { message: { customType: "pi-plan-mode-guidance", display: false, content: guidance } };
  });
  pi.on("agent_end", (event) => {
    const last = [...event.messages].reverse().find(message => message.role === "assistant");
    executionOutcome = last?.role === "assistant" && last.stopReason === "error" ? "error"
      : last?.role === "assistant" && last.stopReason === "aborted" ? "aborted" : "completed";
  });
  pi.on("agent_before_settle", (event, ctx) => {
    if (event.outcome !== "completed" || !readOnly(ctx) || !needsPlan || planningPaused || planningSessionId !== ctx.sessionManager.getSessionId()) return;
    if (completionNudges >= 2) {
      planningPaused = true;
      return { entries: [{ type: "custom_message" as const, customType: "pi-plan-mode-incomplete", display: true,
        content: "计划尚未提交：模型未按要求生成计划或交互式提问。本次保持只读，可重试或切换模型。" }] };
    }
    completionNudges++;
    return { continue: true, entries: [{ type: "custom_message" as const, customType: "pi-plan-mode-completion", display: false,
      content: "This planning request is not complete: no plan was submitted. Continue now in this same request. Use ask_user first for any unanswered consequential choices; do not invent choices that change the requested deliverable. If those choices are already confirmed or explicitly delegated, use submit_plan with a complete plan preserving the user's requirements and answers. Plain-text questions or promises to plan are not a completed planning response. Stay read-only." }] };
  });
  pi.on("agent_settled", (_event, ctx) => {
    current = ctx;
    endExecution(grant?.signal?.aborted ? "aborted" : executionOutcome);
    revisionBase = null;
    planningSessionId = null;
    applyTools();
    changed();
  });
  pi.on("tool_call", (event, ctx) => {
    current = ctx;
    if (!mayCallTool(readOnly(ctx), event.toolName)) return { block: true, reason: `Plan mode blocks ${event.toolName}. Submit a plan for approval or use /plan off.` };
  });
  pi.on("user_bash", (_event, ctx) => {
    current = ctx;
    // A model's implementation grant does not authorize user shell escapes.
    if (!enabled()) return;
    return { result: { output: "Plan mode blocks shell execution. Use /plan off first.", exitCode: 1, cancelled: false, truncated: false } };
  });

  pi.registerTool(defineTool({
    name: PLAN_TOOL, label: "Submit plan", executionMode: "sequential",
    description: "Submit a complete plan and wait for review. Approval permits implementation in this request only. Feedback means revise and submit again. Cancellation stops the request.",
    parameters: Type.Object({ title: Type.String({ minLength: 1, maxLength: 160 }), markdown: Type.String({ minLength: 1, maxLength: 120000 }) }),
    async execute(callId, params, signal, _update, ctx) {
      current = ctx;
      if (!enabled() || grant) return { content: [{ type: "text", text: "Submit plans only while in read-only plan mode" }], details: undefined, isError: true };
      const sessionId = ctx.sessionManager.getSessionId();
      const title = params.title.trim();
      const markdown = params.markdown.trim();
      if (!title || !markdown) return { content: [{ type: "text", text: "Title and plan are required" }], details: undefined, isError: true };
      const base = revisionBase;
      const plan: PlanDocument = { schemaVersion: 2, planId: base?.planId ?? randomUUID(), revision: (base?.revision ?? 0) + 1, callId, title, markdown };
      revisionBase = null;
      needsPlan = false;
      pi.appendEntry(PLAN_KIND, plan);
      changed();
      let decision: unknown;
      try {
        decision = await requestWebInteraction(pi.events, { requestId: randomUUID(), sessionId, pluginId: PLUGIN_ID, kind: "plan.review", data: plan }, signal);
      } catch (cause) {
        if (!(cause instanceof WebInteractionUnavailable)) throw cause;
        if (!ctx.hasUI) return { content: [{ type: "text", text: `Plan submitted: ${title}. Stop and wait for the user to review it.` }], details: undefined, terminate: true };
        const choice = await ctx.ui.select(title + " — Review plan", ["Approve and implement", "Request changes", "Cancel plan"], { signal });
        if (choice === "Request changes") {
          const feedback = await ctx.ui.input("Revision feedback (1–4000 characters)", "Describe the changes", { signal });
          decision = feedback === undefined ? { decision: "discuss" } : { decision: "discuss", feedback };
        } else decision = { decision: choice === "Approve and implement" ? "approve" : "cancel" };
      }
      if (signal?.aborted || sessionId !== current?.sessionManager.getSessionId()) throw new Error("Plan review interrupted");
      const result = parseReviewDecision(decision);
      pi.appendEntry(REVIEW_KIND, { callId, planId: plan.planId, revision: plan.revision, ...result });
      if (result.decision === "approve") {
        grant = { sessionId, plan, signal };
        executionOutcome = "completed";
        pi.appendEntry(EXECUTION_KIND, { callId, planId: plan.planId, revision: plan.revision, outcome: "started" });
        applyTools();
        changed();
        return { content: [{ type: "text", text: "The user approved this exact plan version. Continue implementing it now. Write access lasts only for this request; read-only plan mode returns when the request finishes." }], details: undefined };
      }
      changed();
      if (result.decision === "cancel") {
        ctx.abort();
        return { content: [{ type: "text", text: "The user cancelled this plan. Stop now. Plan mode remains on." }], details: undefined, terminate: true };
      }
      if (result.feedback) {
        needsPlan = true;
        completionNudges = 0;
        revisionBase = plan;
        return { content: [{ type: "text", text: `The user requested these changes:\n\n${result.feedback}\n\nRemain read-only. Revise the plan and call submit_plan again. Do not implement until the revised version is approved.` }], details: undefined };
      }
      return { content: [{ type: "text", text: "The user requested changes. Remain in plan mode. Stop now and wait for their next message with revision instructions." }], details: undefined, terminate: true };
    },
  }));

  pi.registerTool(defineTool({
    name: QUESTION_TOOL, label: "Ask planning questions", executionMode: "sequential",
    description: "Ask essential planning decisions with selectable choices. User can also type a custom answer. Wait for their answers and continue read-only to submit_plan in the same request. Do not ask optional preferences that safe assumptions can resolve.",
    parameters: Type.Object({ questions: Type.Array(Type.Object({
      id: Type.String({ minLength: 1, maxLength: 80 }), question: Type.String({ minLength: 1, maxLength: 2000 }),
      options: Type.Array(Type.Object({ label: Type.String({ minLength: 1, maxLength: 200 }), description: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })) }), { minItems: 2, maxItems: 5 }),
      recommended: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
    }), { minItems: 1, maxItems: 5 }) }),
    async execute(callId, params, signal, _update, ctx) {
      current = ctx;
      if (!enabled() || grant) return { content: [{ type: "text", text: "Ask planning questions only while in read-only plan mode" }], details: undefined, isError: true };
      const sessionId = ctx.sessionManager.getSessionId();
      const questions = parseQuestions(params.questions);
      pi.appendEntry(QUESTIONS_KIND, { callId, questions });
      changed();
      let decision: unknown;
      try {
        decision = await requestWebInteraction(pi.events, { requestId: randomUUID(), sessionId, pluginId: PLUGIN_ID, kind: "plan.questions", data: { callId, questions } }, signal);
      } catch (cause) {
        if (!(cause instanceof WebInteractionUnavailable)) throw cause;
        if (!ctx.hasUI) {
          planningPaused = true;
          return { content: [{ type: "text", text: "Planning questions saved. Stop and wait for the user to answer: " + JSON.stringify(questions) }], details: undefined, terminate: true };
        }
        const answers: { id: string; value: string }[] = [];
        for (const question of questions) {
          const customChoice = "Other / 自定义回答";
          const choice = await ctx.ui.select(question.question, [...question.options.map(option => option.label), customChoice], { signal });
          const value = choice === customChoice ? await ctx.ui.input(question.question, "Your answer (1–4000 characters)", { signal }) : choice;
          if (value === undefined) { decision = { decision: "cancel" }; break; }
          answers.push({ id: question.id, value });
        }
        decision ??= { decision: "answer", answers };
      }
      if (signal?.aborted || sessionId !== current?.sessionManager.getSessionId()) throw new Error("Planning questions interrupted");
      const result = parseQuestionDecision(decision, questions);
      pi.appendEntry(ANSWERS_KIND, { callId, ...result });
      changed();
      if (result.decision === "cancel") {
        planningPaused = true;
        ctx.abort();
        return { content: [{ type: "text", text: "The user cancelled planning questions. Stop now; plan mode remains on." }], details: undefined, terminate: true };
      }
      return { content: [{ type: "text", text: "User planning decisions: " + JSON.stringify(result.answers) + "\nContinue read-only in this request. Incorporate these answers and call submit_plan; do not stop to request another user message." }], details: undefined };
    },
  }));

  pi.registerCommand("plan", {
    description: "Enter read-only plan mode: /plan [task|on|off]",
    handler: async (args, ctx) => {
      current = ctx;
      const task = args.trim();
      const value = task.toLowerCase();
      setMode(value !== "off", ctx);
      ctx.ui.notify(value !== "off" ? "Plan mode enabled" : "Plan mode disabled", "info");
      if (task && value !== "on" && value !== "off") pi.sendUserMessage(task);
    },
  });
  const recoverPlan = (input: unknown, request: { sessionId: string }) => {
    const ctx = sessionContext(request.sessionId);
    if (!ctx.isIdle()) throw new Error("Wait for the current turn to finish");
    const callId = (input as { callId?: unknown })?.callId;
    const plan = planArtifacts(ctx.sessionManager.getBranch(), { running: authorized(ctx) }).find(plan => plan.callId === callId);
    if (!plan || (!plan.canResubmit && !plan.canResume)) throw new Error("Only an eligible interrupted plan can be resubmitted or resumed");
    setMode(true, ctx);
    // SDK custom turns bypass before_agent_start. Initialize planning here and
    // carry saved content internally, without adding user input or an HTTP body.
    const content = beginPlanning(ctx, plan);
    pi.sendMessage({ customType: `${PLUGIN_ID}/recovery`, display: false, content,
      details: { action: 'resume', callId: plan.callId, planId: plan.planId, revision: plan.revision } }, { triggerTurn: true });
    return { started: true };
  };
  const registerActions = () => registerWebActions(pi, PLUGIN_ID, {
    "plan.command": (input, request) => {
      const ctx = sessionContext(request.sessionId);
      const args = (input as { args?: unknown })?.args;
      if (!Array.isArray(args) || args.some(value => typeof value !== "string")) throw new Error("Expected command arguments");
      const rawText = (input as { text?: unknown })?.text;
      const task = (typeof rawText === "string" ? rawText : args.join(" ")).trim();
      const value = task.toLowerCase();
      setMode(value !== "off", ctx);
      return { enabled: value !== "off", ...(task && value !== "on" && value !== "off" ? { message: task } : {}) };
    },
    "plan.setMode": (input, request) => {
      const ctx = sessionContext(request.sessionId);
      const value = (input as { enabled?: unknown })?.enabled;
      if (typeof value !== "boolean") throw new Error("Expected enabled boolean");
      setMode(value, ctx);
      return { enabled: value };
    },
    "plan.latest": (_input, request) => planDocuments(sessionContext(request.sessionId).sessionManager.getBranch()).at(-1) ?? null,
    "plan.runtime": (_input, request) => { sessionContext(request.sessionId); return { recoveryVersion: 2 }; },
    // Separate the new start-control contract from legacy message-producing builds.
    "plan.recover": recoverPlan,
    "plan.resubmit": recoverPlan,
  });
}
