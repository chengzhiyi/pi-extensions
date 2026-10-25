import test from "node:test";
import assert from "node:assert/strict";
import { MessageChannel } from "node:worker_threads";
import { DiagramModel } from "../src/client/model.ts";
import { connect, disconnect } from "../src/client/rpc.ts";
import { emptyScene, type DiagramDraft } from "../src/contract/diagrams.ts";

test("clean iframe observers follow sibling edits; dirty writers retain local changes and CAS rejects stale writes", async t => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage"), storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  const channel = new MessageChannel(); connect(channel.port1 as unknown as MessagePort, async () => null);
  let draft: DiagramDraft = { id: "drawing", title: "中文", revision: 0, scene: emptyScene(), candidate: null, path: null, savedRevision: null, diskHash: null };
  channel.port2.on("message", (message: any) => {
    const { action, input } = message.input;
    if (action === "sync") {
      if (input.revision !== draft.revision) return channel.port2.postMessage({ type: "response", id: message.id, ok: false, error: { status: 409, code: "revision_conflict", message: "Revision conflict" } });
      draft = { ...draft, revision: draft.revision + 1, scene: input.scene };
    }
    channel.port2.postMessage({ type: "response", id: message.id, ok: true, value: draft });
  });
  const editor = new DiagramModel("session", "drawing"), preview = new DiagramModel("session", "drawing");
  t.after(() => { editor.dispose(); preview.dispose(); disconnect(); channel.port2.close(); if (old) Object.defineProperty(globalThis, "localStorage", old); else Reflect.deleteProperty(globalThis, "localStorage"); });
  await editor.refresh(); await preview.refresh();
  const scene = (x: number) => ({ ...emptyScene(), elements: [{ id: "box", type: "rectangle", x, y: 0, width: 200, height: 100 }] });
  editor.change(scene(10)); await editor.flush(); await preview.refresh();
  assert.equal(preview.getSnapshot().draft!.revision, 1); assert.deepEqual(preview.getSnapshot().scene, scene(10)); assert.equal(preview.getSnapshot().error, "");
  preview.change(scene(20)); editor.change(scene(30)); await editor.flush(); await preview.refresh();
  assert.equal(preview.getSnapshot().draft!.revision, 1); assert.deepEqual(preview.getSnapshot().scene, scene(20));
  await assert.rejects(preview.flush(), /Revision conflict/);
  assert.deepEqual(draft.scene, scene(30)); assert.deepEqual(preview.recoveryScene(), scene(20));
  assert.equal(preview.getSnapshot().unsynced, true); assert.ok(storage.has("pi-diagram:session:drawing"));
});
