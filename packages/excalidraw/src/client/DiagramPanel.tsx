import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { WorkbenchPanelProps } from "./ui.tsx";
import type { DiagramDraft } from "../contract/diagrams.ts";
import { diagramAction } from "./api.ts";
import { diagramModel } from "./model.ts";
import css from "./diagrams.module.css";
type CanvasModule = typeof import("./Canvas.tsx");
import { downloadDrawing } from "./download.ts";
export function clearDownloads() { /* Download URLs are owned by the host document. */ }
export const download = downloadDrawing;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Loading stays visually quiet (a late, faint spinner); a failure says what happened and offers one retry. */
function Placeholder({ error, locale, retry }: { error?: string; locale: "zh" | "en"; retry(): void }) {
  const t = (zh: string, en: string) => locale === "zh" ? zh : en;
  if (!error) return <div className={css.placeholder} role="status" aria-busy="true" aria-label={t("正在加载 Excalidraw", "Loading Excalidraw")}><span className={css.spinner} /></div>;
  return <div className={css.placeholder} role="alert">
    <p className={css.placeholderTitle}>{t("Excalidraw 暂时无法加载", "Excalidraw could not load")}</p>
    <p className={css.placeholderDetail}>{error}</p>
    <button type="button" onClick={retry}>{t("重试", "Retry")}</button>
  </div>;
}

/** The optional workspace entry opens a blank native canvas, never a second AI composer. */
export function DiagramWorkspace(p: WorkbenchPanelProps) {
  const pending = useRef<Promise<DiagramDraft> | null>(null);
  const [draft, setDraft] = useState<DiagramDraft | null>(null), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!p.visible) return;
    pending.current ??= diagramAction<DiagramDraft>(p.session.sessionId, "new", {});
    void pending.current.then(setDraft).catch(e => { pending.current = null; setError(errorText(e)); });
  }, [p.visible, p.session.sessionId, attempt]);
  return draft ? <DiagramEditor {...p} contentId={draft.id} /> : <Placeholder error={error} locale={p.locale} retry={() => { setError(""); setAttempt(value => value + 1); }} />;
}

/** Key the route so an async fallback can never leak into another session or drawing. */
export function DiagramEditor(p: WorkbenchPanelProps) {
  return <DiagramEditorRoute key={JSON.stringify([p.session.sessionId, p.contentId])} {...p} />;
}
function DiagramEditorRoute(p: WorkbenchPanelProps) {
  const [replacement, setReplacement] = useState<string | null>(null), [error, setError] = useState("");
  const model = diagramModel(p.session.sessionId, replacement ?? p.contentId);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const t = (zh: string, en: string) => p.locale === "zh" ? zh : en;
  const backup = state.unavailable ? model.recoveryScene() : null;
  const recover = async (useBackup: boolean) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const scene = useBackup ? model.recoveryScene() : null;
      if (useBackup && !scene) throw new Error(t("本地备份不可用", "Local backup unavailable"));
      // Recovery always requires an explicit click and a new identity. Never fabricate the
      // unavailable historical scene or consume/delete its only local source.
      const draft = await diagramAction<DiagramDraft>(p.session.sessionId, scene ? "import" : "new", scene ? { scene, title: t("恢复的本地备份", "Recovered local backup") } : {});
      setReplacement(draft.id);
    } catch (e) { setError(errorText(e)); }
    finally { pending.current = false; setBusy(false); }
  };
  if (state.unavailable) return <div role="status">
    <p>{t("此历史图稿没有可靠的最新内容；不会自动创建替代图稿。", "No reliable latest content is available for this historical drawing. No replacement is created automatically.")}</p>
    {backup && <><button disabled={busy} onClick={() => download(new Blob([JSON.stringify(backup)], { type: "application/json" }), `${p.contentId}-backup.excalidraw`)}>{t("下载本地备份", "Download local backup")}</button>
      <button disabled={busy} onClick={() => void recover(true)}>{t("将备份恢复为新图稿", "Restore backup as new drawing")}</button></>}
    <button disabled={busy} onClick={() => void recover(false)}>{t("创建新的空白图稿", "Create new blank drawing")}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
  return <NativeDiagramEditor {...p} key={model.id} contentId={model.id} />;
}

/** Native file operations live in the official menu; the existing workspace-save shortcut remains separate. */
function NativeDiagramEditor(p: WorkbenchPanelProps) {
  const model = diagramModel(p.session.sessionId, p.contentId);
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const [canvas, setCanvas] = useState<CanvasModule | null>(null), [error, setError] = useState("");
  const [dialog, setDialog] = useState<"save" | null>(null), [path, setPath] = useState("");
  const [attempt, setAttempt] = useState(0);
  const t = (zh: string, en: string) => p.locale === "zh" ? zh : en;
  const run = async (operation: () => Promise<unknown>) => { setError(""); try { await operation(); } catch (e) { setError(errorText(e)); } };
  useEffect(() => {
    if (!p.visible) return;
    let active = true;
    import("./Canvas.tsx").then(module => { if (active) setCanvas(module); }).catch(e => { if (active) setError(errorText(e)); });
    const abort = new AbortController();
    const refresh = async () => { await model.refresh(abort.signal); };
    void refresh();
    void diagramAction(p.session.sessionId, "focus", { id: p.contentId }).catch(e => { if (active) setError(errorText(e)); });
    const timer = setInterval(() => void refresh(), 1200);
    return () => { active = false; abort.abort(); clearInterval(timer); model.suspend(); };
  }, [model, p.visible, p.contentId, p.session.sessionId, attempt]);
  const candidateId = state.draft?.candidate?.id;
  useEffect(() => {
    if (canvas && candidateId) void model.initialize(canvas.materialize).catch(e => setError(errorText(e)));
  }, [canvas, candidateId, model]);
  useEffect(() => {
    const dirty = state.unsynced || (!!state.draft && state.draft.revision !== state.draft.savedRevision);
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [state.unsynced, state.draft?.revision, state.draft?.savedRevision]);
  const openDialog = (_mode: "save") => { setPath(state.draft?.path ?? `diagrams/${p.contentId}.excalidraw`); setDialog("save"); };
  const ready = p.visible && canvas && state.scene;
  const downloadSource = async () => { const scene = model.getSnapshot().scene; if (scene) await download(new Blob([JSON.stringify(scene)], { type: "application/json" }), `${state.draft?.title ?? "diagram"}.excalidraw`); };
  return <section className={css.editor} aria-label={t("Excalidraw 编辑器", "Excalidraw editor")} onKeyDownCapture={event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); openDialog("save"); }
  }}>
    <div className={css.canvas} data-diagram-canvas>{ready ? <canvas.default scene={state.scene!} readOnly={state.busy} locale={p.locale} onChange={value => model.change(value)} onError={setError} /> : <Placeholder error={error || state.error} locale={p.locale} retry={() => { setError(""); setAttempt(value => value + 1); }} />}</div>
    {dialog && <div className={css.modalBackdrop}><form className={css.dialog} role="dialog" aria-label={t("保存图稿", "Save diagram")} onSubmit={event => {
      event.preventDefault(); void run(async () => {
        await model.mutate("save", { path });
        setDialog(null);
      });
    }}>
      <label>{t("工作区路径", "Workspace path")}<input autoFocus aria-label={t("工作区路径", "Workspace path")} value={path} onChange={e => setPath(e.target.value)} placeholder="diagrams/example.excalidraw" /></label>
      <div><button type="button" onClick={() => setDialog(null)}>{t("取消", "Cancel")}</button><button disabled={state.busy || !path.trim()}>{t("保存", "Save")}</button></div>
      {(error || state.error) && <p role="alert">{error || state.error}</p>}
    </form></div>}
    {state.recovered && <div className={css.recovery} role="status">{t("发现未保存的本地备份", "Unsaved local backup found")}
      <button onClick={() => model.restore()}>{t("恢复", "Restore")}</button><button onClick={() => model.dismissRecovery()}>{t("保留当前图稿", "Keep current")}</button>
    </div>}
    {ready && !dialog && (error || state.error) && <div className={css.error} role="alert">{error || state.error}<button onClick={() => void run(() => model.reload())}>{t("重新载入", "Reload")}</button><button onClick={() => void run(downloadSource)}>{t("下载草稿", "Download draft")}</button></div>}
  </section>;
}
