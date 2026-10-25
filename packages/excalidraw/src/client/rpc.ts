import { HttpError } from "./api.ts";
let port: MessagePort | null = null;
let sequence = 0;
const pending = new Map<string, {resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>}>();
export function hostCall(method: string, input: unknown): Promise<unknown> {
  if (!port) return Promise.reject(new Error("Host port unavailable"));
  const id = `frame-${++sequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Host RPC timeout")); }, 30000);
    pending.set(id, {resolve, reject, timer});
    port!.postMessage({type: "request", id, method, input});
  });
}
export function disconnect() {
  port?.close(); port = null;
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("Frame disposed")); }
  pending.clear();
}
export function connect(next: MessagePort, handle: (method: string, input: any) => Promise<unknown>) {
  if (port) throw new Error("Already connected");
  port = next;
  port.onmessage = async ({data}) => {
    if (!data || typeof data.id !== "string") return;
    if (data.type === "response") {
      const work = pending.get(data.id); if (!work) return;
      pending.delete(data.id); clearTimeout(work.timer);
      if (data.ok) work.resolve(data.value);
      else work.reject(new HttpError(data.error?.message ?? "Host RPC failed", data.error?.status ?? (/conflict|stale/.test(data.error?.code ?? "") ? 409 : data.error?.code === "diagram_unavailable" ? 404 : 500), data.error?.reason ?? data.error?.code));
    } else if (data.type === "request" && typeof data.method === "string") {
      try { const value = await handle(data.method, data.input); next.postMessage({type: "response", id: data.id, ok: true, value}); if (data.method === "dispose") disconnect(); }
      catch (e) { next.postMessage({type: "response", id: data.id, ok: false, error: {code: "frame_error", message: e instanceof Error ? e.message : String(e)}}); }
    }
  };
  port.start();
}
