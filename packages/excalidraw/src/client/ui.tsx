import type { ReactNode } from "react";
export interface SessionView {sessionId: string}
export interface WorkbenchPanelProps {session: SessionView; contentId: string; locale: "zh" | "en"; visible: boolean}
export interface ToolViewProps {session: SessionView | null; locale: "zh" | "en"; call: {text: string}; result?: {blocks: {kind: string; text?: string}[]; isError?: boolean}; running: boolean; openPanel(alias: string): void}
export function ExcalidrawIcon({size = 18}: {size?: number}) { return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM7 16l9-9" fill="none" stroke="currentColor" strokeWidth="2" /></svg>; }
export function Modal(p: {open: boolean; onClose(): void; title: string; closeLabel: string; className?: string; contentClassName?: string; children: ReactNode}) {
  return p.open ? <div role="dialog" aria-modal="true" aria-label={p.title} className={p.className} onKeyDown={e => {if (e.key === "Escape") p.onClose();}}><button autoFocus onClick={p.onClose}>{p.closeLabel}</button><div className={p.contentClassName}>{p.children}</div></div> : null;
}
