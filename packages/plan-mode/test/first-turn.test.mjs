import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, createEventBus, DefaultResourceLoader, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { invokeWebAction, WebInteractionHost } from "@chengzhiyi/pi-web-protocol";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginId = "@chengzhiyi/pi-plan-mode";
const questions = [{ id: "audience", question: "优先服务哪类用户？", options: [
  { label: "仅移动端", description: "优先验证移动使用场景。" },
  { label: "桌面和移动端", description: "同时覆盖两类终端。" },
], recommended: 0 }];
const ask = { id: "question-call", name: "ask_user", arguments: { questions } };
const submit = { id: "first-plan", name: "submit_plan", arguments: { title: "首轮计划", markdown: "# 计划\n\n根据已确认的用户选择制定实施步骤。" } };

// Only the provider is deterministic. SDK request scheduling, tool permission
// checks, session persistence, interaction acknowledgements and settlement are real.
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-first-plan-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  let session;
  let host;
  t.after(async () => {
    host?.dispose();
    await session?.abort();
    session?.dispose();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(root, { recursive: true, force: true });
  });
  const bus = createEventBus();
  const loader = new DefaultResourceLoader({ cwd, agentDir, noExtensions: true, additionalExtensionPaths: [packageRoot], eventBus: bus });
  await loader.reload();
  const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  const model = runtime.getModels("openai")[0];
  assert.ok(model);
  await runtime.setRuntimeApiKey("openai", "first-plan-test-no-network");
  session = (await createAgentSession({ cwd, agentDir, model, modelRuntime: runtime, resourceLoader: loader, sessionManager: SessionManager.create(cwd) })).session;
  session.settingsManager.setRetryEnabled(false);
  let abortCount = 0;
  await session.bindExtensions({ mode: "print", shutdownHandler: () => {}, abortHandler: () => { abortCount++; void session.abort(); } });
  host = new WebInteractionHost(bus, () => true, () => {});
  const action = (name, input) => invokeWebAction(bus, { pluginId, action: name, input, sessionId: session.sessionManager.getSessionId(), requestId: crypto.randomUUID() });
  const entries = (suffix) => session.sessionManager.getBranch().filter(entry => entry.type === "custom" && entry.customType === `${pluginId}/${suffix}`).map(entry => entry.data);
  const nextInteraction = () => new Promise(resolve => {
    const off = bus.on("pi-webapp:interaction-open:v1", value => { off(); resolve(value); });
    t.after(off);
  });
  const resolveInteraction = (request, value) => host.resolve(request.sessionId, request.pluginId, request.requestId, value);
  let providerCalls = 0;
  const requests = [];
  const script = (responses) => {
    session.agent.streamFunction = async (currentModel, context) => {
      requests.push(context);
      const response = responses[providerCalls++] ?? { text: "Done." };
      const call = response.name ? response : null;
      const message = { role: "assistant", api: currentModel.api, provider: currentModel.provider, model: currentModel.id,
        content: call ? [{ type: "toolCall", ...call }] : [{ type: "text", text: response.text ?? "Interrupted." }],
        stopReason: response.stopReason ?? (call ? "toolUse" : "stop"), errorMessage: response.errorMessage, timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      return { async *[Symbol.asyncIterator]() { yield { type: message.stopReason === "error" || message.stopReason === "aborted" ? "error" : "done", reason: message.stopReason, error: message, message }; }, result: async () => message };
    };
  };
  const startTask = async () => {
    const task = "制定用户登录页的实施计划";
    const command = await action("plan.command", { args: [task], text: task });
    assert.deepEqual(command, { enabled: true, message: task });
    const running = session.prompt(command.message);
    running.catch(() => {});
    return { running };
  };
  const readonly = async () => {
    assert.ok(!session.getActiveToolNames().includes("write"));
    const result = await session.extensionRunner.emitToolCall({ type: "tool_call", toolName: "write", toolCallId: "blocked-write", input: { path: "blocked.txt", content: "blocked" } });
    assert.equal(result?.block, true);
  };
  return { session, host, action, entries, nextInteraction, resolveInteraction, script, startTask, readonly, calls: () => providerCalls, requests, abortCount: () => abortCount };
}

test("first plan command continues a plain-text first answer into a real approval in the same request", async (t) => {
  const f = await fixture(t);
  f.script([{ text: "需要确认使用场景，我会继续整理计划。" }, submit]);
  const opened = f.nextInteraction();
  const { running } = await f.startTask();
  const review = await Promise.race([opened, running.then(() => null)]);
  assert.ok(review, "the first request must not settle with plain text and require a second user message");
  assert.equal(review.kind, "plan.review");
  assert.equal(f.calls(), 2);
  assert.equal(f.session.isIdle, false);
  const users = f.session.sessionManager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "user");
  assert.equal(users.length, 1);
  await f.readonly();
  f.resolveInteraction(review, { decision: "cancel" });
  await running;
  assert.equal(f.session.isIdle, true);
});

test("first-turn ask_user choices persist answers and continue read-only into submit_plan", async (t) => {
  const f = await fixture(t);
  f.script([ask, submit]);
  const opened = f.nextInteraction();
  const { running } = await f.startTask();
  const request = await Promise.race([opened, running.then(() => null)]);
  assert.equal(request?.kind, "plan.questions", "clarifications must expose choices instead of normal chat text");
  assert.deepEqual(request.data.questions, questions);
  assert.deepEqual(f.entries("questions").at(-1).questions, questions);
  await f.readonly();
  const reviewOpened = f.nextInteraction();
  f.resolveInteraction(request, { decision: "answer", answers: [{ id: "audience", value: "仅移动端" }] });
  const review = await reviewOpened;
  assert.equal(review.kind, "plan.review");
  assert.equal(f.calls(), 2);
  assert.deepEqual(f.entries("answers").at(-1).answers, [{ id: "audience", value: "仅移动端" }]);
  assert.ok(JSON.stringify(f.requests[1]).includes("仅移动端"));
  assert.equal(f.session.isIdle, false);
  await f.readonly();
  f.resolveInteraction(review, { decision: "cancel" });
  await running;
});

test("ask_user is an active sequential read-only tool", async (t) => {
  const f = await fixture(t);
  await f.action("plan.setMode", { enabled: true });
  assert.ok(f.session.getActiveToolNames().includes("ask_user"));
  assert.equal(f.session.extensionRunner.getToolDefinition("ask_user").executionMode, "sequential");
  const allowed = await f.session.extensionRunner.emitToolCall({ type: "tool_call", toolName: "ask_user", toolCallId: "permission", input: { questions } });
  assert.notEqual(allowed?.block, true);
  await f.readonly();
});

test("cancelling first-turn questions records cancellation and stops without an automatic next provider call", async (t) => {
  const f = await fixture(t);
  f.script([ask, submit]);
  const opened = f.nextInteraction();
  const { running } = await f.startTask();
  const request = await Promise.race([opened, running.then(() => null)]);
  assert.equal(request?.kind, "plan.questions");
  f.resolveInteraction(request, { decision: "cancel" });
  await running;
  assert.equal(f.calls(), 1);
  assert.equal(f.entries("answers").at(-1).decision, "cancel");
  assert.equal(f.abortCount(), 1);
  assert.deepEqual(f.host.pending(request.sessionId), []);
  assert.deepEqual(f.entries("plan"), []);
  await f.readonly();
});

test("late question answers after a session change cannot reach the new branch", async (t) => {
  const f = await fixture(t);
  await f.action("plan.setMode", { enabled: true });
  const tool = f.session.agent.state.tools.find(value => value.name === "ask_user");
  assert.ok(tool, "ask_user must exist before testing stale answers");
  const opened = f.nextInteraction();
  const executing = tool.execute("stale-questions", { questions }, new AbortController().signal, () => {});
  executing.catch(() => {});
  const request = await opened;
  f.session.sessionManager.newSession();
  await f.session.extensionRunner.emit({ type: "session_start", reason: "new" });
  f.resolveInteraction(request, { decision: "answer", answers: [{ id: "audience", value: "仅移动端" }] });
  const result = await executing.then(value => value, error => ({ error, isError: true }));
  assert.ok(result.isError || result.terminate);
  assert.deepEqual(f.entries("answers"), []);
  assert.deepEqual(f.entries("questions"), []);
});

test("question responses are accepted once, preserving a single answer record", async (t) => {
  const f = await fixture(t);
  await f.action("plan.setMode", { enabled: true });
  const tool = f.session.agent.state.tools.find(value => value.name === "ask_user");
  assert.ok(tool);
  const opened = f.nextInteraction();
  const executing = tool.execute("once-questions", { questions }, new AbortController().signal, () => {});
  const request = await opened;
  const answer = { decision: "answer", answers: [{ id: "audience", value: "仅移动端" }] };
  f.resolveInteraction(request, answer);
  await executing;
  assert.throws(() => f.resolveInteraction(request, answer), /expired|changed/);
  assert.equal(f.entries("answers").length, 1);
  await f.readonly();
});

for (const stopReason of ["error", "aborted"]) {
  test(`first-turn ${stopReason} terminal answer settles without forced planning continuation`, async (t) => {
    const f = await fixture(t);
    f.script([{ text: "Provider stopped.", stopReason, errorMessage: "Deterministic terminal failure" }, submit]);
    const { running } = await f.startTask();
    await running;
    assert.equal(f.calls(), 1, "abnormal terminal states must not trigger an automatic planning loop");
    assert.equal(f.session.isIdle, true);
    assert.deepEqual(f.entries("plan"), []);
    await f.readonly();
  });
}

test("a provider that ignores submit_plan receives at most two continuations and an explicit unfinished notice", { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  f.script([{ text: "普通说明，继续闲聊。" }, { text: "普通说明，继续闲聊。" }, { text: "普通说明，继续闲聊。" }]);
  const { running } = await f.startTask();
  await running;
  assert.equal(f.calls(), 3, "one initial call plus at most two same-request continuations");
  assert.equal(f.session.isIdle, true);
  assert.deepEqual(f.entries("plan"), []);
  const history = [...f.session.agent.state.messages, ...f.session.sessionManager.getBranch()];
  assert.match(JSON.stringify(history), /未.{0,12}提交|not.{0,12}submitted|could not.{0,12}plan|cannot.{0,12}plan/i,
    "exhausting continuations must tell the user that no plan was submitted");
  await f.readonly();
});
