# @chengzhiyi/pi-excalidraw

Hosted v2 Excalidraw package. Migrated from `pi-webapp-excalidraw` diagrams at source HEAD `d87f24e`, including `b01b6bb` persistence/grouping changes. No host-private imports, shared React, direct checkpoint writes, workspace filesystem access, account, collaboration, image attachments or external embeds.

## Build and verification

Run from this package using Node 24 (Node 22 with transform-types support also works for tests). Build dependencies and browser test dependency are explicitly pinned in package.json. React/ReactDOM, editor code, lazy chunks, locales, CSS, fonts and notices are shipped inside `dist`; there are **no installed runtime dependencies**.

```sh
node scripts/build.mjs
node --experimental-transform-types --test test/*.test.ts
../../node_modules/.bin/tsc --noEmit
node test/frame.browser.mjs
node scripts/independent-build.mjs
node scripts/verify.mjs
```

`independent-build` copies the resolved, version-checked build package closure (preserving nested versions) into `../../artifacts/independent-build`, rebuilds there and checks every esbuild input realpath remains inside that directory. It does not install packages or contact a registry. `verify` uses `pnpm pack`, validates every resource digest/size and every manifest entry, extracts the exact archive into a fixture node_modules and imports/runs its backend. No npm installation/publication is performed. A fresh registry install/frozen workspace lockfile update is not part of this offline verification.

## Host integration contract

- Identify this plugin by its package name. Manifest is `package.json.piWebapp`; API 2, runtime protocol 1, schema 1. Resource paths are relative to the package, including `./dist/`. `resources.json` enumerates all serving-allowed files except itself; the host must check its trusted archive/package provenance. Do not expose arbitrary package directories.
- Import `dist/runtime.js`, call `createRuntime(ctx)`. `describe` returns six tool descriptors with their `action`; both tools and UI actions enter `invoke`. Host supplies authenticated scope and generation, binds broker access to **that invocation**, and serializes/fences generation changes. Do not trust an iframe-supplied session/cwd.
- One schema-1 `checkpoint` state record per plugin/workspace/session stores `{drafts, focused}`. Storage revision and draft domain revision are independent. New state uses expectedRevision 0; first returned revision is 1. Every invocation reloads state; writes CAS without automatic retries. Scope is never encoded into the ASCII key.
- `legacy.read {}` returns the old scope's `{drafts, focused}` or null. Host resolves the legacy plugin ID `@pi-webapp/diagrams`, reads old draft envelopes/focus, and returns a scope checkpoint. Plugin validates all data before CAS import; leave old files untouched. Invalid data is an error, never an empty-state reset.
- Workspace broker handles path containment/symlink defenses, bounded text reads, hashes, locks, no-replace creation and generation fencing immediately before commit. Plugin permits only relative `.excalidraw` paths and sends `expectedHash: null` for save-as/new files. It never retries a conflict by overwriting.
- A successful workspace commit followed by a failed state CAS can leave the file committed but its checkpoint not updated. Error is surfaced; do not silently retry save-as or claim rollback. Host's hash/fencing remains authoritative; inspect/reopen that file to reconcile.
- Serialize domain errors with optional `error.status` and `error.reason` in RPC responses (additive protocol fields introduced here). `409` is needed for stale candidate/initialization handling; `404` + `diagram_unavailable` keeps backups and stops polling. `code`/`message` remain unchanged and compatible.

## Frame protocol

Both frontend manifest entries point to `dist/frame.html`. Supply URL parameters `parentOrigin`, `pluginId`, `generation`, `mountId`. Send `{type:'pi:hosted:connect', protocol:1, pluginId, generation, mountId}` and exactly one MessagePort **from that parent origin/window**. Wrong identity/generation/source/origin is ignored; only one connection is accepted. This is realm/lifecycle isolation, not a hostile-code sandbox.

Host RPC methods: `describe`, `initialize(HostedViewMount)`, `update`, `flush`, `freeze`, `restore`, `dispose`. Session binding cannot change after initialize. Tool updates are `{call:{text}, result:{blocks,isError?}, running}`; partial argument strings retain streaming thumbnails. UI calls the host with `action {action,input}`, `openPanel {kind,contentId,title}`, and `changed {dirty,busy}`; the RPC transport also supports `sendMessage` and `abort` without opening another composer.

Flush every mounted frame, not just the controller: each iframe owns its own React/model realm. Flush synchronizes every available dirty model and refuses success during composition, pointer interaction, native text/multisegment editing, resizing, rotation or a mutation. Freeze returns `{mount, undoClearedOnReopen:true}` after flush; restore only accepts the same session. Persistent state and explicit browser backups recover content, **not native undo history**. Host should wait for editor closure by default; immediate reopen must display an undo-history-cleared warning. Do not treat an RPC timeout as successful flush/freeze.

Native menus retain import/local save/export/PNG, Chinese locale, background/theme, groups and editing. Workspace Ctrl/Cmd-S remains separately hash-protected. Existing candidates require explicit accept/reject, hand edits invalidate old candidates, new untouched scenes initialize only once. Original thumbnails and local backups are retained until replacement/recovery decisions. Dispose unmounts React, cancels model timers/preview subscriptions/download URLs and closes the port after replying.

## Outstanding integration acceptance

Real host enable/disable/switch/restart/hot-upgrade, authenticated broker scope isolation across real host processes, disk-lock/symlink/fencing race behavior, old on-disk envelope aggregation, and actual end-user warning UX remain the parent integration's responsibility. Tests use a real cross-origin iframe and native editor, with an in-memory host broker fixture. Browser coverage here does not substitute for the host end-to-end suite or exhaustive PNG/menu regression checks.
