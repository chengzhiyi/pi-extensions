# pi-pencil feasibility spike: results

Date: 2026-11-06.

| Repo | Branch | Base |
|---|---|---|
| `pi-extensions` | `spike/pencil` | `69f3cbe` |
| `pi-webapp` (worktree `../pi-webapp-spike-pencil`) | `spike/pencil` | `local/floating-live`, `c34fa7d` |

- Upstream is `@open-pencil/{core,scene-graph,vue,kiwi}` pinned exactly at `0.17.0-beta.2`, and `canvaskit-wasm` at `0.41.1`.
- Machine: Apple silicon, Node 24.21, Playwright Chromium (SwiftShader WebGL).
- Plan: [`docs/pi-pencil-plan.md`](../../docs/pi-pencil-plan.md) §5.

**Verdict: GO.** S1–S5 pass, including a **real-model** run of S2. S5 passes after one fix made during the spike (sharing assets between frame and backend). S6 (Yjs) was not run. Opening the saved files in Figma still needs a person (§ Open).

## Results

| # | Criterion | Result |
|---|---|---|
| **S1** Editor boot under the new CSP | Under the per-plugin CSP (`script-src 'self' 'wasm-unsafe-eval'`, everything else identical to the host's hosted CSP): editor ready, **first paint 340–362 ms**, heap 40–43 MB. **0** CSP violations, page errors, console errors and external requests. Click selects a layer, wheel pans, Ctrl+wheel zooms. **Control:** the same build under today's host CSP aborts with `script-src wasm-eval` (`WebAssembly.instantiate … violates … script-src 'self'`). So the permission is necessary, and `'unsafe-eval'` is not needed. | **PASS** |
| **S2** Agent creates an auto-layout screen | The typed PencilOp batch (no `eval`, no JSX) builds a 390×844 VERTICAL auto-layout screen (gap 16, padding 64/24/24/24, FILL rows 342 wide, rows hug at 51 px, 0 overlaps) in the **Node backend with no editor open**. Through the **real host** (HTTP bridge, manager, forked worker, retained SDK `AgentSession`): `pencil_read_me` → `pencil_propose_changes` in **251 ms**; the tool result carries a PNG preview image block (new host H4). Nothing is applied before the human's `accept` frame action; the agent cannot call `accept` (`human_only`). Layout is identical in browser and Node (10/10 nodes within 0.5 px). | **PASS** |
| **S2 (real model)** | `openai-codex / gpt-5.6-luna` through the same real host stack (`test/hosted-pencil-real.test.ts`, isolated agent dir). Prompt: a 「轻记」 login screen. **3 pencil calls to the first valid proposal** (`read_me` → `status` → `propose_changes`, 21 ops, 10 auto-layout frames; target ≤ 4). Turn time 45.7 s. It then rendered its proposal (one wrong-ID error, corrected on the next call) and told the user it was *awaiting confirmation*. Human accept → save wrote a 75.8 KB `.fig` that re-renders correctly (`spike-real-model.png`). Other calls: one harmless `bash pwd && ls`. | **PASS** |
| **S3** `.fig` save and reload | Node: save → reload in a fresh registry gives an identical structural projection and **0 changed pixels** at 2x. Through the host: `save` writes `designs/login.fig` (48 KB) through the new binary `workspace.commit` with hash CAS; the hash is verified on disk. If the file changes externally, the next save is refused (`file_conflict`) and never overwrites. Reopen from disk gives the same tree. | **PASS** |
| **S4** CJK text | 「登录 / ログイン」, 「欢迎回来，…。」, 「忘记密码？」: **0 missing glyphs**. Browser export vs Node render: **0 changed pixels**. Fonts are served from the plugin origin. 0 requests to Google Fonts (`setOnlineFontProviders` all off, `setHostFontLoader` supplies the subset). | **PASS** |
| **S5** Bundle size | **38.9 MiB** unpacked (budget 45), **15.2 MiB** tgz (budget 20), initial frame JS/CSS **2.63 MiB** (budget 4). Largest file: `canvaskit.wasm` 7.71 MiB (H2 WASM class 16 MiB). CJK subsets are 2.61 MiB × 3 (font class 8 MiB). Install + enable through the host: 1.03 s. The first build was 57.7 MiB / 24.9 MiB (**fail**) because the frame and backend each shipped CanvasKit and the fonts. Vite now emits WASM and fonts under stable names that the backend reads. | **PASS** (after fix) |
| S6 *(stretch)* Yjs replica | Not run. The editor syncs human edits as `.fig` snapshots instead (plan D4 fallback). | open |

## Human–agent loop (follow-up, same day)

`test/loop.browser.mjs` runs the built editor frame in Chromium under the per-plugin CSP. It talks the real hosted-v2 handshake and MessagePort protocol to a parent page whose `action` calls reach the packaged backend; agent tool calls come from Node. **All steps pass**, with 0 CSP violations, page errors and external requests:

1. The editor loads the backend design (no `fig` yet) and the review panel lists the agent's pending proposal with its preview.
2. The human clicks **Accept** → backend rev 1, and the editor replica shows the screen.
3. The human renames a layer in the editor → the snapshot is synced (`sync`) → backend rev 2.
4. A proposal based on rev 1 (recolor button) is accepted with **field-level rebase** ("rebased onto your edits"). The human's rename survives.
5. Agent and human both rename the same layer → Accept reports **1 conflict (`name`)** in the panel, and nothing is applied (`spike-review-conflict.png`).
6. The human selects the button and clicks **Lock** → the agent's next proposal on it is refused (`node_locked`).
7. The human selects the Email row and clicks **Agent: only selection** → the agent can't touch the title (`out_of_scope`). A scoped proposal is listed and then **rejected** from the panel.
8. **Save .fig** from the toolbar writes `designs/Login-screen.fig` (47 KB).

The backend gained `sync`, `lock`, field preconditions per op (`src/server/rebase.js`), proposal-ID prefixes and 1x previews. The host's pencil policy now allows `sync`/`lock`, and `checkpointActions` includes `sync`. After these changes: 39.8 MiB unpacked, 15.6 MiB tgz, 2.68 MiB initial frame JS; S1 first paint 394 ms.

Evidence:
- `spike-editor-frame.png` (editor frame under the new CSP);
- `spike-login-node.png` (Node backend render);
- `spike-real-model.png` (the real model's accepted design, re-rendered from the saved `.fig`);
- `.cache/spike/s1.json`, `.cache/probe/report.json` (regenerate with the commands below).

## What changed

### Host (`pi-webapp-spike-pencil`, uncommitted)
- **H1** `frame-csp.ts`: the default hosted CSP is byte-identical to before. `'wasm-unsafe-eval'` is added only when the reviewed policy (`browser.wasm`) **and** the manifest (`browser.wasm: true` plus capability `browser.wasm`) both ask. `bridge.ts` uses the per-asset CSP.
- **H2** `resources.ts`: adds `wasm` (16 MiB class), `ttf`/`otf` (font class) and `cjs` (JS class).
- **H3** `state-broker.ts` + `plugin-policies.ts`: workspace files are reviewed policy rules `{extension, binary, maxBytes, createDirectory}`. The default rule reproduces the old `.excalidraw` behavior exactly. Binary rules use base64 `workspace.read`/`commit`, with the same lock, hash, no-replace and fencing path.
- **H4** `tool-result.ts`: an optional `{"$hosted":"tool-result"}` envelope becomes SDK text and image blocks. Limits: ≤ 4 images, ≤ 2 MiB each, PNG/JPEG/WebP signature checked. Everything else keeps the old JSON-text conversion.
- **H7** reviewed `runtime.invokeTimeoutMs` (120 s for pencil).
- **H8 (dev only)**: a reviewed `PENCIL` policy and a `dev-plugins.ts › KNOWN` entry. No production catalog card.
- Tests: new `test/hosted-pencil-spike.test.ts` (6) and `test/hosted-pencil-e2e.test.ts` (1, needs `PI_PENCIL_TGZ`). Updated two assertions that list the known plugin IDs.
- `hosted-*` suites + broker parity: **192 pass, 6 fail, 3 skipped (201)**. All 6 also fail on the untouched base: they need `pi-extensions/packages/github`, which doesn't exist in this checkout (dev-root switch, GitHub e2e, 4 launcher stop/restart tests). Two assertions that list known plugin IDs were updated for pencil.

### Plugin (`packages/pencil`)
- `src/adapter/engine.js` (headless core: fonts, CanvasKit, `.fig` I/O, layout, render, untrusted projection).
- `src/adapter/ops.js` (PencilOp → typed Figma Plugin API; enforces locks and task scope).
- `src/contract/tools.js` (5 tools, flat schemas).
- `src/server/runtime.js` (proposals, human-only actions, CAS state).
- `src/client/*` (Vue frame on `@open-pencil/vue`, hosted handshake).
- Build adapters, all hash/count-checked and failing closed on upstream drift:
  - core `raster/headless.js` and `text/font/bundled.js` resolve through `node_modules`; they are pointed into `dist/`;
  - `elkjs` is stubbed (EPL/GPL);
  - css-tree uses its self-contained data;
  - `undici` is stubbed in the frame;
  - `@acemir/cssom` is aliased to its CJS lib.

## Findings that change the plan

1. **`installTextInkMeasurer` and other HEAD APIs are not in `0.17.0-beta.2`.** The adapter must target the published version, not the repository HEAD.
2. **Core's Node paths ignore its own locators** (`headless.js`, `bundled.js`) and resolve through `node_modules`. Two build adapters are needed for now; both are good upstream PRs (use `setCanvasKitLocator` / `setBundledFontLocator` in Node too).
3. **Importing the published core barrel pulls in jsPDF, html2canvas, mermaid, happy-dom, 10+ locales and `elkjs`.** The frame still fits the budget. P2 should import subpaths only and add a frame license gate (the backend gate exists).
4. **Auto-layout children default to 100 px tall** unless the container hugs. The op adapter defaults horizontal rows to HUG.
5. **Guarded dynamic code in core** (`Function('return true')` probe → `Function(...)` codegen, otherwise the interpreter) was not reached during boot (0 violations). It may produce a CSP *report* if the `.fig` codec ever runs in the frame. The architecture keeps `.fig` parsing in the backend.
6. **The host only installs exact stable versions and checks required capabilities against the manifest.** The spike package is `0.0.1`, kept `private: true`.

7. **Real-model run notes.**
   - `gpt-5.5` is rejected for Codex with a ChatGPT account, so the run used `gpt-5.6-luna`.
   - The preview returned to the agent is stored at 0.5x (195 px wide): too small to judge detail. Render previews at 1x (≤ 1200 px edge).
   - Proposal IDs should be friendlier to type, or the tool should accept prefixes.
   - The user's proxy interrupted the model stream about 7 times (`ERR_INVALID_STATE`); pi retried each time and the turn still finished.

## Open
- **S6 Yjs replica.** Snapshot sync re-exports the whole `.fig` per edit burst (800 ms debounce). That's fine for a few screens but O(document).
- **Upstream undo across replaceGraph.** Reloading after accept or poll clears native undo.
- **Conflicted proposals** should show their own state and an "Ask agent to rebase" action (today they stay listed until the next poll).
- **Composer hand-off (H6)** for "Ask agent about selection"; today the scope is set from the toolbar.
- **Not done:** the agent tool-card frame, a 10-screen heap measurement, and opening the saved `.fig` in Figma (manual, outside the offline constraint).

## Reproduce

```sh
# pi-extensions/packages/pencil
node scripts/node-probe.mjs          # S2/S3/S4 backend half → .cache/probe/
node scripts/build.mjs               # dist + resources.json (prints sizes, patches)
node --test test/runtime.test.mjs    # packaged backend from a temp copy, network denied
node test/csp.browser.mjs            # S1 + browser half of S4 → .cache/spike/
node test/loop.browser.mjs           # human–agent loop in the real frame → .cache/loop/
pnpm pack --pack-destination ../../artifacts
# pi-webapp-spike-pencil
node --import ./test/setup-env.mjs --experimental-strip-types --test test/hosted-pencil-spike.test.ts
PI_PENCIL_TGZ=…/artifacts/chengzhiyi-pi-pencil-0.0.1.tgz node --import ./test/setup-env.mjs --experimental-strip-types --test test/hosted-pencil-e2e.test.ts
# real model (uses your ~/.pi/agent auth via symlink; isolated sessions)
PI_PENCIL_REAL=1 PI_PENCIL_MODEL=gpt-5.6-luna PI_PENCIL_TGZ=… PI_PENCIL_REAL_OUT=…/packages/pencil/.cache/real \
  node --import ./test/setup-env.mjs --experimental-strip-types --test test/hosted-pencil-real.test.ts
```
