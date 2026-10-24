import { hostCall } from "./rpc.ts";
export class HttpError extends Error {
  constructor(message: string, public status = 500, public reason?: string) { super(message); }
}
export async function stopDiagramGeneration(_sessionId: string): Promise<void> { await hostCall("abort", {}); }
export async function diagramAction<T>(_sessionId: string, action: string, input: object = {}, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const value = await hostCall("action", {action, input});
  signal?.throwIfAborted();
  return value as T;
}
