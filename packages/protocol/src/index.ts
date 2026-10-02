import type { ComponentType, ReactNode } from "react";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export * from "./interactions.js";
import type { WebInteraction } from "./interactions.js";

export const WEB_API_VERSION = 1 as const;
export const ACTION_REQUEST = "pi-webapp:action:v1";
export const ACTION_RESPONSE = "pi-webapp:action-response:v1";
export const PLUGIN_CHANGED = "pi-webapp:plugin-changed:v1";

export interface PiWebManifest {
  apiVersion: 1;
  client: string;
  style?: string;
}

export function isPiWebManifest(value: unknown): value is PiWebManifest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.apiVersion === WEB_API_VERSION && typeof item.client === "string" && /^\.\/dist\/[\w.-]+\.js$/.test(item.client)
    && (item.style === undefined || (typeof item.style === "string" && /^\.\/dist\/[\w.-]+\.css$/.test(item.style)));
}

export interface PluginEntry {
  id: string;
  pluginId: string;
  kind: string;
  data: unknown;
  timestamp: string;
  afterMessageId?: string;
}

export interface WebSession {
  sessionId: string;
  idle: boolean;
  pluginEntries: readonly PluginEntry[];
  interactions?: readonly WebInteraction[];
}

export interface TurnReference {
  id: string;
  messageIds: readonly string[];
  toolCallIds: readonly string[];
  completed?: boolean;
}

export interface WebSlotProps {
  session: WebSession | null;
  turn?: TurnReference;
  locale: "zh" | "en";
  openPanel(panelId: string): void;
  closePanel(): void;
  panelId: string | null;
  invokeAction<T = unknown>(action: string, input?: unknown): Promise<T>;
  sendMessage(text: string): Promise<void>;
  renderMarkdown(text: string): ReactNode;
  interaction?: WebInteraction;
  resolveInteraction(value: unknown): Promise<void>;
}

export type WebSlotName = "composer.controls" | "turn.tail" | "rightbar.panel" | "rightbar.title";
export interface WebSlotContribution {
  id: string;
  slot: WebSlotName;
  order?: number;
  component: ComponentType<WebSlotProps>;
}
/** Display copy may be localized without changing the canonical action identity. */
export type WebLocalizedText = string | { zh: string; en: string };
export interface WebCommandPresentation {
  label: WebLocalizedText;
  description?: WebLocalizedText;
  icon?: ComponentType<{ size?: number; className?: string }>;
  section?: "add" | "commands";
}
export interface WebCommandInput {
  /** Menu picks insert this spelling; canonical IDs remain accepted in either locale. */
  token?: WebLocalizedText;
  hint: WebLocalizedText;
  /** Only commands explicitly accepting files can submit them with a task. */
  attachments?: boolean;
}
export interface WebCommandContribution {
  id: string;
  title: string;
  description?: string;
  action: string;
  args?: string[];
  presentation?: WebCommandPresentation;
  input?: WebCommandInput;
}
export function isWebLocalizedText(value: unknown): value is WebLocalizedText {
  if (typeof value === "string") return value.length > 0;
  if (!value || typeof value !== "object") return false;
  const text = value as Record<string, unknown>;
  return typeof text.zh === "string" && text.zh.length > 0 && typeof text.en === "string" && text.en.length > 0;
}
/** Validate browser command declarations before they enter the composer catalog. */
export function isWebCommandContribution(value: unknown): value is WebCommandContribution {
  if (!value || typeof value !== "object") return false;
  const command = value as WebCommandContribution;
  if (typeof command.id !== "string" || !command.id || typeof command.title !== "string" || !command.title || typeof command.action !== "string" || !command.action) return false;
  if (command.description !== undefined && typeof command.description !== "string") return false;
  if (command.args !== undefined && (!Array.isArray(command.args) || command.args.some(arg => typeof arg !== "string"))) return false;
  if (command.presentation !== undefined) {
    const face = command.presentation;
    if (!face || !isWebLocalizedText(face.label) || face.description !== undefined && !isWebLocalizedText(face.description)
      || face.icon !== undefined && typeof face.icon !== "function" || face.section !== undefined && !["add", "commands"].includes(face.section)) return false;
  }
  if (command.input !== undefined) {
    const input = command.input;
    if (!input || !isWebLocalizedText(input.hint) || input.attachments !== undefined && typeof input.attachments !== "boolean") return false;
    if (input.token !== undefined) {
      if (!isWebLocalizedText(input.token)) return false;
      const tokens = typeof input.token === "string" ? [input.token] : [input.token.zh, input.token.en];
      if (tokens.some(token => /[\s/]/.test(token))) return false;
    }
  }
  return true;
}
export interface WebMenuContribution {
  id: string;
  menu: "composer" | "turn";
  title: string;
  action: string;
}
/** One browser session activation. Resources must be owned by this scope. */
export interface WebPluginLifecycleContext {
  sessionId: string;
  signal: AbortSignal;
  /** Synchronous cleanup, called once in reverse registration order after abort. */
  onDispose(cleanup: () => void): void;
}
/** Optional primary composer control; the host keeps drafts and the send action. */
export type WebComposerAction = {
  label: string;
  title?: string;
  icon?: ComponentType<{ size?: number }>;
} & ({ kind: "stop" } | { kind: "invoke"; action: string; input?: unknown; sendResultMessage?: boolean });
export interface WebPluginDefinition {
  id: string;
  apiVersion: 1;
  /** Module evaluation only declares the plugin; activation owns instance resources. */
  activate(context: WebPluginLifecycleContext): void;
  slots?: readonly WebSlotContribution[];
  commands?: readonly WebCommandContribution[];
  menuItems?: readonly WebMenuContribution[];
  /** Replace the composer while a session-bound interaction awaits a decision. */
  interactions?: readonly { kind: string; component: ComponentType<WebSlotProps> }[];
  composerPlaceholder?: (session: WebSession, locale: "zh" | "en") => string | undefined;
  composerAction?: (session: WebSession, locale: "zh" | "en") => WebComposerAction | undefined;
  /** Artifact tools retain full arguments in the trajectory, but not the chat. */
  artifactTools?: readonly string[];
}

export function defineWebPlugin<T extends WebPluginDefinition>(definition: T): T { return definition; }

export interface ActionRequest {
  requestId: string;
  pluginId: string;
  action: string;
  sessionId: string;
  input?: unknown;
}
export interface ActionResponse {
  requestId: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

type ActionHandler = (input: unknown, request: ActionRequest) => unknown | Promise<unknown>;

export function registerWebActions(pi: Pick<ExtensionAPI, "events">, pluginId: string, handlers: Record<string, ActionHandler>): () => void {
  let active = true;
  const off = pi.events.on(ACTION_REQUEST, (data) => {
    const request = data as ActionRequest;
    if (!request || request.pluginId !== pluginId || typeof request.requestId !== "string" || typeof request.action !== "string") return;
    void Promise.resolve().then(async () => {
      if (!active) return;
      const handler = handlers[request.action];
      if (!handler) throw new Error(`Unknown action: ${request.action}`);
      const value = await handler(request.input, request);
      if (active) pi.events.emit(ACTION_RESPONSE, { requestId: request.requestId, ok: true, value } satisfies ActionResponse);
    }).catch((cause: unknown) => {
      if (active) pi.events.emit(ACTION_RESPONSE, { requestId: request.requestId, ok: false, error: cause instanceof Error ? cause.message : String(cause) } satisfies ActionResponse);
    });
  });
  return () => { active = false; off(); };
}

/** signal releases the caller's wait; it does not cancel a running handler. */
export function invokeWebAction(bus: Pick<ExtensionAPI["events"], "on" | "emit">, request: ActionRequest, timeoutMs = 15000, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
    };
    const off = bus.on(ACTION_RESPONSE, (data) => {
      const response = data as ActionResponse;
      if (response?.requestId !== request.requestId) return;
      finish(response.ok ? null : new Error(response.error ?? "Plugin action failed"), response.value);
    });
    const timer = setTimeout(() => finish(new Error(`Plugin action timed out: ${request.pluginId}/${request.action}`)), timeoutMs);
    const abort = () => finish(new Error("Plugin action runtime unloaded"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort(); else {
      try { bus.emit(ACTION_REQUEST, request); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    }
  });
}

export function notifyWebChanged(pi: Pick<ExtensionAPI, "events">, pluginId: string): void {
  pi.events.emit(PLUGIN_CHANGED, { pluginId });
}
