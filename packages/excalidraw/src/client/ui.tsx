import { useEffect, useRef, type ReactNode } from "react";
import css from "./ui.module.css";
export interface SessionView {sessionId: string}
export interface WorkbenchPanelProps {session: SessionView; contentId: string; locale: "zh" | "en"; visible: boolean}
export interface ToolViewProps {session: SessionView | null; locale: "zh" | "en"; call: {text: string}; result?: {blocks: {kind: string; text?: string}[]; isError?: boolean}; running: boolean; hostToolCard?: boolean; openPanel(alias: string): void}
export function ExcalidrawIcon({size = 18}: {size?: number}) { return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM7 16l9-9" fill="none" stroke="currentColor" strokeWidth="2" /></svg>; }
export function Modal(p: {open: boolean; onClose(): void; title: string; closeLabel: string; className?: string; contentClassName?: string; children: ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!p.open || !ref.current) return;
    const dialog = ref.current, previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [p.open]);
  // Compatibility only: a host without UI services can still show a real modal
  // within this document. New hosts render the page-level parameters themselves.
  return p.open ? <dialog ref={ref} aria-modal="true" aria-label={p.title} className={`${css.dialog} ${p.className ?? ""}`} onCancel={e => { e.preventDefault(); p.onClose(); }}>
    <header className={css.header}><h2>{p.title}</h2><button autoFocus type="button" onClick={p.onClose}>{p.closeLabel}</button></header><div className={`${css.content} ${p.contentClassName ?? ""}`}>{p.children}</div>
  </dialog> : null;
}
