# ORI-24 implementation handoff

## Scope and source

Branch: `feat/excalidraw-hosted-v2`; base `3e6bd11`. All writes stay in `pi-extensions-excalidraw`; `pi-webapp-excalidraw` was read only. No shared alpha/host worktree modifications, npm installs/publications, pushes or merges.

Copied the current diagrams domain/native UI at source HEAD `d87f24e`, including `b01b6bb` persistence and grouping changes. Added `@chengzhiyi/pi-excalidraw`, version 0.1.0.

## Delivered

- Six data-only tool descriptors; backend `createRuntime(ctx)` implements describe/health/invoke/dispose. Domain revisions, candidate review/initialization, stale rejection and focus are retained.
- One broker CAS checkpoint record per authenticated scope, validated legacy checkpoint import without deleting originals, no backend file/checkpoint writes. Workspace read/commit uses relative `.excalidraw`, size validation, expected hash and no-overwrite save-as.
- Self-contained React/ReactDOM iframe with parent source/origin/identity/generation/mount handshake and bidirectional MessagePort RPC; editor/workspace/tool/controller mounts and streaming preview updates.
- Flush synchronizes dirty available models and refuses composition/pointer/native edit/mutation busy states. Freeze/restore preserve session; native undo reset is explicitly signaled. Cleanup covers React effects, timers, subscriptions, download/thumbnail blobs, listeners and ports.
- Original native canvas/menu, PNG/local import/export, Chinese/grouped scenes, candidate confirmation, backups/recovery and conflict handling. No images/embeds/cloud expansion.
- 426 enumerated bundle/font/CSS/HTML/notice resources. Archive validator accepts only controlled paths and verifies size/hash, forbids extras, duplicates and special/link members. All v1 checks retained.
- Pinned build dependencies; isolated offline build reproduces a working package from 165 copied dependency versions, with every esbuild input realpath verified inside its independent fixture. Exact tgz extraction/import works with no runtime dependencies.

## Protocol delta — parent must incorporate

Only additive change in `packages/protocol/src/hosted.ts`: `HostedRpcResponse.error` now permits `status?: number` and `reason?: string`. Existing `code`, `message`, names, method payloads and protocol versions are unchanged. Host should preserve domain status/reason through worker -> frame RPC; 409 enables safe first-initialization conflict handling, 404/diagram_unavailable preserves backups and stops unavailable-model polling.

Integration details and broker/frame payloads: [README](README.md).

## Verification

Commands run successfully:

- `node --experimental-transform-types --test test/*.test.ts`: 11 package tests (domain, grouping, candidate/manual-edit safety, broker CAS/scope/restart/legacy/hash protection, recovery, controlled archive tampering).
- `tsc --noEmit` in package: passed.
- `node test/frame.browser.mjs`: real Chromium cross-origin iframe; stale handshake ignored, native Chinese/dark editor mounts, a real rectangle drag flushes to host, composition/pointer busy rejects flush/freeze, restore/session rejection/theme update/dispose respond, no unexpected network requests or page errors.
- `node scripts/independent-build.mjs`: 165 copied package versions; both builds produce 426 controlled resources, no host input resolution.
- `node scripts/verify.mjs`: exact tgz, package entries, all resource digests/sizes, extraction to node_modules and live backend operation passed.
- Root `node --test scripts/*.test.mjs`: 21 passed.
- Protocol build and `node --test packages/protocol/test/*.test.mjs`: 7 passed.
- `git diff --check`: passed.

Generated handoffs: `artifacts/chengzhiyi-pi-excalidraw-0.1.0.tgz`, plus the commit patch uploaded to ORI-24. Source report and README are committed; generated dependencies/build fixtures are ignored.

## Not yet accepted / risks for parent ORI-22

1. No actual v2 host enable/disable/upgrade/restart E2E was performed. Parent must wire broker invocation scope and fencing, load/serve only enumerated assets, flush **all mounted frames**, aggregate old on-disk draft envelopes into legacy checkpoint data, and display the immediate-reopen undo-history warning (default: wait for editor close).
2. Real multi-process workspace locking, symlink/no-replace/hash/fencing races remain host acceptance. Package tests use an in-memory broker. If file commit succeeds but checkpoint CAS later conflicts, the file may be committed without matching checkpoint metadata; the operation reports failure and never retries overwrite. Reopen/inspect the file to reconcile.
3. Browser smoke covers real canvas edits and lifecycle, not the complete historical host browser suite or exhaustive PNG/menu/download/long streaming regression. Editor functionality and restrictions are migrated, not expanded.
4. No registry install was authorized or run. Offline independent build and dependency-free tgz installation are verified; a fresh package-manager installation and workspace frozen-lockfile refresh are **not verified**. `pnpm-lock.yaml` is intentionally not regenerated by an install in this run. Do not describe this as a clean registry CI install proof.
5. This is not a malicious-script sandbox; host retains trust/permission/approval gates. No push, merge or publication occurred.

ORI-24's external package implementation is delivered; host integration acceptance belongs to the parent.
