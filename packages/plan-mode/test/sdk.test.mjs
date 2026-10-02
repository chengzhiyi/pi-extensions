import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, createEventBus, DefaultResourceLoader, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { invokeWebAction, WebInteractionHost } from "@chengzhiyi/pi-web-protocol";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginId = "@chengzhiyi/pi-plan-mode";
const stateKind = `${pluginId}/state`;
const planKind = `${pluginId}/plan`;
const reviewKind = `${pluginId}/review`;

// Real SDK loading, event dispatch, session entries, and interaction host. Only the
// model call is omitted: tools are executed directly to make approval deterministic.
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-plan-sdk-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  let session;
  let host;
  t.after(async () => {
    host?.dispose();
    session?.dispose();
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(cwd);
  const eventBus = createEventBus();
  const loader = new DefaultResourceLoader({ cwd, agentDir, noExtensions: true, additionalExtensionPaths: [packageRoot], eventBus });
  await loader.reload();
  let modelRuntime;
  let model;
  if (options.realAgent) {
    modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
    model = modelRuntime.getModels("openai")[0];
    assert.ok(model, "static SDK model catalog must provide an OpenAI model");
    await modelRuntime.setRuntimeApiKey("openai", "sdk-test-no-network");
  }
  session = (await createAgentSession({ cwd, agentDir, modelRuntime, model, sessionManager: SessionManager.create(cwd), resourceLoader: loader })).session;
  let aborted = 0;
  await session.bindExtensions({ mode: "print", shutdownHandler: () => {}, abortHandler: () => { aborted++; if (options.realAgent) void session.abort(); } });
  const baseline = session.getActiveToolNames();
  assert.ok(baseline.includes("bash"));
  const action = (name, input) => invokeWebAction(eventBus, { requestId: crypto.randomUUID(), pluginId, sessionId: session.sessionManager.getSessionId(), action: name, input });
  const entries = (kind) => session.sessionManager.getBranch().filter((entry) => entry.type === "custom" && entry.customType === kind).map((entry) => entry.data);
  const enabled = () => entries(stateKind).at(-1)?.enabled ?? false;
  const tool = () => session.agent.state.tools.find((value) => value.name === "submit_plan");
  await action("plan.setMode", { enabled: true });
  const readonly = async () => {
    assert.ok(!session.getActiveToolNames().includes("bash"));
    assert.ok(session.getActiveToolNames().includes("submit_plan"));
    const blocked = await session.extensionRunner.emitToolCall({ type: "tool_call", toolName: "write", toolCallId: "probe-write", input: { path: "test.txt", content: "blocked" } });
    assert.equal(blocked?.block, true);
  };
  let opened;
  // Accept old session IDs too so stale-response tests exercise plugin validation,
  // rather than obtaining a false pass from the host's own session guard.
  host = new WebInteractionHost(eventBus, () => true, () => opened?.());
  const beginReview = async (callId, markdown = "# Plan\n\nFirst review, then implement.", title = "Waiting for approval") => {
    const ready = new Promise((resolve) => { opened = resolve; });
    const controller = new AbortController();
    const executing = tool().execute(callId, { title, markdown }, controller.signal, () => {});
    // Attach rejection immediately; late-session tests intentionally reject tools.
    executing.catch(() => {});
    await ready;
    const [pending] = host.pending(session.sessionManager.getSessionId());
    assert.ok(pending);
    return { executing, pending, controller, settle: (value) => host.resolve(pending.sessionId, pending.pluginId, pending.requestId, value) };
  };
  const review = async (callId, value, markdown, title) => {
    const pending = await beginReview(callId, markdown, title);
    pending.settle(value);
    return pending.executing;
  };
  const waitForReview = (callId) => new Promise((resolve) => {
    const detach = eventBus.on("pi-webapp:interaction-open:v1", (value) => {
      if (value?.data?.callId !== callId) return;
      detach();
      resolve(value);
    });
    t.after(detach);
  });
  return { session, host, eventBus, action, baseline, entries, enabled, readonly, tool, beginReview, review, waitForReview, cwd, aborted: () => aborted };
}

// These tool-level tests omit model scheduling. Capture the SDK custom-turn
// boundary; the real scheduling and persistence are covered below end to end.
async function captureRecovery(f, callId) {
  const original = f.session.sendCustomMessage;
  let control;
  f.session.sendCustomMessage = async message => { control = message; };
  try { assert.deepEqual(await f.action("plan.resubmit", { callId }), { started: true }); }
  finally { f.session.sendCustomMessage = original; }
  assert.equal(control?.display, false);
  assert.equal(control?.customType, `${pluginId}/recovery`);
  return control;
}

test("SDK approval grants this version temporary tools, retaining plan mode until settlement", async (t) => {
  const f = await fixture(t);
  const task = "设计  用户登录\n保留错误日志";
  assert.deepEqual(await f.action("plan.command", { args: task.split(/\s+/), text: task }), { enabled: true, message: task });
  await f.readonly();
  const approved = await f.review("approved", { decision: "approve" });
  assert.notEqual(approved.terminate, true);
  assert.match(approved.content[0].text, /Continue implementing/);
  assert.deepEqual(f.session.getActiveToolNames(), f.baseline);
  assert.equal(f.enabled(), true, "approval must not persistently disable planning");
  const permission = await f.session.extensionRunner.emitToolCall({ type: "tool_call", toolName: "write", toolCallId: "approved-write", input: { path: "approved.txt", content: "approved" } });
  assert.notEqual(permission?.block, true);
  // Agent end may be followed by automatic retry: grant must survive until settled.
  await f.session.extensionRunner.emit({ type: "agent_end", messages: [] });
  assert.deepEqual(f.session.getActiveToolNames(), f.baseline);
  await f.session.extensionRunner.emit({ type: "agent_settled" });
  await f.readonly();
  assert.equal(f.enabled(), true);
});

test("SDK feedback continues read-only and next submission shares plan identity with incremented version", async (t) => {
  const f = await fixture(t);
  const discussed = await f.review("version-1", { decision: "discuss", feedback: "  增加回滚步骤  " });
  assert.notEqual(discussed.terminate, true, "feedback must revise within the current request");
  assert.match(discussed.content[0].text, /增加回滚步骤/);
  await f.readonly();
  const first = f.entries(planKind).at(-1);
  const decision = f.entries(reviewKind).at(-1);
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.revision, 1);
  assert.equal(typeof first.planId, "string");
  assert.equal(decision.feedback, "增加回滚步骤");
  await f.review("version-2", { decision: "discuss" }, "# Revised plan\n\nAdd rollback.");
  const second = f.entries(planKind).at(-1);
  assert.equal(second.planId, first.planId);
  assert.equal(second.revision, 2);
  assert.equal(f.entries(reviewKind).at(-1).revision, 2);
});

test("SDK legacy discuss pauses for the next message and preserves read-only mode", async (t) => {
  const f = await fixture(t);
  const discussed = await f.review("legacy-discuss", { decision: "discuss" });
  assert.equal(discussed.terminate, true);
  assert.match(discussed.content[0].text, /wait for their next message/);
  assert.equal(f.entries(reviewKind).at(-1).decision, "discuss");
  await f.readonly();
});

test("SDK cancellation records an independent decision, aborts, and leaves no approval", async (t) => {
  const f = await fixture(t);
  const cancelled = await f.review("cancelled", { decision: "cancel" });
  assert.equal(cancelled.terminate, true);
  assert.equal(f.entries(reviewKind).at(-1).decision, "cancel");
  assert.equal(f.aborted(), 1, "cancel must use the SDK abort boundary");
  assert.deepEqual(f.host.pending(f.session.sessionManager.getSessionId()), []);
  assert.equal(f.enabled(), true);
  await f.readonly();
});

test("SDK reload revokes temporary authorization and restores the action bus", async (t) => {
  const f = await fixture(t);
  await f.review("approved-before-reload", { decision: "approve" });
  assert.deepEqual(f.session.getActiveToolNames(), f.baseline);
  await f.session.reload();
  assert.equal(f.enabled(), true);
  await f.readonly();
  assert.deepEqual(await f.action("plan.setMode", { enabled: false }), { enabled: false });
  assert.deepEqual(f.session.getActiveToolNames(), f.baseline);
});

test("SDK switching sessions never transfers a temporary execution grant", async (t) => {
  const f = await fixture(t);
  await f.review("approved-before-switch", { decision: "approve" });
  f.session.sessionManager.newSession();
  await f.session.extensionRunner.emit({ type: "session_start", reason: "new" });
  assert.equal(f.enabled(), false);
  assert.deepEqual(f.session.getActiveToolNames(), f.baseline);
  await f.action("plan.setMode", { enabled: true });
  await f.readonly();
});

test("SDK late approval after session replacement cannot grant tools or append a review", async (t) => {
  const f = await fixture(t);
  const pending = await f.beginReview("stale-review");
  f.session.sessionManager.newSession();
  await f.session.extensionRunner.emit({ type: "session_start", reason: "new" });
  await f.action("plan.setMode", { enabled: true });
  pending.settle({ decision: "approve" });
  const outcome = await pending.executing.then((result) => result, (error) => ({ isError: true, error }));
  assert.ok(outcome.isError || outcome.terminate, "stale approval must stop without authorization");
  assert.deepEqual(f.entries(reviewKind), []);
  await f.readonly();
});

test("SDK interrupted plans resubmit only while idle and without restoring old authorization", async (t) => {
  const f = await fixture(t);
  const markdown = "# Recover\n\n完整原文：first read, then write.";
  const pending = await f.beginReview("interrupted", markdown, "Recovery title");
  pending.controller.abort();
  await assert.rejects(pending.executing, /cancel|abort|interrupt/i);
  assert.deepEqual(f.host.pending(f.session.sessionManager.getSessionId()), []);
  const latest = await f.action("plan.latest", {});
  assert.equal(latest.callId, "interrupted");
  Object.defineProperty(f.session, "isIdle", { configurable: true, value: false });
  await assert.rejects(f.action("plan.resubmit", { callId: latest.callId }), /finish|idle|running/i);
  delete f.session.isIdle;
  const resubmit = await captureRecovery(f, latest.callId);
  assert.ok(resubmit.content.includes(markdown));
  assert.ok(resubmit.content.includes("Recovery title"));
  await f.readonly();
  // Resubmission is a new real submit/review, so approval cannot be reused.
  const resubmitted = await f.beginReview("recovered", markdown, "Recovery title");
  assert.equal(resubmitted.pending.data.planId, latest.planId);
  assert.equal(resubmitted.pending.data.revision, latest.revision + 1);
  assert.notEqual(resubmitted.pending.requestId, pending.pending.requestId);
  resubmitted.settle({ decision: "approve" });
  await resubmitted.executing;
  await assert.rejects(f.action("plan.resubmit", { callId: "recovered" }), /interrupt|approved|eligible|resubmit/i);
});

test("SDK old plan records map to first versions without manufacturing live approvals", async (t) => {
  const f = await fixture(t);
  f.session.sessionManager.appendCustomEntry(planKind, { callId: "old-plan", title: "Legacy", markdown: "# Legacy plan" });
  const latest = await f.action("plan.latest", {});
  assert.equal(latest.planId, "old-plan");
  assert.equal(latest.revision, 1);
  assert.equal(latest.title, "Legacy");
  assert.deepEqual(f.host.pending(f.session.sessionManager.getSessionId()), []);
  const recovery = await captureRecovery(f, "old-plan");
  assert.ok(recovery.content.includes("Legacy"));
  await f.readonly();
  f.session.sessionManager.appendCustomEntry(reviewKind, { callId: "old-plan", decision: "approve" });
  await assert.rejects(f.action("plan.resubmit", { callId: "old-plan" }), /interrupt|approved|eligible|resubmit/i);
});

test("SDK submit_plan registers serial execution and duplicate approval is rejected", async (t) => {
  const f = await fixture(t);
  assert.equal(f.session.extensionRunner.getToolDefinition("submit_plan").executionMode, "sequential");
  const review = await f.beginReview("once-only");
  review.settle({ decision: "approve" });
  await review.executing;
  assert.throws(() => review.settle({ decision: "approve" }), /expired|changed/);
  assert.equal(f.entries(reviewKind).filter((entry) => entry.callId === "once-only").length, 1);
});

for (const stopReason of ["error", "aborted"]) {
  test(`SDK ${stopReason} execution revokes approval and records the terminal outcome`, async (t) => {
    const f = await fixture(t);
    await f.review(`execution-${stopReason}`, { decision: "approve" });
    await f.session.extensionRunner.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason, content: [], timestamp: Date.now() }] });
    await f.session.extensionRunner.emit({ type: "agent_settled" });
    await f.readonly();
    const execution = f.entries(`${pluginId}/execution`).at(-1);
    assert.equal(execution.callId, `execution-${stopReason}`);
    assert.equal(execution.outcome, stopReason);
    assert.equal(f.enabled(), true);
  });
}

test("SDK headless submission stops for review and remains recoverable without authorization", async (t) => {
  const f = await fixture(t);
  f.host.dispose();
  const result = await f.tool().execute("headless", { title: "Offline review", markdown: "# Plan\n\nDo not implement yet." }, new AbortController().signal, () => {});
  assert.equal(result.terminate, true);
  assert.match(result.content[0].text, /wait|review/i);
  assert.deepEqual(f.entries(reviewKind), []);
  await f.readonly();
  const recovery = await captureRecovery(f, "headless");
  assert.match(recovery.content, /Resubmit/);
});

test("SDK agent run revises, awaits approval, writes the approved file, and settles back to read-only", async (t) => {
  const f = await fixture(t, { realAgent: true });
  const target = join(f.cwd, "approved.txt");
  const content = "Only the approved revision may write this file.\n";
  const script = [
    { id: "live-v1", name: "submit_plan", arguments: { title: "Write a reviewed file", markdown: "# Plan\n\nWrite approved.txt after approval." } },
    { id: "live-v2", name: "submit_plan", arguments: { title: "Write a reviewed file with rollback", markdown: "# Revised plan\n\nWrite approved.txt after approval. Rollback: remove the file." } },
    { id: "live-write", name: "write", arguments: { path: target, content } },
  ];
  let providerCalls = 0;
  // Deterministic provider boundary only; all SDK turn scheduling and built-in
  // file mutation tools below are real implementations in the temporary workspace.
  f.session.agent.streamFunction = async (model) => {
    const call = script[providerCalls++];
    const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: call ? [{ type: "toolCall", ...call }] : [{ type: "text", text: "The approved file is written." }],
      stopReason: call ? "toolUse" : "stop", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    return { async *[Symbol.asyncIterator]() { yield { type: "done", reason: message.stopReason, message }; }, result: async () => message };
  };
  const firstReady = f.waitForReview("live-v1");
  const running = f.session.prompt("Plan the file write, incorporate feedback, and execute only after approval.");
  running.catch(() => {});
  const first = await firstReady;
  await assert.rejects(access(target), { code: "ENOENT" });
  const secondReady = f.waitForReview("live-v2");
  f.host.resolve(first.sessionId, first.pluginId, first.requestId, { decision: "discuss", feedback: "Add rollback." });
  const second = await secondReady;
  assert.equal(second.data.planId, first.data.planId);
  assert.equal(second.data.revision, 2);
  await assert.rejects(access(target), { code: "ENOENT" });
  assert.equal(f.session.isIdle, false);
  f.host.resolve(second.sessionId, second.pluginId, second.requestId, { decision: "approve" });
  await running;
  assert.equal(await readFile(target, "utf8"), content);
  assert.equal(providerCalls, 4);
  assert.equal(f.session.isIdle, true);
  assert.equal(f.enabled(), true);
  await f.readonly();
  assert.equal(f.entries(`${pluginId}/execution`).at(-1).outcome, "completed");
});

test("SDK automatic retry retains approved tools until the real request settles", async (t) => {
  const f = await fixture(t, { realAgent: true });
  f.session.settingsManager.getRetrySettings = () => ({ enabled: true, maxRetries: 2, baseDelayMs: 1, maxAgentDelayMs: 1 });
  const target = join(f.cwd, "retry-approved.txt");
  let calls = 0; let retries = 0;
  f.session.subscribe(event => {
    if (event.type !== "auto_retry_start") return;
    retries++;
    assert.deepEqual(f.session.getActiveToolNames(), f.baseline);
    assert.equal(f.entries(`${pluginId}/execution`).at(-1).outcome, "started");
  });
  f.session.agent.streamFunction = async (model) => {
    const step = calls++;
    const call = step === 0 ? { id: "retry-plan", name: "submit_plan", arguments: { title: "Retry test", markdown: "Write retry-approved.txt after approval." } }
      : step === 2 ? { id: "retry-write", name: "write", arguments: { path: target, content: "approved after retry" } } : null;
    const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: call ? [{ type: "toolCall", ...call }] : [{ type: "text", text: "done" }],
      stopReason: step === 1 ? "error" : call ? "toolUse" : "stop",
      ...(step === 1 ? { errorMessage: "429 Too Many Requests" } : {}), timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    return { async *[Symbol.asyncIterator]() { yield { type: "done", reason: message.stopReason, message }; }, result: async () => message };
  };
  const ready = f.waitForReview("retry-plan");
  const run = f.session.prompt("Plan and execute a write after approval."); run.catch(() => {});
  const pending = await ready;
  f.host.resolve(pending.sessionId, pending.pluginId, pending.requestId, { decision: "approve" });
  await run;
  assert.equal(retries, 1);
  assert.equal(await readFile(target, "utf8"), "approved after retry");
  assert.equal(f.entries(`${pluginId}/execution`).at(-1).outcome, "completed");
  await f.readonly();
});

test("SDK recovery carries large saved content internally and a different task resets its revision base", async (t) => {
  const f = await fixture(t);
  const markdown = "完整计划".repeat(20000);
  const pending = await f.beginReview("large-plan", markdown, "Large plan");
  pending.controller.abort(); await assert.rejects(pending.executing);
  const recovery = await captureRecovery(f, "large-plan");
  assert.ok(recovery.content.includes(markdown));
  const other = await f.session.extensionRunner.emitBeforeAgentStart("A different task", undefined, { cwd: f.cwd });
  assert.ok(other.messages.every(message => !message.content.includes(markdown)));
  const newPlan = await f.beginReview("different-task");
  assert.notEqual(newPlan.pending.data.planId, pending.pending.data.planId);
  assert.equal(newPlan.pending.data.revision, 1);
  newPlan.settle({ decision: "cancel" }); await newPlan.executing;
});

test("SDK branch navigation revokes an approved version even within the same session", async (t) => {
  const f = await fixture(t);
  await f.review("tree-approved", { decision: "approve" });
  assert.deepEqual(f.session.getActiveToolNames(), f.baseline);
  await f.session.extensionRunner.emit({ type: "session_tree", newLeafId: f.session.sessionManager.getLeafId(), oldLeafId: null });
  await f.readonly();
  assert.equal(f.entries(`${pluginId}/execution`).at(-1).outcome, "interrupted");
});

test("SDK cancellation aborts an actual request before a later tool in the same batch", async (t) => {
  const f = await fixture(t, { realAgent: true });
  const target = join(f.cwd, "must-not-write.txt");
  let calls = 0;
  f.session.agent.streamFunction = async model => {
    calls++;
    const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: [
        { type: "toolCall", id: "batch-plan", name: "submit_plan", arguments: { title: "Batch cancellation", markdown: "Do not write until approved." } },
        { type: "toolCall", id: "batch-write", name: "write", arguments: { path: target, content: "must never execute" } },
      ], stopReason: "toolUse", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    return { async *[Symbol.asyncIterator]() { yield { type: "done", reason: message.stopReason, message }; }, result: async () => message };
  };
  const ready = f.waitForReview("batch-plan");
  const run = f.session.prompt("Plan and await a decision."); run.catch(() => {});
  const pending = await ready;
  f.host.resolve(pending.sessionId, pending.pluginId, pending.requestId, { decision: "cancel" });
  await run;
  assert.equal(calls, 1);
  assert.equal(f.aborted(), 1);
  assert.equal(f.session.isIdle, true);
  assert.equal(f.entries(reviewKind).at(-1).decision, "cancel");
  assert.deepEqual(f.host.pending(pending.sessionId), []);
  await assert.rejects(access(target), { code: "ENOENT" });
  await f.readonly();
});

for (const outcome of ["aborted", "error", "interrupted"]) {
  test(`SDK ${outcome} approved execution can resume only through a fresh reviewed version`, async (t) => {
    const f = await fixture(t);
    const markdown = "# Approved steps\n\n1. Inspect current progress.\n2. Write only remaining changes.\n3. Verify the result.";
    await f.review("resume-original", { decision: "approve" }, markdown, "Recover interrupted implementation");
    const original = f.entries(planKind).at(-1);
    if (outcome === "interrupted") {
      await f.session.reload();
    } else {
      await f.session.extensionRunner.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: outcome, content: [], timestamp: Date.now() }] });
      await f.session.extensionRunner.emit({ type: "agent_settled" });
    }
    assert.equal(f.entries(`${pluginId}/execution`).at(-1).outcome, outcome);
    await f.readonly();
    Object.defineProperty(f.session, "isIdle", { configurable: true, value: false });
    await assert.rejects(f.action("plan.resubmit", { callId: original.callId }), /finish|idle|running/i);
    delete f.session.isIdle;
    const recovery = await captureRecovery(f, original.callId);
    await f.readonly();
    const guidance = recovery.content;
    assert.ok(guidance.includes(markdown), "recovery must carry the original approved plan");
    assert.match(guidance, /progress|进度/i, "recovery must ask the agent to inspect existing progress");
    assert.match(guidance, /unfinished|uncompleted|remaining|未完成|剩余/i, "recovery must limit implementation to unfinished work");
    const pending = await f.beginReview("resume-new-version", markdown, original.title);
    assert.equal(pending.pending.data.planId, original.planId);
    assert.equal(pending.pending.data.revision, original.revision + 1);
    assert.notEqual(pending.pending.data.callId, original.callId);
    await f.readonly();
    pending.settle({ decision: "approve" });
    await pending.executing;
    assert.deepEqual(f.session.getActiveToolNames(), f.baseline);
    assert.equal(f.entries(reviewKind).at(-1).callId, "resume-new-version");
    await f.session.extensionRunner.emit({ type: "agent_settled" });
    await f.readonly();
    await assert.rejects(f.action("plan.resubmit", { callId: original.callId }), /interrupt|approved|eligible|resubmit|resume/i,
      "a superseded version cannot resume again");
  });
}

test("SDK completed and cancelled plans reject resume rather than reusing prior approval", async (t) => {
  const f = await fixture(t);
  await f.review("finished-no-resume", { decision: "approve" });
  await f.session.extensionRunner.emit({ type: "agent_settled" });
  await assert.rejects(f.action("plan.resubmit", { callId: "finished-no-resume" }), /interrupt|approved|eligible|resubmit|resume/i);
  await f.review("cancelled-no-resume", { decision: "cancel" });
  await assert.rejects(f.action("plan.resubmit", { callId: "cancelled-no-resume" }), /interrupt|approved|eligible|resubmit|resume/i);
  await f.readonly();
});

test("SDK resume continues the original user turn through hidden control context and a fresh review", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, { realAgent: true });
  const markdown = "# Original plan\n\nPreserve completed work and write remaining.txt after review.";
  const target = join(f.cwd, "remaining.txt");
  let step = 0;
  let resumed = false;
  const contexts = [];
  f.session.agent.streamFunction = async (model, context) => {
    contexts.push(context);
    const call = step++ === 0 ? { id: resumed ? "hidden-resume-v2" : "hidden-resume-v1", name: "submit_plan", arguments: {
      title: "Continue remaining work", markdown,
    } } : resumed && step === 2 ? { id: "remaining-write", name: "write", arguments: { path: target, content: "done\n" } } : null;
    const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
      content: call ? [{ type: "toolCall", ...call }] : [{ type: "text", text: resumed ? "Finished remaining work" : "Partial progress" }],
      stopReason: call ? "toolUse" : resumed ? "stop" : "aborted", timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    return { async *[Symbol.asyncIterator]() { yield { type: call ? "done" : resumed ? "done" : "error", reason: message.stopReason, message, error: message }; }, result: async () => message };
  };
  const firstReady = f.waitForReview("hidden-resume-v1");
  const original = f.session.prompt("Complete the original task; preserve my confirmed choices.");
  original.catch(() => {});
  const first = await firstReady;
  f.host.resolve(first.sessionId, first.pluginId, first.requestId, { decision: "approve" });
  await original;
  assert.equal(f.entries(`${pluginId}/execution`).at(-1).outcome, "aborted");
  const users = () => f.session.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user");
  const before = users().map(entry => entry.id);
  assert.equal(before.length, 1);
  step = 0; resumed = true;
  assert.deepEqual(await f.action("plan.runtime", {}), { recoveryVersion: 2 });
  const nextReady = f.waitForReview("hidden-resume-v2");
  const result = await f.action("plan.recover", { callId: first.data.callId });
  assert.equal(result.message, undefined, "resume must not ask the UI to manufacture user input");
  const next = await nextReady;
  assert.equal(next.data.planId, first.data.planId);
  assert.equal(next.data.revision, 2);
  assert.deepEqual(users().map(entry => entry.id), before);
  const control = f.session.sessionManager.getBranch().find(entry => entry.type === "custom_message" && entry.customType === `${pluginId}/recovery`);
  assert.equal(control?.display, false);
  assert.ok(control?.content.includes(markdown));
  assert.match(control.content, /confirmed answers|confirmed choices/);
  assert.match(control.content, /remaining|unfinished/);
  assert.ok(JSON.stringify(contexts.at(-1).messages).includes("Complete the original task"));
  await f.readonly();
  await assert.rejects(access(target), { code: "ENOENT" });
  f.host.resolve(next.sessionId, next.pluginId, next.requestId, { decision: "approve" });
  await f.session.waitForIdle();
  assert.equal(await readFile(target, "utf8"), "done\n");
  assert.deepEqual(users().map(entry => entry.id), before);
  assert.equal(f.entries(`${pluginId}/execution`).at(-1).outcome, "completed");
  await f.readonly();
});


test("SDK repeated reload replaces action registrations and shutdown unsubscribes them", async t => {
  const f = await fixture(t);
  let responses = 0;
  const off = f.eventBus.on("pi-webapp:action-response:v1", () => responses++);
  t.after(off);
  for (let i = 0; i < 3; i++) {
    await f.session.reload();
    const before = responses;
    await f.action("plan.latest");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(responses - before, 1);
  }
  await f.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  const before = responses;
  f.eventBus.emit("pi-webapp:action:v1", { requestId: "after-shutdown", sessionId: f.session.sessionManager.getSessionId(), pluginId, action: "plan.latest" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(responses, before);
});
