/** Hosted v2 plugins run outside the host's JS realm. Only data crosses this API. */
export const HOSTED_API_VERSION = 2 as const;
export const HOSTED_RUNTIME_PROTOCOL = 1 as const;
export type HostedJson = null | boolean | number | string | HostedJson[] | { [key: string]: HostedJson };
export interface HostedResource { path: string; sha256: string; bytes: number; mime: string }
export interface HostedResourceManifest { version: 1; files: HostedResource[] }
export interface HostedPluginManifest {
  apiVersion: 2;
  hostRange: string;
  runtimeProtocol: 1;
  backend: { entry: string };
  frontend: { document: string; controller: string };
  resourcesManifest: string;
  dataSchemaVersion: number;
  supportedDataSchemas: number[];
  capabilities: string[];
}
export interface HostedToolDescriptor {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  action: string;
  readonly?: boolean;
}
export interface HostedScope { cwd: string; workspaceId: string; sessionId: string }
export interface HostedInvocation {
  requestId: string;
  generation: number;
  scope: HostedScope;
  kind: "tool" | "action";
  action: string;
  input: unknown;
}
export interface HostedStateRecord { revision: number; schema: number; value: unknown }
/** Calls are scoped by the host to the authenticated invocation; never trust caller-supplied cwd. */
export interface HostedBroker {
  call(method: "state.read" | "state.compareAndSwap" | "workspace.read" | "workspace.commit" | "legacy.read", input: unknown): Promise<unknown>;
}
export interface HostedRuntimeContext {
  pluginId: string;
  version: string;
  generation: number;
  broker: HostedBroker;
}
export interface HostedRuntime {
  describe(): { tools: HostedToolDescriptor[] } | Promise<{ tools: HostedToolDescriptor[] }>;
  health(): unknown | Promise<unknown>;
  invoke(request: HostedInvocation): unknown | Promise<unknown>;
  dispose?(): void | Promise<void>;
}
export type CreateHostedRuntime = (context: HostedRuntimeContext) => HostedRuntime | Promise<HostedRuntime>;
/** New frames must handshake against origin, source, mountId and generation before accepting a MessagePort. */
export interface HostedFrameHandshake {
  type: "pi:hosted:connect";
  protocol: 1;
  pluginId: string;
  generation: number;
  mountId: string;
}
export interface HostedRpcRequest { type: "request"; id: string; method: string; input?: unknown }
export interface HostedRpcResponse { type: "response"; id: string; ok: boolean; value?: unknown; error?: { code: string; message: string } }
export type HostedRpcMessage = HostedRpcRequest | HostedRpcResponse;
export interface HostedViewMount {
  kind: "controller" | "workspace" | "editor" | "tool";
  sessionId: string;
  locale: "zh" | "en";
  theme: "light" | "dark";
  contentId?: string;
  visible?: boolean;
  title?: string;
}
export interface HostedViewContribution {
  entry: { label: string; description: { zh: string; en: string }; kind: string };
  panels: string[];
  artifactTools: string[];
  toolViews: string[];
  panelAlias: { prefix: string; kind: string; title: string };
}
export function hostedAssetPath(value: unknown): value is string {
  return typeof value === "string" && /^\.\/dist\/[A-Za-z0-9_./-]+$/.test(value)
    && value.length <= 512 && !value.slice(2).split("/").some(part => !part || part === "." || part === "..");
}
export function isHostedPluginManifest(value: unknown): value is HostedPluginManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Partial<HostedPluginManifest>;
  return v.apiVersion === 2 && v.runtimeProtocol === 1 && typeof v.hostRange === "string" && v.hostRange.length > 0
    && !!v.backend && hostedAssetPath(v.backend.entry) && /\.m?js$/.test(v.backend.entry)
    && !!v.frontend && hostedAssetPath(v.frontend.document) && /\.html$/.test(v.frontend.document)
    && hostedAssetPath(v.frontend.controller) && /\.html$/.test(v.frontend.controller)
    && hostedAssetPath(v.resourcesManifest) && /\.json$/.test(v.resourcesManifest)
    && Number.isSafeInteger(v.dataSchemaVersion) && v.dataSchemaVersion! > 0
    && Array.isArray(v.supportedDataSchemas) && v.supportedDataSchemas.length > 0 && v.supportedDataSchemas.length <= 32
    && v.supportedDataSchemas.every(n => Number.isSafeInteger(n) && n > 0) && v.supportedDataSchemas.includes(v.dataSchemaVersion!)
    && Array.isArray(v.capabilities) && v.capabilities.length <= 64 && v.capabilities.every(s => typeof s === "string" && /^[a-z][a-z0-9.-]{0,79}$/.test(s));
}
