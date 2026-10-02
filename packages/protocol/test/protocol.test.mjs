import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_REQUEST, defineWebPlugin, invokeWebAction, isPiWebManifest, registerWebActions } from "../dist/index.js";

function bus() {
  const listeners = new Map();
  return {
    on(channel, handler) {
      const set = listeners.get(channel) ?? new Set();
      set.add(handler); listeners.set(channel, set);
      return () => set.delete(handler);
    },
    emit(channel, data) { for (const handler of listeners.get(channel) ?? []) handler(data); },
  };
}

test("manifest accepts only versioned dist assets", () => {
  assert.equal(isPiWebManifest({ apiVersion: 1, client: "./dist/client.js", style: "./dist/client.css" }), true);
  assert.equal(isPiWebManifest({ apiVersion: 2, client: "./dist/client.js" }), false);
  assert.equal(isPiWebManifest({ apiVersion: 1, client: "../secret.js" }), false);
  assert.equal(isPiWebManifest({ apiVersion: 1, client: "./dist/../secret.js" }), false);
});

test("action request resolves, rejects, and times out", async () => {
  const events = bus();
  registerWebActions({ events }, "example", { echo: (input) => input, fail: () => { throw new Error("bad"); } });
  const request = (action, requestId) => ({ requestId, pluginId: "example", action, sessionId: "s1" });
  assert.deepEqual(await invokeWebAction(events, { ...request("echo", "1"), input: { ok: true } }), { ok: true });
  await assert.rejects(invokeWebAction(events, request("fail", "2")), /bad/);
  await assert.rejects(invokeWebAction(bus(), request("missing", "3"), 5), /timed out/);
  events.emit(ACTION_REQUEST, request("echo", "unobserved"));
});

test("definition retains declarative contributions", () => {
  const definition = { id: "example", apiVersion: 1, activate() {}, commands: [{ id: "x", title: "X", action: "echo" }] };
  assert.equal(defineWebPlugin(definition), definition);
});

test("unregistering actions suppresses late responses without cancelling the handler", async () => {
  const events = bus();
  let finish;
  let completed = false;
  let responses = 0;
  events.on("pi-webapp:action-response:v1", () => responses++);
  const off = registerWebActions({ events }, "example", { delayed: async () => {
    await new Promise(resolve => { finish = resolve; }); completed = true; return "done";
  } });
  const controller = new AbortController();
  const action = invokeWebAction(events, { requestId: "pending", pluginId: "example", action: "delayed", sessionId: "s" }, 100, controller.signal);
  const rejected = assert.rejects(action, /runtime unloaded/);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(); off(); off(); finish();
  await rejected; await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, true); assert.equal(responses, 0);
});

test("interaction waits for a human, rejects a stale session and settles once", async () => {
  const { WebInteractionHost, requestWebInteraction } = await import("../dist/index.js");
  const events = bus();
  let sessionId = "s1";
  let changes = 0;
  const host = new WebInteractionHost(events, (request) => request.sessionId === sessionId && request.pluginId === "example", () => changes++);
  const request = { requestId: "review-1", sessionId, pluginId: "example", kind: "review", data: { title: "Plan" } };
  let settled = false;
  const result = requestWebInteraction(events, request, undefined, 5).then((value) => { settled = true; return value; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, false); // The ack deadline must not time out a human.
  assert.deepEqual(host.pending("s1"), [request]);
  assert.throws(() => host.resolve("s2", "example", request.requestId, {}), /expired/);
  assert.throws(() => host.resolve("s1", "other", request.requestId, {}), /expired/);
  host.resolve("s1", "example", request.requestId, { decision: "approve" });
  assert.deepEqual(await result, { decision: "approve" });
  assert.deepEqual(host.pending("s1"), []);
  assert.throws(() => host.resolve("s1", "example", request.requestId, {}), /expired/);
  const second = requestWebInteraction(events, { ...request, requestId: "review-2" });
  sessionId = "s2";
  assert.throws(() => host.resolve("s1", "example", "review-2", {}), /expired/);
  host.cancelAll();
  await assert.rejects(second, /Session changed/);
  host.dispose();
  assert.ok(changes >= 4);
});

test("aborting or unloading an interaction cleans pending requests", async () => {
  const { WebInteractionHost, requestWebInteraction, WebInteractionUnavailable } = await import("../dist/index.js");
  const events = bus();
  const request = { requestId: "review", sessionId: "s1", pluginId: "example", kind: "review", data: {} };
  await assert.rejects(requestWebInteraction(events, request, undefined, 5), WebInteractionUnavailable);
  const host = new WebInteractionHost(events, () => true, () => {});
  const abort = new AbortController();
  const first = requestWebInteraction(events, request, abort.signal);
  abort.abort();
  await assert.rejects(first, /cancelled/);
  assert.deepEqual(host.pending("s1"), []);
  const second = requestWebInteraction(events, request);
  host.dispose();
  await assert.rejects(second, /unloaded/);
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(requestWebInteraction(events, request, alreadyAborted.signal), /cancelled/);
});


test("command presentation validates localized tokens and keeps legacy declarations valid", async () => {
  const { isWebCommandContribution } = await import("../dist/index.js");
  const old = { id: "plan", title: "Plan mode", action: "plan.command" };
  assert.equal(isWebCommandContribution(old), true);
  const input = { token: { zh: "计划", en: "plan" }, hint: { zh: "描述你的任务以生成计划", en: "Describe your task to generate a plan" }, attachments: true };
  const presentation = { label: { zh: "计划", en: "Plan" }, section: "add", icon: () => null };
  assert.equal(isWebCommandContribution({ ...old, input, presentation }), true);
  assert.equal(isWebCommandContribution({ ...old, input: { ...input, token: "plan off" } }), false);
  assert.equal(isWebCommandContribution({ ...old, input: { ...input, token: "/plan" } }), false);
  assert.equal(isWebCommandContribution({ ...old, input: { hint: { zh: "计划" } } }), false);
  assert.equal(isWebCommandContribution({ ...old, presentation: { ...presentation, section: "unknown" } }), false);
});
