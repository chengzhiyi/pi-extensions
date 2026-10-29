import { createRoot } from "react-dom/client";
import type { HostedViewMount, HostedViewContribution } from "@chengzhiyi/pi-web-protocol";
import { DiagramEditor, DiagramWorkspace, clearDownloads } from "./DiagramPanel.tsx";
import { DiagramToolView } from "./DiagramPreview.tsx";
import { disposeModels, flushDiagramModels, modelStatus } from "./model.ts";
import { connect, disconnect, hostCall } from "./rpc.ts";
import type { ToolViewProps } from "./ui.tsx";
import "./frame.css";
import { canvasBusy } from "./interaction.ts";
const root = createRoot(document.getElementById("root")!);
const expected = new URL(location.href).searchParams;
let mount: HostedViewMount | null = null;
let tool: Partial<ToolViewProps> = {};
let frozen = false, disposed = false, composing = false;
let resizeObserver: ResizeObserver | undefined;
let resizeFrame = 0, lastHeight = -1;
const pointers = new Set<number>();
const contribution: HostedViewContribution = {
  entry: {label: "Excalidraw", description: {zh: "手绘图稿", en: "Editable drawings"}, kind: "workspace"},
  panels: ["workspace", "editor"], artifactTools: ["excalidraw_create_view", "diagram_create", "diagram_patch"],
  toolViews: ["excalidraw_create_view", "diagram_create", "diagram_patch"], panelAlias: {prefix: "diagram:", kind: "editor", title: "Excalidraw"},
};
function render() {
  if (!mount || disposed) return;
  document.body.toggleAttribute("data-ds-dark-theme", mount.theme === "dark");
  document.getElementById("root")!.inert = frozen;
  const p = {session: {sessionId: mount.sessionId}, contentId: mount.contentId ?? "", locale: mount.locale, visible: mount.visible !== false};
  root.render(mount.kind === "controller" ? null : mount.kind === "tool" ? <DiagramToolView {...p} hostToolCard={!!mount.hostUi?.toolCard} call={tool.call ?? {text: ""}} result={tool.result} running={tool.running ?? false} openPanel={alias => { void hostCall("openPanel", {kind: "editor", contentId: alias.replace(/^diagram:/, ""), title: "Excalidraw"}); }} /> : mount.kind === "workspace" ? <DiagramWorkspace {...p} /> : <DiagramEditor {...p} />);
}
function observeToolSize() {
  document.body.dataset.mountKind = "tool";
  const element = document.getElementById("root")!;
  const report = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (disposed) return;
      // Measure our own content only. Viewport height/scrollHeight would feed the
      // host iframe height back into itself and prevent shrinking.
      const height = Math.min(4096, Math.ceil(element.getBoundingClientRect().height));
      if (height === lastHeight) return;
      lastHeight = height;
      void hostCall("resize", {height}).catch(() => {});
    });
  };
  resizeObserver = new ResizeObserver(report); resizeObserver.observe(element); report();
}
function busy() { return composing || pointers.size > 0 || canvasBusy() || modelStatus().busy; }
async function flush() {
  if (!mount) throw new Error("Not initialized");
  if (busy()) throw new Error("Canvas is composing or dragging; close the editor before switching. Immediate reopen clears undo history.");
  await flushDiagramModels(mount.sessionId);
  if (busy() || modelStatus().dirty) throw new Error("Canvas changed during flush");
  return {dirty: false, busy: false};
}
async function handle(method: string, input: any) {
  if (disposed) throw new Error("Disposed");
  switch (method) {
    case "describe": return contribution;
    case "initialize":
      if (mount) throw new Error("Already initialized");
      if (!input || !["controller", "workspace", "editor", "tool"].includes(input.kind) || typeof input.sessionId !== "string" || !["zh", "en"].includes(input.locale) || !["light", "dark"].includes(input.theme)) throw new Error("Invalid mount");
      mount = input;
      if (mount!.kind === "tool" && mount!.hostUi?.toolCard) await hostCall("toolPresentation", {title: "create view"});
      if (mount!.kind === "tool" && mount!.hostUi?.autoResize) observeToolSize();
      render();
      // Complete initialization with an actual status from this realm, not a host
      // assumption or a timer race. Unknown registrations remain fail-closed.
      await hostCall("changed", {...modelStatus(), busy: busy()});
      return contribution;
    case "update":
      if (!mount) throw new Error("Not initialized");
      if (input?.sessionId && input.sessionId !== mount.sessionId) throw new Error("Session cannot change");
      if (mount.kind === "tool") tool = {...tool, ...input};
      mount = {...mount, ...(input?.theme ? {theme: input.theme} : {}), ...(input?.locale ? {locale: input.locale} : {}), ...(typeof input?.visible === "boolean" ? {visible: input.visible} : {})};
      render(); return null;
    case "flush": return flush();
    case "freeze": await flush(); frozen = true; render(); return {mount, undoClearedOnReopen: true};
    case "restore":
      if (!mount || input?.mount?.sessionId !== mount.sessionId) throw new Error("Snapshot scope mismatch");
      frozen = false; render(); return {undoClearedOnReopen: true};
    case "dispose": await flush(); cleanup(false); return null;
    default: throw new Error("Unknown frame method");
  }
}
function handshake(event: MessageEvent) {
  const d = event.data;
  if (event.source !== parent || event.origin !== expected.get("parentOrigin") || !d || d.type !== "pi:hosted:connect" || d.protocol !== 1 || d.pluginId !== expected.get("pluginId") || String(d.generation) !== expected.get("generation") || d.mountId !== expected.get("mountId") || event.ports.length !== 1) return;
  window.removeEventListener("message", handshake);
  connect(event.ports[0], handle);
}
const compositionStart = () => {composing = true;};
const compositionEnd = () => {composing = false;};
const pointerDown = (e: PointerEvent) => {pointers.add(e.pointerId);};
const pointerUp = (e: PointerEvent) => {pointers.delete(e.pointerId);};
window.addEventListener("message", handshake);
window.addEventListener("compositionstart", compositionStart);
window.addEventListener("compositionend", compositionEnd);
window.addEventListener("pointerdown", pointerDown);
window.addEventListener("pointerup", pointerUp);
window.addEventListener("pointercancel", pointerUp);
let prior = "";
const timer = setInterval(() => {
  if (!mount) return;
  const status = {...modelStatus(), busy: busy()}; const text = JSON.stringify(status);
  if (text !== prior) { prior = text; void hostCall("changed", status).catch(() => {}); }
}, 150);
function cleanup(closePort = true) {
  disposed = true; clearInterval(timer); resizeObserver?.disconnect(); cancelAnimationFrame(resizeFrame); root.unmount(); disposeModels(); clearDownloads();
  window.removeEventListener("message", handshake);
  window.removeEventListener("pagehide", pageHide);
  window.removeEventListener("compositionstart", compositionStart); window.removeEventListener("compositionend", compositionEnd);
  window.removeEventListener("pointerdown", pointerDown); window.removeEventListener("pointerup", pointerUp); window.removeEventListener("pointercancel", pointerUp);
  if (closePort) disconnect();
}
function pageHide() { if (!disposed) cleanup(); }
window.addEventListener("pagehide", pageHide, {once: true});
