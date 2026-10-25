# @chengzhiyi/pi-excalidraw

Hosted v2 Excalidraw package. Migrated from `pi-webapp-excalidraw` diagrams at source HEAD `d87f24e`, including `b01b6bb` persistence/grouping changes. No host-private imports, shared React, direct checkpoint writes, workspace filesystem access, account, collaboration, image attachments or external embeds.

## Install and update in pi-webapp

This is an **official optional plugin**, published as `@chengzhiyi/pi-excalidraw` on npm. Use a pi-webapp host with the **hosted v2 runtime**: publishing or installing this package does not add that runtime to an older host. In particular, a host branch/release that predates the hosted-v2 migration is not made compatible by this package's publication alone.

In a compatible host, open **Plugins**, find the official **Excalidraw** card, choose **Install**, then **Enable**. The card can be listed before installation without downloading the editor or fonts. The published package already contains the editor, React, fonts and other browser assets; end users do not build it or install this repository's development dependencies. Do not install dependencies into the host's root directory as a substitute for the plugin manager.

Use **Check updates** and the offered update action for independent plugin updates. Compatible software updates also synchronize already-installed official plugins; they do not install absent plugins or re-enable disabled ones. There is no update-policy selector to configure. Version compatibility, integrity checks and successful checkpoint synchronization still gate activation.

An open editor defers the version switch by default. Close it and apply the pending update, or explicitly choose **Update and reopen now** after reviewing the warning that native undo/redo history is reset. Only the plugin's views/runtime are replaced: the host page and AgentSession are retained. Do not interpret a download, a registry tag or a staged npm package as proof that activation succeeded.

Disabling or uninstalling retains user workspace `.excalidraw` files and recovery data. Unsaved checkpoints and browser backups are recovery aids, not a replacement for an explicitly saved workspace file. Save important drawings before upgrading. A failed save or lifecycle acknowledgement must be surfaced rather than bypassed by refresh or forced overwrite.

The first post-publication documentation patch changes these instructions only; it does not claim new editor features. Release acceptance should install the two actual npm versions through the compatible host and verify staged/immediate update behavior, preserved drawing data and retained host/session identity. Local archive fixtures alone are not evidence of public-registry updates.

## Build and verification

Run from this package using Node 24 (Node 22 with transform-types support also works for tests). Build dependencies and browser test dependency are explicitly pinned in package.json. React/ReactDOM, editor code, lazy chunks, locales, CSS, fonts and notices are shipped inside `dist`; there are **no installed runtime dependencies**.

```sh
node scripts/build.mjs
node --experimental-transform-types --test test/*.test.ts test/*.test.mjs
../../node_modules/.bin/tsc --noEmit
node test/frame.browser.mjs
node scripts/independent-build.mjs
node scripts/verify.mjs
node test/csp.browser.mjs
```

`independent-build` copies the resolved, version-checked build package closure (preserving nested versions) into `../../artifacts/independent-build`, rebuilds there and checks every esbuild input realpath remains inside that directory. It does not install packages or contact a registry. `verify` uses `pnpm pack`, validates every resource digest/size and every manifest entry, extracts the exact archive into a fixture node_modules and imports/runs its backend. No npm installation/publication is performed. A fresh registry install/frozen workspace lockfile update is not part of this offline verification.

## Production CSP font policy

The build uses hash-checked adapters for Excalidraw 0.18.1: complete original WOFF2 unicode-range partitions are embedded instead of running the JS/WASM glyph subsetter. This preserves glyph quality and native exports but increases SVG sizes; a console info message makes the policy explicit. The font URL adapter removes the upstream CDN fallback, requiring the local asset path. Neither dependency installations nor host CSP are modified; no `unsafe-eval` or `wasm-unsafe-eval` is required. Upstream drift fails the build for review.

`test:csp` extracts the real `verify` tgz, checks every manifest digest, serves resources over HTTP with the exact production hosted-asset CSP, and exercises a Chinese tool thumbnail and native editor PNG/source downloads. It asserts byte-exact embedded partitions, browser font decoding, and zero page errors, CSP violations, console errors or external requests. The source repository's `packages/excalidraw/CSP-VERIFICATION.md` records verification and limitations (also supplied separately with the development artifact).

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
