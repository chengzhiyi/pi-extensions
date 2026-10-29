# Frontend boundary and lifecycle (2026-10-29)

The complete host contract/decision lives in the sibling host's
`docs/hosted-tool-ui.md`. This package remains self-contained and independently
installable; it imports no host React, styles or modules.

The host owns common tool chrome, page-level parameter text dialogs, notifications
and sidebar/panel routing. The plugin owns previews, review actions, native
editing, revisions, scoped persistence, backups and saves. MessagePort remains
the production frontend boundary.

## Optional UI services

HostedViewMount.hostUi optionally advertises toolCard, autoResize, notifications.
With toolCard, send `toolPresentation: {title: "create view"}` and render only the
preview after acceptance. Report content height using `resize: {height}` (finite,
0–4096 CSS pixels), ResizeObserver and requestAnimationFrame. Auto-height roots
avoid iframe viewport feedback loops. The host reads no plugin DOM. Without
services, retain the legacy header and a native HTML dialog, bounded by the old
iframe viewport. Both updated projects are needed for page-level parameters.

`notify: {message, level: "info" | "error"}` supports mount-scoped host notices.
Messages are data-only, bound to the established mount/generation, and grant no
workspace/action authority. Runtime protocol stays 1; no backend capability bump.

## Ownership

- Initialize once after exact origin/source/mount/generation handshake.
  Acknowledge actual clean/busy status. Observe size only for autoResize tools.
- Update the same session's call/result, theme, language and visibility. Collapse
  retains the realm and all-view coordinator membership.
- Flush dirty available models with revision CAS. Composition, dragging, native
  edits, pending mutations or failed sync prevent closing/switching. All realms
  participate, including collapsed tools/hidden tabs.
- Freeze after flush; restore on rejected update. Immediate replacement clears
  undo/redo only after explicit host confirmation.
- Dispose disconnects ResizeObserver/cancels animation frames, unmounts React,
  disposes models and removes status timers/global events/ports. React effects
  release blobs, polling, theme observers, beforeunload and Canvas resources.
  Native legacy dialogs close/restore focus. Existing pagehide handles ordinary
  realm teardown; abrupt loss requires unknown-view recovery, never a fake ACK.

React/ReactDOM remain pinned/bundled together at 18.3.1 without a runtime peer on
host React. Styles/fonts/assets stay enumerated in resources.json. canvas-env.ts
resolves the asset base with import.meta.url. Real frames own document fonts,
body theme and portals. Committed generations use digest-qualified URLs/fresh
realms; catalog/status refreshes retain them. Production adds no module loader
or custom-element registration/cache.

## Shadow DOM feasibility probe

After build, run `pnpm --filter @chengzhiyi/pi-excalidraw test:shadow`. It mounts
the actual built Canvas/React pair in a custom element, injects its stylesheet,
opens Help and disposes two mounts. Help escapes to document.body and is unstyled
(.Modal position static). Evidence/screenshot: artifacts/shadow-dom-probe/. This
is a reproduced incompatibility, not certification of the editor in Shadow DOM.

Other blockers: module-scoped rpc.ts port/pending requests, model.ts registry/
dispose-all, interaction.ts busy flag, body theme, global font asset path,
document fonts and vendor focus/tooltip/portal behavior. Shadow DOM isolates tree
and style scopes, not window/document or global effects. A guarded stable tag
retains the old constructor; imported modules cannot be unloaded on upgrade.

A production Web Component adapter needs instance-scoped RPC/model/busy/lifecycle,
supported portal/focus roots, per-root styles with explicit font ownership,
per-instance locale/theme and a stable wrapper/versioned factory. It must join
the current save/update coordinator. The new host card seam can accept that
renderer later. Lightweight trusted previews are a smaller candidate than the
full editor. Keep iframe for compatibility and independent documents.
