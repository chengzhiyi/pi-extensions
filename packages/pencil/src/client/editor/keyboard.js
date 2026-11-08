// Editor keyboard: tool keys, the SDK command registry's keybindings (undo, group, align, zoom…),
// delete, nudge, escape, and an in-frame clipboard. Ignored while typing in a field or editing text.
import { onScopeDispose } from 'vue';
import { TOOL_SHORTCUTS } from '@open-pencil/core';
import { EDITOR_COMMAND_METADATA, useEditorCommands } from '@open-pencil/vue/editor/commands';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
function matches(binding, e) {
  const parts = binding.split('+'); const code = parts.pop();
  const want = { mod: false, shift: false, alt: false, ctrl: false };
  for (const p of parts) { if (p === '$mod') want.mod = true; else if (p === 'Shift') want.shift = true; else if (p === 'Alt') want.alt = true; else if (p === 'Control') want.ctrl = true; }
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const ctrl = isMac ? e.ctrlKey : false;
  return e.code === code && mod === want.mod && e.shiftKey === want.shift && e.altKey === want.alt && ctrl === want.ctrl;
}
const typing = (e) => { const el = e.target; return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)); };

export function useEditorKeyboard(editor, { enabled = () => true } = {}) {
  const { runCommand } = useEditorCommands();
  const bindings = Object.entries(EDITOR_COMMAND_METADATA).flatMap(([id, meta]) => [meta.keybinding ?? []].flat().map((b) => [b, id]));
  let clipboard = null;
  async function copy(cut) {
    if (!editor.state.selectedIds.size) return;
    const payload = await editor.prepareCopy();
    clipboard = payload?.html || null;
    try { await navigator.clipboard?.writeText?.(payload.plainText ?? ''); } catch { /* frame may not have clipboard access */ }
    if (cut) editor.deleteSelected();
  }
  function onKey(e) {
    if (!enabled() || typing(e) || editor.state.editingTextId || e.isComposing) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    // ⌥⌘↩ (Alt+Ctrl+Enter elsewhere) starts and stops the preview, as in OpenPencil.
    if (mod && e.altKey && !e.shiftKey && e.code === 'Enter') { e.preventDefault(); editor.togglePlay(); return; }
    // While previewing only leaving the view is a shortcut; keys belong to the live controls.
    if (editor.state.canvasView?.id === 'play') { if (e.key === 'Escape') { e.preventDefault(); editor.stopPlay(); } return; }
    if (mod && !e.shiftKey && !e.altKey && (e.code === 'KeyC' || e.code === 'KeyX')) { e.preventDefault(); void copy(e.code === 'KeyX'); return; }
    if (mod && !e.shiftKey && !e.altKey && e.code === 'KeyV') { if (clipboard) { e.preventDefault(); void editor.pasteFromHTML(clipboard); } return; }
    for (const [binding, id] of bindings) if (matches(binding, e)) { e.preventDefault(); runCommand(id); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (editor.state.selectedIds.size) { e.preventDefault(); editor.deleteSelected(); } return; }
    if (e.key === 'Escape') { if (editor.state.activeTool !== 'SELECT') editor.setTool('SELECT'); else editor.clearSelection?.(); return; }
    const nudge = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
    if (nudge && editor.state.selectedIds.size) { e.preventDefault(); const step = e.shiftKey ? 10 : 1; editor.nudgeSelected(nudge[0] * step, nudge[1] * step); return; }
    const tool = TOOL_SHORTCUTS[`${e.shiftKey ? 'Shift+' : ''}${e.code}`];
    if (tool && tool !== 'COMMENT' && tool !== 'EYEDROPPER') { e.preventDefault(); editor.setTool(tool); }
  }
  addEventListener('keydown', onKey);
  onScopeDispose(() => removeEventListener('keydown', onKey));
}
