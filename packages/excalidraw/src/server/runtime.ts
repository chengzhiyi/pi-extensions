import type { CreateHostedRuntime, HostedStateRecord } from "@chengzhiyi/pi-web-protocol";
import { DiagramError, record } from "../contract/diagrams.ts";
import { checkpoint } from "./checkpoint.ts";
import { brokerFiles } from "./files.ts";
import { DiagramStore } from "./store.ts";
import { diagramTools } from "./tools.ts";
const KEY = "checkpoint";
export const createRuntime: CreateHostedRuntime = ctx => {
  let disposed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const guard = () => { if (disposed) throw new DiagramError("Plugin disposed", 409); };
  return {
    describe: () => ({tools: diagramTools()}),
    health: () => ({ok: !disposed, schema: 1}),
    invoke(request) {
      const run = queue.catch(() => {}).then(async () => {
        guard();
        if (request.generation !== ctx.generation || !request.scope.sessionId || !request.scope.workspaceId) throw new DiagramError("Stale generation or invalid scope", 409);
        if (!record(request.input)) throw new DiagramError("Invalid input");
        // Broker is bound by the host to this authenticated invocation's scope.
        const store = new DiagramStore(brokerFiles(ctx.broker));
        if (request.kind === "tool" && request.action === "reference") return store.tool(request.scope.cwd, request.scope.sessionId, request.action, request.input);
        let state = await ctx.broker.call("state.read", {key: KEY}) as HostedStateRecord | null;
        if (state && (state.schema !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 1)) throw new DiagramError("Unsupported state schema or invalid storage revision", 409);
        if (!state) {
          const legacy = await ctx.broker.call("legacy.read", {});
          if (legacy !== null) {
            const value = checkpoint(legacy);
            state = await ctx.broker.call("state.compareAndSwap", {key: KEY, expectedRevision: 0, schema: 1, value}) as HostedStateRecord;
          }
        }
        const before = state ? checkpoint(state.value) : {drafts: [], focused: null};
        store.restoreCheckpoint(request.scope.cwd, request.scope.sessionId, structuredClone(before));
        const result = request.kind === "tool"
          ? store.tool(request.scope.cwd, request.scope.sessionId, request.action, request.input)
          : request.kind === "action" ? await store.action(request.scope.cwd, request.scope.sessionId, request.action, request.input, guard)
          : (() => { throw new DiagramError("Unknown invocation kind"); })();
        guard();
        const value = store.checkpoint(request.scope.cwd, request.scope.sessionId);
        if (JSON.stringify(value) !== JSON.stringify(before)) await ctx.broker.call("state.compareAndSwap", {key: KEY, expectedRevision: state?.revision ?? 0, schema: 1, value});
        return result;
      });
      queue = run;
      return run;
    },
    async dispose() { disposed = true; await queue.catch(() => {}); },
  };
};
