import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OPEN = "pi-webapp:interaction-open:v1";
const ACCEPT = "pi-webapp:interaction-accept:v1";
const SETTLE = "pi-webapp:interaction-settle:v1";
const CANCEL = "pi-webapp:interaction-cancel:v1";
type Bus = Pick<ExtensionAPI["events"], "on" | "emit">;

export interface WebInteraction {
  requestId: string;
  sessionId: string;
  pluginId: string;
  kind: string;
  data: unknown;
}
export class WebInteractionUnavailable extends Error {}

/** Ack has a deadline; a human decision does not. Abort always releases listeners. */
export function requestWebInteraction(bus: Bus, request: WebInteraction, signal?: AbortSignal, ackTimeoutMs = 300): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error: Error | null, value?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      offAccept(); offSettle();
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => {
      bus.emit(CANCEL, request);
      finish(new Error("Interaction cancelled"));
    };
    const offAccept = bus.on(ACCEPT, (data) => {
      const reply = data as { requestId?: string };
      if (reply?.requestId === request.requestId) clearTimeout(timer);
    });
    const offSettle = bus.on(SETTLE, (data) => {
      const reply = data as { requestId?: string; error?: string; value?: unknown };
      if (reply?.requestId === request.requestId) finish(reply.error ? new Error(reply.error) : null, reply.value);
    });
    timer = setTimeout(() => finish(new WebInteractionUnavailable("No Web interaction host")), ackTimeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort(); else bus.emit(OPEN, request);
  });
}

/** The host owns live requests; persisted artifacts remain plugin-owned. */
export class WebInteractionHost {
  private readonly requests = new Map<string, WebInteraction>();
  private readonly detach: (() => void)[];
  constructor(private readonly bus: Bus, private readonly accepts: (request: WebInteraction) => boolean, private readonly changed: () => void) {
    this.detach = [bus.on(OPEN, (data) => {
      if (!isWebInteraction(data) || !accepts(data) || this.requests.has(data.requestId)) return;
      this.requests.set(data.requestId, data);
      bus.emit(ACCEPT, { requestId: data.requestId });
      changed();
    }), bus.on(CANCEL, (data) => {
      const request = data as WebInteraction;
      const current = this.requests.get(request?.requestId);
      if (current && current.sessionId === request.sessionId && current.pluginId === request.pluginId) {
        this.requests.delete(request.requestId);
        changed();
      }
    })];
  }
  pending(sessionId: string): WebInteraction[] {
    return [...this.requests.values()].filter((request) => request.sessionId === sessionId);
  }
  resolve(sessionId: string, pluginId: string, requestId: string, value: unknown): void {
    const request = this.requests.get(requestId);
    if (!request || request.sessionId !== sessionId || request.pluginId !== pluginId || !this.accepts(request)) throw new Error("Interaction expired or session changed");
    this.requests.delete(requestId);
    this.bus.emit(SETTLE, { requestId, value });
    this.changed();
  }
  cancelAll(reason = "Session changed"): void {
    for (const request of this.requests.values()) this.bus.emit(SETTLE, { requestId: request.requestId, error: reason });
    this.requests.clear();
    this.changed();
  }
  dispose(): void {
    for (const off of this.detach) off();
    this.cancelAll("Interaction host unloaded");
  }
}

function isWebInteraction(value: unknown): value is WebInteraction {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  for (const key of ["requestId", "sessionId", "pluginId", "kind"]) if (typeof request[key] !== "string" || !request[key] || (request[key] as string).length > 200) return false;
  try { return JSON.stringify(request.data).length <= 128 * 1024; } catch { return false; }
}
