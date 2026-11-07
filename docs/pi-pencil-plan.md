# `@chengzhiyi/pi-pencil`: plan

Status: proposal, 2026-11-06. Nothing is implemented yet. Each decision names where it lives: **[host]** = `pi-webapp`, **[protocol]** = `packages/protocol`, **[plugin]** = `packages/pencil`.

Sources read for this plan:

| Codebase | Revision |
|---|---|
| `pi-extensions` | `69f3cbe` |
| `pi-webapp` | `5bb2cab` |
| `open-pencil/open-pencil` | `2fbb4e9` (2026-11-05, version `0.17.0-beta.2`), shallow clone, read only |
| npm tarballs (`canvaskit-wasm@0.41.1`, `@open-pencil/yoga-layout@3.3.0-grid.3`, `harfbuzzjs@1.6.4`, `@hpcc-js/wasm-zstd@1.17.0`, `woff2-encoder@2.0.0`) | Extracted only; nothing was executed |

Status labels used below: **✅ confirmed** in code, **⚠️ partly confirmed / differs from the claim**, **❓ open** (the spike or a later test must answer it).

---

## 0. Verification ledger

### 0.1 open-pencil claims

| Claim | Status | Evidence / nuance |
|---|---|---|
| License is MIT, and this is open-pencil/open-pencil | ✅ | `LICENSE`, `REUSE.toml`. Exception: `packages/cloud/**` and the cloud UI are **Apache-2.0**, which is permissive but not used here. |
| Vue 3 UI | ✅ | Root app `open-pencil-app` (`src/`, 557 `.vue` files, about 134k lines). `@open-pencil/vue` needs `vue ^3.5.41`. |
| CanvasKit (Skia) WASM rendering | ✅ | `packages/core/src/canvaskit.ts` imports `canvaskit-wasm/full` and exposes `setCanvasKitLocator`. The `full/canvaskit.wasm` file is 8,080,104 bytes. |
| Yoga WASM layout | ✅ | `core` depends on `"yoga-layout": "npm:@open-pencil/yoga-layout@3.3.0-grid.3"`, a **fork** with CSS grid. Its WASM is inlined as base64 (`yoga-wasm-base64-esm.js`, 143,881 bytes). |
| `.fig` read **and write** | ✅ | `core/src/io/formats/fig/{read,write}.ts`. Export has a patch mode that keeps the original archive's records (`export/patch`, `originalFigArchive`). There are 28 round-trip test files under `core/tests/io/formats/fig/roundtrip/`. |
| `.fig` round-trip fidelity is good enough | ❓ | The roadmap's fidelity matrix lists gaps: connectors, grid details, prototypes, mixed text runs. Figma itself cannot be run offline. |
| Headless Vue SDK | ⚠️ | `@open-pencil/vue` is "headless" in the sense of **unstyled primitives and composables** (`CanvasRoot`, `LayerTreeRoot`, `useCanvas`…). The polished panels live in the **private app** (`src/components/*`), which is not published. |
| Headless *editor* without UI (Node) | ✅ / ❓ | `createEditor()` from `@open-pencil/core` is used without a DOM in the tests (`bun:test`). The CLI ships `#!/usr/bin/env node`. `core/src` has no Bun-only code. **Running core under Node 24 inside the host's child process has not been run** (spike S2). |
| MCP server | ✅ | `@open-pencil/mcp` provides stdio and HTTP binaries. `eval` is off unless `OPENPENCIL_MCP_EVAL=1` (`mcp/src/tool/policy.ts`). |
| `eval` of Figma Plugin API code | ✅ | `core/src/tools/analyze/eval/index.ts` runs code through `new AsyncFunction(...)` (`eval/wrap.ts:51`). The Figma Plugin API is implemented in `core/src/figma-api/`. |
| Typed tool set | ✅ (not in the claim list) | About 130 `defineTool` tools (127 call sites) with valibot schemas, `execution.mutation` and `capabilities` (`document:write`, `network:access`, `code:execute`, …) in `core/src/tools/schema.ts`. |
| **Hidden code execution** | ⚠️ new finding | The `render` tool (Design JSX) is marked `availability: 'default'`. But `design-jsx/src/render/index.ts:100` runs model-supplied **statements** through `new Function`. `diff_apply` add-hunks carry JSX that goes through the same path. Both are treated as `eval` here. |
| Yjs collaboration | ⚠️ | `packages/collab` (yjs, `graph-sync.ts`, shared-tree CRDT) is **`private: true`**, so it is not on npm. The app's transport is `@trystero-p2p/mqtt` (public brokers) and `y-indexeddb`. |
| Not production-ready | ⚠️ | No page says that literally. README: *"Active development. Usable today, with some rough edges."* Version `0.17.0-beta.2`. Five release sections have "Breaking changes". About 50 commits in the last 30 days. Prototype flows are "Not modeled" (roadmap). Treat it as a pre-1.0 beta. |
| CSP-friendly without `unsafe-eval` | ✅ / ❓ | Kiwi deliberately interprets its schema instead of using `new Function`, "for … a sandboxed plugin host" (`kiwi/src/schema-runtime/interpreter.ts:432`). The CanvasKit, harfbuzz, zstd and Yoga glue contain **no** `Function(` constructors. A full scan of the *built* frame bundle is still open (S1). |
| Offline fonts | ⚠️ | Core bundles Inter, Caveat, Noto Naskh Arabic and emoji metrics. It has **no CJK font**. CJK falls back to host font, then local font, then **Google Fonts** (`text/fallbacks.ts:191`). The seams to avoid that exist: `setHostFontLoader`, `setCJKFallbackFamily`, `setOnlineFontProviders` (`text/font/manager.ts:235-247`). |
| Permissive deps only | ⚠️ | `elkjs` is **EPL-2.0 OR GPL-3.0** and is imported by `core/src/layout/arrange/elk.ts`. It must be kept out of the bundle. Other checked licenses: canvaskit BSD-3, harfbuzzjs MIT, wasm-zstd Apache-2.0, opencc-js MIT+Apache-2.0, yjs, happy-dom, jspdf, pptxgenjs, fontoxpath, unifont and reka-ui are MIT. Fonts are OFL-1.1. |
| Upstream already integrates Pi | ✅ (FYI) | `packages/harness/src/backends/pi.ts` (`@ai-sdk/harness-pi`). This is a desktop agent harness and is not reused here. |

### 0.2 Host (pi-webapp) facts

| Fact | Status | Where |
|---|---|---|
| Hosted frames are served with one fixed CSP: `script-src 'self'`, no `wasm-unsafe-eval` | ✅ | `src/host/server/transport/bridge.ts:213` |
| Resource MIME allowlist has no `.wasm`, `.ttf` or `.otf`. Size classes are JS 16 MiB, font 8 MiB, "other" 2 MiB, total 128 MiB | ✅ | `src/host/server/plugins/hosted/resources.ts` (`RESOURCE_LIMITS`, `mimeByExtension`) |
| Workspace broker is text-only (UTF-8 fatal decode), capped at 512 KiB, and hard-codes `.excalidraw` | ✅ | `state-broker.ts:10,199,211,235` |
| State broker has `session` and `workspace` scope with CAS, 192 MiB per record | ✅ | `state-broker.ts:9,159-162`. The RFC marks this as done. |
| Backend is a forked Node child process with JSON IPC, an allowlisted environment and a default 30 s timeout per invoke. It is not an OS sandbox | ✅ | `runtime-process.ts:9,36,112` |
| Tool results become JSON text only (no image blocks) | ✅ | `integration.ts:82` |
| Every plugin needs a reviewed host policy (tool→action map, readonly flags, frame actions) | ✅ | `plugin-policies.ts`. `validateCandidate` rejects any descriptor drift. |
| No host→frame push. Frames poll `views` every 250 ms and get only `freeze/resume/committed` commands | ✅ | `client/hosted/view-poller.ts`, `contracts/hosted-plugins.ts` (`HostedViewCommand`) |
| Frame→host RPC methods: `action`, `openPanel`, `changed`, `sendMessage`, `abort`, `toolPresentation`, `resize`, `notify`. Host→frame call timeout is 10 s | ✅ | `client/hosted/runtime.tsx:82-87`, `frame-adapter.ts` |
| The iframe has **no `sandbox`** and is same-origin with the host. Isolation is about lifecycle, not security | ✅ | `runtime.tsx:124`, Excalidraw README "not a hostile-code sandbox" |
| A few client paths are Excalidraw-specific: `diagram:` recovery prefix, `view-journal.ts` | ✅ | `runtime.tsx:150`, `view-journal.ts:194,282` |
| Capability methods (`network.fetch`, `sessions.*`) are declaration-gated | ✅ | `capabilities/{declarations,broker}.ts` |
| The protocol package has drifted from the host: the host pins `pi-web-protocol@0.1.1`, the repo is at `0.1.2`, and `HostedBroker` types lack `scope`, `network.*` and `sessions.*` | ✅ | `packages/protocol/src/hosted.ts`, host `package.json:107` |

### 0.3 Reference plugin (pi-excalidraw) patterns to reuse

✅ Confirmed in code:
- Backend serial queue with state CAS around each invocation (`src/server/runtime.ts`).
- Candidate accept/reject with stale-base rejection (`store.ts`).
- Frame handshake that checks origin, source, mount and generation (`frame.tsx`).
- Hash-checked build adapters that fail on upstream drift (`scripts/build.mjs`).
- `resources.json` inventory, `verify`/`independent-build`/`test:csp` scripts.
- Optional `hostUi` negotiation (`FRONTEND.md`).

The Excalidraw build's MIME map has no `.wasm` either. The Shadow DOM probe showed that portals and styles escape, so iframes stay.

---

## 1. Architecture

```
┌──────────────────────────────── pi-webapp host (Node) ──────────────────────────────────┐
│ AgentSession ─ pencil_* tools ─► HostedAgentAdapter ─► HostedPluginManager ─ fork/IPC ─┐ │
│                 (reviewed policy: tool→action, readonly, frame actions)                 │ │
│ Broker: state.* (CAS; session|workspace) · workspace.read/commit (+binary, +list) [H3]  │ │
│         views.signal [H5] · tool result envelope with images [H4]                       │ │
│ HTTP  : /hosted-plugins/<id>/<digest>/…  per-plugin CSP (+'wasm-unsafe-eval') [H1]      │ │
└──────────────▲──────────────────────────────────────────────────────────────────────────┼─┘
               │ broker.call                                     invoke(tool|action)     │
┌──────────────┴────────────────── pi-pencil backend (child process) ◄───────────────────┘
│ runtime.ts → DesignService (one serial queue per design)
│   Gatekeeper: schema → stage gate → locks → task scope → limits → untrusted-content wrapper
│   ProposalStore · BatchStore (checkpoints) · Stage machine        (state CAS, workspace scope)
│   Adapter (the ONLY importer of @open-pencil/*):
│      fig I/O · PencilOp→scene graph · Yoga layout · CanvasKit(Node) PNG/SVG · codegen · tokens
│      Y.Doc binding (vendored collab) · bundled fonts (Inter + Noto Sans SC/JP subsets)
│   Authoritative Y.Doc + SceneGraph per open design (works with NO editor open)
└──────────────▲─────────────────────────────────────────────── signal(docId, rev) ▼
               │ actions: sync / pull / selection / createTask / accept / reject / lock / …
┌──────────────┴──────────────────────────── browser ────────────────────────────────────────┐
│ host page ─MessagePort─ iframe "editor": Vue shell + @open-pencil/vue + core (CanvasKit,   │
│                          Yoga WASM), Y.Doc replica, proposal overlay, stage bar, lock UI,  │
│                          "Ask agent about selection" → composer context chip [H6]          │
│           ─MessagePort─ iframe "tool card": backend PNG preview + Accept/Reject (no WASM)  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Key decisions

| # | Decision | Lives in | Rejected alternatives (why) |
|---|---|---|---|
| D1 | **The authoritative document lives in the plugin backend** (headless `@open-pencil/core` in the Node child). Agent tools run there. Frames are replicas. | plugin | (a) *Frame RPC to the Vue SDK*: does nothing when no editor is open; the host has no push to frames; 10 s frame timeouts; several frames make it ambiguous which one is authoritative; authority would sit in the browser. (b) *Upstream MCP server as host-level MCP*: has its own document store that bypasses the broker, locks and proposals; exposes `eval`, network and filesystem tools; is global to pi instead of scoped to a plugin; needs an extra process or port. (c) *Mix with the frame as executor*: two sources of truth. |
| D2 | **No `eval` and no Design-JSX `render` anywhere.** The agent writes only through a closed, typed **PencilOp** set (§3.2). The adapter turns ops into scene-graph and editor calls. Upstream tools with `code:execute` or `network:access`, plus `render`, `diff_apply`, `set_locked`, `select_*` and `viewport_*`, are never reachable. | plugin | A sandboxed `eval` (SES, QuickJS, `vm`) still runs arbitrary code, can't be reviewed, and the child process is not an OS sandbox. Exposing upstream's ~130 tools directly costs too many model tokens and includes unsafe ones (D2 list). |
| D3 | **Agent writes become proposals.** Tools create a proposal on a forked copy, render before/after PNGs and return. Only a **human action** applies it. When applied, it is re-checked against the *current* document (field-level preconditions, locks, scope) and committed as one batch. | plugin | Merging an agent Yjs branch directly: a CRDT reports no conflicts, so last-writer-wins would silently overwrite human edits, and locks or scope can't be enforced at merge time. Applying immediately with undo afterwards: breaks "the human accepts or rejects". |
| D4 | **Yjs as the replication layer** between the backend and editor frames, using the vendored upstream `collab` scene-graph binding pinned to a commit. Human edits merge field-level. Proposals are **not** Yjs merges (D3). | plugin | Whole-document snapshot sync: O(document) per keystroke, and no field-level merge with concurrent proposals. A home-grown op log: duplicates upstream work. *Fallback if S6 fails:* per-page snapshot sync with hashes. |
| D5 | **Per-plugin browser permission `browser.wasm`.** The host adds `'wasm-unsafe-eval'` (never `'unsafe-eval'`) to that plugin's served resources only, when **both** the manifest and the host's reviewed policy declare it. | host + protocol | Adding it to every hosted frame: violates least privilege. Asm.js or a JS fallback: none exists. A separate origin only for WASM: a bigger change, which stays recommended for later (H10). |
| D6 | **Workspace file rules become policy data** (pattern, binary flag, max size), replacing the hard-coded `.excalidraw`. Excalidraw's policy reproduces today's behavior exactly. | host + protocol | A pencil-only branch in `state-broker`: a plugin workaround. A raw fs capability: too broad. |
| D7 | **Generic host services:** tool-result envelope with images (H4), backend→view `signal` (H5), composer context hand-off (H6), per-plugin invoke timeout (H7). All are negotiated through capability strings and `hostUi`. Frames keep working without them. | host + protocol | A plugin that polls for everything, or a plugin that types into the composer itself, are workarounds. |
| D8 | **Slim editor shell** built from `@open-pencil/vue` primitives, plus a *small* set of vendored MIT panels from the upstream app (layers, properties, color/font pickers, toolbar). Cloud, AI chat, telemetry, P2P, Tauri, updater and donation code are left out. | plugin | Embedding the whole upstream app: size, outbound services, a duplicate BYOK chat that competes with pi, and Tauri assumptions. Writing every panel from scratch: months of work. |
| D9 | **`.fig` is the deliverable.** Plugin metadata (stage states, flow spec, agent locks, token provenance) goes into `.fig` **pluginData** under namespace `pi-pencil`. Proposals, batches and checkpoints stay in host state, not in the file. | plugin | Sidecar `.pencil.json`: two files that can drift. History inside the `.fig`: bloats the file and leaks review history into the deliverable. |
| D10 | **Pin exactly + adapter, don't fork (yet).** Consume the published `@open-pencil/{core,scene-graph,fig,kiwi,vue}` at exact versions. Vendor only what isn't published (`collab`, a few app panels) with a provenance file. Use hash-checked build adapters as Excalidraw does. | plugin | Forking now: upstream churns too much (about 50 commits a month, breaking releases). Fork triggers are in §7. |
| D11 | **Stage gates and locks are backend-enforced and human-only.** Approve-stage, lock/unlock, accept/reject, save and export-run exist only as frame **actions** (`kind:"action"`), never as tools. The host policy keeps tool→action maps separate, and the runtime rejects `kind:"tool"` for these. | plugin + host policy | Asking the agent to respect stages in its prompt: prompt injection can defeat it. |
| D12 | **Selection reaches the agent through a human-created scoped Task.** The frame records the selection (`selection` action). "Ask agent about these" creates a Task `{taskId, nodeIds}` and pre-fills the composer with a context chip `pencil:task/<id>`. Proposals that carry `taskId` are rejected if any op touches a node outside that subtree. | plugin + host (H6) | The agent reading "current selection" freely (racy, and the scope isn't enforced). The frame auto-sending a message (the user didn't press send). |
| D13 | **Fonts are bundled and online providers are disabled.** Inter (from core) plus Noto Sans SC and JP **subsets** (OFL), served from the plugin origin through `setHostFontLoader`. `setOnlineFontProviders({all:false})`. The backend reads the same files from `dist/`. | plugin (+H2 MIME) | System fonts through Local Font Access: different on every machine, and needs a permission prompt. Google Fonts: offline is a requirement. |
| D14 | **The tool card is light:** a PNG preview rendered by the backend, plus Accept/Reject/Open. It has no CanvasKit. The full editor is a panel. | plugin | An editor inside every tool card: tens of MB per card. |

### 1.2 Data flows

- **Agent creates a screen with no editor open.**
  1. `pencil_open` loads the `.fig` through `workspace.read` (binary) into the backend.
  2. `pencil_propose_changes` validates, applies to a fork, runs Yoga layout, renders PNGs and stores the proposal.
  3. The tool result carries a summary plus a preview image (H4). The tool card shows Accept/Reject.
  4. The `accept` action applies the batch, bumps the revision and `signal`s any open frames.
- **Human edits.** The frame applies the edit locally (native undo) and pushes the Yjs update with the `sync` action, debounced to about 150 ms. The backend validates, applies, increments `rev`, persists, and signals other frames. Each frame `pull`s with its state vector.
- **Concurrent edit during a pending proposal.** Nothing is merged until the human accepts. On accept, each op's preconditions are checked:
  - Matching ops apply.
  - Conflicting ops are listed. The UI offers "Accept non-conflicting", "Ask agent to rebase" (pre-fills a message with the conflict summary) or "Reject".
- **Save.** A human action. The adapter exports a `.fig` (patch mode when the file was opened from disk) and calls `workspace.commit` with `expectedHash`. On `409` the UI offers "Reload from disk (current state kept as a checkpoint)" or "Save as…". It never overwrites.

---

## 2. Change lists

### 2.1 Host (`pi-webapp`)

| ID | Change | Notes / tests |
|---|---|---|
| H1 | **Per-plugin CSP.** `host.hosted.asset()` returns `{bytes, mime, csp}`. `bridge.ts` uses `csp` instead of the literal. The policy builder adds `'wasm-unsafe-eval'` to `script-src` only if `manifest.browser.wasm === true` **and** `policy.browser?.wasm === true` **and** the capability `browser.wasm` is declared. The parent page CSP is unchanged. | Test: Excalidraw headers are byte-identical to today's; pencil frame, worker and JS responses carry the extra token; a package that declares it without policy is rejected at install. |
| H2 | **Resource validator:** add `wasm → application/wasm` with a new size class `wasm: 16 MiB`, plus `ttf → font/ttf` and `otf → font/otf` in the font class. Keep the per-file font cap at 8 MiB and total at 128 MiB. | CanvasKit full is 8.08 MB and so exceeds the current "other" cap. |
| H3 | **Generic workspace rules.** Policy gets `workspace.files: [{pattern, binary, maxBytes}]`. `fileTarget` matches the pattern instead of `.endsWith(".excalidraw")`. `workspace.read`/`commit` accept `encoding:"base64"` for binary rules. Per-rule max is up to 64 MiB, under the 192 MiB IPC cap. Add `workspace.list {pattern, limit≤500}` returning `{path, bytes, mtime, hash?}`, read-only and policy-filtered. | Excalidraw policy = `[{pattern:"**/*.excalidraw", binary:false, maxBytes:524288}]`, so behavior is unchanged. Re-run existing symlink, fencing and no-replace tests per rule. |
| H4 | **Tool result envelope.** If the runtime returns `{"$hosted":"tool-result", content:[…], details}`, the integration maps it to SDK content blocks. Images: png/jpeg/webp, at most 4, at most 2 MiB each, dimensions checked. Anything else keeps today's `JSON.stringify` path. | Lets the agent see its own renders. Gated by capability `tool.images`. |
| H5 | **`views.signal`** broker method `{contentId?, data ≤ 4 KiB}`. It appends a `HostedViewCommand {type:"signal", data}` to that plugin's views in the invocation's session or workspace, and the poller forwards it as a frame RPC `signal`. It grants no authority. | Rate-limit to 20/s per plugin. Gated by `views.signal` and `hostUi.signals`. |
| H6 | **Composer context.** Frame UI request `composeMessage {text, context?: {label, ref}}`. The host pre-fills the composer and shows a removable chip. When the user sends, the chip text (`[pencil:task/abc] 3 layers in "Login"`) is appended. Never auto-sent. | `hostUi.composer`. Existing `sendMessage` stays. |
| H7 | **Reviewed invoke timeout:** `policy.runtime.invokeTimeoutMs` (default 30 s, max 180 s), passed to `supervisor.invoke`. | Rendering and export of multi-screen proposals. |
| H8 | **Catalog and policy for pencil:** `plugin-policies.ts` (tools, readonly actions, frame actions, checkpoint actions, `browser`, `workspace`, `runtime`), `official-catalog.ts` entry, `PluginIcon` key `"design"`, `HostedPluginCard.icon` union. Remove the Excalidraw-only bits: `runtime.tsx:150` must use `contribution.panelAlias.prefix`, and `view-journal` must stay inert for other plugins. | The dev-root install (`PI_WEBAPP_HOSTED_DEV_ROOTS`) already works for the spike once a policy exists. |
| H9 | Refresh the vendored `@chengzhiyi/pi-web-protocol` and advertise the new strings in `package.json › piWebappHostedRuntime.capabilities`. | Hosts without them simply don't offer the plugin, through the existing `requiredCapabilities` check. |
| H10 *(later, recommended)* | Serve hosted frames from a separate loopback origin so a plugin frame can't reach `parent.document`. | Not required for pencil. Raises the security floor for every plugin. |

### 2.2 Protocol (`packages/protocol`), all additive (API 2, runtime protocol 1 unchanged)

| ID | Change |
|---|---|
| P1 | `HostedPluginManifest` optional fields: `browser?: {wasm?: boolean}`, `workspace?: {files: HostedWorkspaceRule[]}`, `runtime?: {invokeTimeoutMs?: number}`. `isHostedPluginManifest` validates them, and stays strict when they are absent. |
| P2 | Capability constants `HOSTED_CAPABILITIES = {wasm:"browser.wasm", binaryFiles:"workspace.binary", signals:"views.signal", toolImages:"tool.images", composer:"composer.context"}`. |
| P3 | `HostedBroker.call` method union adds `workspace.list` and `views.signal`, with typed inputs. State inputs document `scope?: "session"\|"workspace"` (the host already supports it). Mirror `network.fetch`/`sessions.*` to close the 0.1.1/0.1.2 drift. |
| P4 | `HostedToolResult` envelope type plus `isHostedToolResult()`. |
| P5 | `HostedViewMount.hostUi` adds `signals?: true` and `composer?: true`. `HostedUiRequest` adds `composeMessage`. Frame RPC adds `signal`. |
| P6 | Tests in `protocol.test.mjs` for every guard. Bump `0.2.0`. |

### 2.3 Plugin (`packages/pencil`)

```
packages/pencil/
  package.json            # manifest §3.1; exact pins; no runtime deps
  scripts/build.mjs       # esbuild backend (node24) + Vite frame (Vue SFC) + resources.json
  scripts/license-gate.mjs# fails on non-allowlisted licenses in metafiles (elkjs, GPL…)
  scripts/adapters/*.mjs  # hash-checked upstream patches (stub elkjs, drop online fonts)
  scripts/{verify,independent-build}.mjs   # as excalidraw
  src/contract/           # PencilOp, flow, token schemas + validators (pure TS, no upstream)
  src/server/runtime.ts   # createRuntime; queue; CAS; kind:"tool"|"action" routing
  src/server/gate.ts      # stage gate, locks, task scope, limits, untrusted wrapper
  src/server/{proposals,batches,designs,files}.ts
  src/adapter/            # ONLY place importing @open-pencil/*
     fig.ts ops.ts project.ts layout.ts render.ts codegen.ts tokens.ts fonts.ts ydoc.ts
  src/client/frame.ts     # handshake/RPC (port of excalidraw frame.tsx, instance-scoped)
  src/client/editor/      # Vue shell on @open-pencil/vue + vendored panels
  src/client/review/      # proposal overlay, conflict list, stage bar, lock toggles, history
  src/client/toolcard/    # PNG preview + accept/reject (no CanvasKit)
  vendor/open-pencil/     # collab subset + panels, PROVENANCE.md (commit, files, sha256)
  assets/fonts/           # Noto Sans SC/JP subsets (OFL) + OFL.txt
  test/                   # §5
```

---

## 3. Manifest, tools, data model

### 3.1 Manifest draft (`package.json`)

```jsonc
{
  "name": "@chengzhiyi/pi-pencil", "version": "0.1.0", "type": "module", "license": "MIT",
  "main": "./dist/runtime.js",
  "files": ["dist", "LICENSE", "NOTICE.txt", "README.md"],
  "piWebapp": {
    "apiVersion": 2, "hostRange": ">=0.2.0", "runtimeProtocol": 1,
    "backend": { "entry": "./dist/runtime.js" },
    "frontend": { "document": "./dist/frame.html", "controller": "./dist/frame.html" },
    "resourcesManifest": "./dist/resources.json",
    "dataSchemaVersion": 1, "supportedDataSchemas": [1],
    "capabilities": ["state", "workspace", "panels", "messages",
                     "browser.wasm", "workspace.binary", "views.signal", "tool.images", "composer.context"],
    "browser": { "wasm": true },
    "workspace": { "files": [
      { "pattern": "**/*.fig", "binary": true, "maxBytes": 67108864 },
      { "pattern": "design-exports/**/*.{png,svg}", "binary": true, "maxBytes": 16777216 },
      { "pattern": "design-exports/**/*.{html,css,tsx,ts,json,md}", "binary": false, "maxBytes": 2097152 }
    ]},
    "runtime": { "invokeTimeoutMs": 120000 }
  }
}
```

The host policy (H8) holds a reviewed copy of `browser`, `workspace` and `runtime`. A package can only **narrow** them.

### 3.2 Agent tools

Every schema is a flat object. There is no recursive `$ref` and there are no tuple arrays (lesson from Excalidraw ORI-55). Node trees are flat lists that link through `parent`. Every tool returns `status`/`reason` on error (`stage_locked` 423, `node_locked` 423, `out_of_scope` 403, `stale_base` 409, `invalid_op` 400, `too_many_pending` 429). Design-derived strings always come back inside `untrusted: {…}` with length caps.

| Tool | action | readonly | Purpose |
|---|---|---|---|
| `pencil_read_me` | `reference` | ✓ | PencilOp format, stage rules, design-quality checklist, token naming, examples. |
| `pencil_status` | `status` | ✓ | Designs, stages, pending proposals, **current Task scope and selection**, lock summary. |
| `pencil_open` | `open` | – | Open a `.fig` or create a design. Changes no file. |
| `pencil_inspect` | `inspect` | ✓ | Compact projection of nodes, tokens, components and layout. |
| `pencil_render` | `render` | ✓ | PNG of a node or proposal (image block through H4). |
| `pencil_lint` | `lint` | ✓ | Upstream lint plus token adherence, contrast, overflow and overlap checks. |
| `pencil_propose_flow` | `flow` | – | Stage 1 proposal. |
| `pencil_propose_tokens` | `tokens` | – | Stage 2 proposal (needs the flow stage approved). |
| `pencil_propose_changes` | `propose` | – | Stage 3 screens and edits (needs tokens approved). |
| `pencil_propose_export` | `export` | – | Stage 4 export plan. Files are written only on the human `export.run` action. |
| `pencil_withdraw` | `withdraw` | – | The agent withdraws its own pending proposal. |

Schemas (TypeBox-style, as in `excalidraw/src/server/schema.ts`):

```ts
const id    = Str({ pattern: "^[A-Za-z0-9:;_-]{1,64}$" });                 // upstream GUID "12:34" or ref
const ref   = Str({ pattern: "^\\$[a-z][a-z0-9_]{0,31}$" });                // "$card" — new node in this batch
const token = Str({ pattern: "^\\{[a-z0-9]+(\\.[a-z0-9-]+){0,4}\\}$" });     // "{color.primary.500}"
const paint = Union([Str({ pattern: "^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$" }), token]);
const num   = (min: number, max: number) => Num({ minimum: min, maximum: max });
const sides = Obj({ top: Opt(num(0, 512)), right: Opt(num(0, 512)), bottom: Opt(num(0, 512)), left: Opt(num(0, 512)) });
const props = Obj({
  name: Opt(Str({ maxLength: 120 })), x: Opt(num(-1e5, 1e5)), y: Opt(num(-1e5, 1e5)),
  width: Opt(num(0, 2e4)), height: Opt(num(0, 2e4)),
  sizingH: Opt(Enum(["FIXED", "HUG", "FILL"])), sizingV: Opt(Enum(["FIXED", "HUG", "FILL"])),
  layout: Opt(Obj({ mode: Enum(["NONE", "HORIZONTAL", "VERTICAL", "GRID"]), gap: Opt(Union([num(0, 512), token])),
    padding: Opt(sides), align: Opt(Enum(["MIN", "CENTER", "MAX", "STRETCH", "BASELINE"])),
    justify: Opt(Enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"])), wrap: Opt(Bool()),
    columns: Opt(Int({ minimum: 1, maximum: 24 })) })),
  fill: Opt(paint), stroke: Opt(Obj({ paint, weight: num(0, 64), align: Opt(Enum(["INSIDE", "CENTER", "OUTSIDE"])) })),
  radius: Opt(Union([num(0, 1000), token])), opacity: Opt(num(0, 1)), clip: Opt(Bool()), visible: Opt(Bool()),
  shadow: Opt(Union([token, Obj({ color: paint, x: num(-200, 200), y: num(-200, 200), blur: num(0, 400), spread: Opt(num(-200, 200)) })])),
  text: Opt(Obj({ content: Str({ maxLength: 5000 }), style: Opt(token),
    font: Opt(Obj({ family: Str({ maxLength: 80 }), style: Opt(Str({ maxLength: 40 })), size: Opt(num(1, 400)) })),
    color: Opt(paint), align: Opt(Enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"])),
    autoResize: Opt(Enum(["NONE", "HEIGHT", "WIDTH_AND_HEIGHT", "TRUNCATE"])), maxLines: Opt(Int({ minimum: 1, maximum: 100 })) })),
  component: Opt(id),                                   // for INSTANCE: main component id
});
const op = Union([
  Obj({ op: Lit("create"), ref, parent: Union([id, ref]), index: Opt(Int({ minimum: 0 })),
        type: Enum(["FRAME", "TEXT", "RECTANGLE", "ELLIPSE", "LINE", "SECTION", "COMPONENT", "INSTANCE", "ICON"]),
        icon: Opt(Str({ pattern: "^[a-z0-9-]+:[a-z0-9-]+$" })),     // bundled offline icon sets only
        props: Opt(props) }),
  Obj({ op: Lit("update"), id, props }),
  Obj({ op: Lit("move"),   id, parent: Union([id, ref]), index: Opt(Int({ minimum: 0 })) }),
  Obj({ op: Lit("duplicate"), id, ref, parent: Opt(Union([id, ref])) }),
  Obj({ op: Lit("delete"), id }),
]);

pencil_propose_changes: Obj({
  docId: id, baseRev: Int({ minimum: 0 }), taskId: Opt(id),
  title: Str({ minLength: 1, maxLength: 120 }), rationale: Opt(Str({ maxLength: 2000 })),
  page: Opt(Union([id, Obj({ create: Str({ maxLength: 80 }) })])),
  ops: Arr(op, { minItems: 1, maxItems: 300 }),
});
pencil_propose_flow: Obj({ docId: id, baseRev: Int({ minimum: 0 }), title: Str({ maxLength: 120 }),
  screens: Arr(Obj({ key: ref, name: Str({ maxLength: 80 }), purpose: Str({ maxLength: 400 }),
    entry: Opt(Bool()), states: Opt(Arr(Str({ maxLength: 40 }), { maxItems: 8 })) }), { minItems: 1, maxItems: 40 }),
  transitions: Arr(Obj({ from: ref, to: ref, trigger: Str({ maxLength: 120 }), condition: Opt(Str({ maxLength: 200 })) }), { maxItems: 120 }),
});
pencil_propose_tokens: Obj({ docId: id, baseRev: Int({ minimum: 0 }), modes: Arr(Str({ pattern: "^[a-z][a-z0-9-]{0,23}$" }), { minItems: 1, maxItems: 4 }),
  tokens: Arr(Obj({ name: Str({ pattern: "^[a-z0-9]+(\\.[a-z0-9-]+){1,4}$" }),
    type: Enum(["color", "dimension", "number", "fontFamily", "fontWeight", "typography", "shadow"]),
    values: Obj({}, { additionalProperties: Union([Str({ maxLength: 200 }), Num()]) }),   // mode → value
    description: Opt(Str({ maxLength: 200 })) }), { minItems: 1, maxItems: 400 }),
});
pencil_inspect: Obj({ docId: id, nodeIds: Opt(Arr(id, { maxItems: 100 })), pageId: Opt(id),
  depth: Opt(Int({ minimum: 0, maximum: 8 })), include: Opt(Arr(Enum(["layout", "style", "text", "tokens", "components"]))) });
pencil_render: Obj({ docId: id, nodeId: Opt(id), proposalId: Opt(id), scale: Opt(num(0.25, 3)), maxEdge: Opt(Int({ minimum: 64, maximum: 2048 })) });
pencil_propose_export: Obj({ docId: id, baseRev: Int({ minimum: 0 }), dir: Str({ pattern: "^design-exports(/[A-Za-z0-9_-]{1,40}){0,3}$" }),
  targets: Arr(Obj({ nodeId: id, format: Enum(["png", "svg", "html", "react-tailwind", "tokens-css", "tokens-json"]), scale: Opt(num(0.5, 4)) }), { minItems: 1, maxItems: 60 }) });
```

Result of every `propose_*`: `{proposalId, status:"pending_review", stage, opCount, touched:[ids], warnings:[], message}` plus a before/after PNG (H4). The message says plainly that **nothing is applied until the user accepts**.

**Human-only frame actions** (policy `actions`; the runtime rejects them with `kind:"tool"`): `list, new, open, get, focus, sync, pull, selection, createTask, accept, acceptPartial, reject, approveStage, reopenStage, lock, unlock, restoreBatch, history, save, saveAs, export.run, workspaceList`. `checkpointActions = ["sync", "get", "list", "history"]`.

### 3.3 Data model

```ts
// workspace-scope state key `design.<docId>` (CAS on revision)
interface DesignRecord {
  schema: 1; docId: string; title: string;
  file: { path: string | null; diskHash: string | null; savedRev: number | null };
  rev: number;                                   // monotonic domain revision
  yState: string;                                // base64 Y.encodeStateAsUpdate, compacted on save
  stages: Record<"flow" | "tokens" | "screens" | "export", { state: "open" | "approved"; approvedRev?: number; at?: string }>;
  locks: string[];                               // node GUIDs, subtree locks (mirrored to pluginData)
  tasks: Task[];                                 // human-created scopes, max 50 open
}
interface Task { id: string; nodeIds: string[]; createdRev: number; sessionId: string; status: "open" | "done" | "cancelled" }
// workspace-scope key `proposals.<docId>`
interface Proposal {
  id: string; docId: string; sessionId: string; stage: Stage; title: string; rationale?: string;
  baseRev: number; taskId: string | null; ops: PencilOp[];
  preconditions: { opIndex: number; nodeId: string; field: string; hash: string }[]; // values the agent saw
  dependsOn: number[][];                          // per op: indices it needs (ref chains) → partial accept
  preview: { before?: string; after?: string };   // state keys of PNG blobs (bounded, GC on decide)
  status: "pending" | "accepted" | "partial" | "rejected" | "withdrawn" | "superseded";
  conflicts?: { opIndex: number; reason: "changed" | "deleted" | "locked" | "out_of_scope" }[];
  decided?: { at: string; rev: number };
}
// workspace-scope key `history.<docId>` (ring of 200; older collapsed into snapshot checkpoints)
interface Batch {
  id: string; proposalId: string | null; kind: "agent" | "restore" | "import";
  appliedRev: number; inverse: PencilOp[];        // computed at apply time
  preImages: Record<string, string>;              // nodeId → serialized subtree (bounded 2 MiB)
  postHashes: Record<string, string>;             // for safe restore
  restoredBy?: string;
}
// session-scope key `session`
interface SessionView { focusedDocId: string | null; selection: { docId: string; nodeIds: string[]; rev: number } | null }
// .fig pluginData namespace "pi-pencil" (travels with the file)
interface FigMeta { schema: 1; stages: DesignRecord["stages"]; locks: string[]; flow?: FlowSpec; tokenSource?: string }
```

**Rules:**
- **Locks** apply to the subtree. An op is rejected if it targets, re-parents into or out of, or deletes an ancestor of a locked node. Figma's own `locked` flag also counts as an agent lock.
- **Task scope:** every touched node must be a descendant of `task.nodeIds`, and new nodes must be created under them.
- **Restore** applies `inverse` if `postHashes` still match. Otherwise it shows a diff and offers "force restore pre-image subtree". A restore is itself a batch, so it can be restored too.
- **Native undo** (Y.UndoManager scoped to local origin) resets on reload; the host already warns about this. **Batch history** survives reloads and host restarts.
- **Storage growth.** Base64 `yState` and PNG blobs are fine for the MVP; the 192 MiB state cap is far away. A generic content-addressed `blob` broker capability is a candidate for later.

---

## 4. Safety

1. **No code execution.** There is no `eval`, `render`, `diff_apply` or `new Function` on any agent path. The build adds a static scan of `dist/runtime.js` and frame chunks that lists every `Function(`/`eval(` site, compared against a reviewed allowlist. It fails on anything new, as Excalidraw's ORI-30 scan does.
2. **No ambient network in the backend.** The child process is not sandboxed, so the adapter never imports icon, stock-photo or web-font code paths. The `elkjs`/`arrange` modules are stubbed so they throw. Tests replace `fetch`, `http(s).request` and `net.connect` with throwing stubs and assert they are never called. The frame's `connect-src 'self'` covers the browser side.
3. **Prompt injection carried in design content.**
   - Text, names, comments, pluginData and component descriptions from opened files reach the model only inside `untrusted` fields. They are capped at 200 characters per string by default (`include:["text"]` raises the cap to 2,000) and at 32 KiB per result.
   - Tool descriptions say these fields are data, not instructions.
   - Rendered images carry the same risk. The mitigation is authority, not filtering: every write is a proposal, stages, locks and accept are human-only actions, and task scope is enforced on the server. The agent has no tools for network, code, the arbitrary filesystem or other plugins.
   - The frame never sends a message by itself (H6 only pre-fills the composer).
4. **Resource limits:**
   - per proposal: ≤ 300 ops, ≤ 2,000 created nodes, ≤ 5 pending per document per session;
   - per render: ≤ 2,048 px edge, ≤ 4 images per result;
   - layout: Yoga runs with a node-count cap.
5. **Trust boundary, stated honestly:** this is a reviewed official plugin running in a same-origin iframe and an unsandboxed child process, just like Excalidraw. H1 is defense in depth for the frame's own document. H10 raises the floor for every plugin later.

---

## 5. Feasibility spike (2–3 days, branches `spike/pencil` in both repos)

**Setup (½ day).**
- Host: H1 behind `PI_WEBAPP_HOSTED_WASM_PLUGINS=@chengzhiyi/pi-pencil`; H2 (`.wasm`, `.ttf`); a temporary binary `workspace.*` branch for `.fig`; a minimal pencil policy.
- Plugin: skeleton with a backend that runs `@open-pencil/core@0.17.0-beta.2` (exact pin) and a Vue frame with `CanvasRoot` and a basic toolbar. Installed through `PI_WEBAPP_HOSTED_DEV_ROOTS`.

| # | Test | Pass | Fail → action |
|---|---|---|---|
| S1 | **Editor boot under the new CSP.** Playwright on the packed tgz, served with the real per-plugin header (same harness as `test:csp`). | Canvas renders a frame with text; pan, zoom and select work; **0** CSP violations, page errors and external requests. **Control 1:** the same build under today's CSP fails with a WASM CSP error (the permission is necessary). **Control 2:** no `'unsafe-eval'` anywhere (it is sufficient). Static scan of the built chunks finds no unreviewed `Function(`. Cold boot to first paint ≤ 3 s on localhost (Apple silicon). | Needs `unsafe-eval` → find the call site and add a hash-checked build adapter; if impossible, stop and escalate (no policy widening). |
| S2 | **Agent creates an auto-layout screen.** A real pi session with the prompt "Design a mobile login screen". | Within ≤ 4 tool calls the agent produces a valid `pencil_propose_changes`. Expected screen: vertical auto-layout 390×844, padding 24, gap 16, inputs `sizingH:FILL`, button `HUG`. The backend (Node 24 child) computes Yoga layout and returns a PNG. After the human accepts, the open frame shows it within ≤ 1 s of the signal or poll. Node and browser bounds match within 0.5 px per node. No overlaps flagged by `analyze_overlaps`. Also passes with **no editor open**. | Core won't run under Node → try `--experimental-*`-free bundling with node conditions; if still blocked, fall back to the controller-frame executor, with "editor must be open" as a documented limitation. |
| S3 | **`.fig` save and reload.** | Save through the binary `workspace.commit` with `expectedHash`, then reload from disk in a fresh backend. The structural projection (types, names, layout, fills, text) is equal and a PNG pixel diff is ≤ 0.1 %. Upstream's CLI reader (`openpencil tree`) parses the file independently. One real Figma-made fixture from upstream's test corpus opens, saves and reopens with an equal projection. Changing the file externally before save → `409`, no overwrite. | Projection drift → narrow to the supported subset and file upstream issues; drift on our own files is a blocker. |
| S4 | **CJK text.** "登录 / 忘记密码？/ ログイン" in the frame and in the Node render. | All glyph IDs ≠ 0 (no tofu). Frame canvas vs Node PNG diff ≤ 1 %. Auto-width text measures the same on both sides (≤ 0.5 px). **0** requests to `fonts.googleapis.com`/`gstatic`. The font comes from the plugin origin. Saved `.fig` keeps the family name. | Tofu → check CanvasKit WOFF2 support and use TTF; mismatch → force the same font buffers on both sides. |
| S5 | **Bundle size** (measured on the packed tgz). | Unpacked ≤ 45 MiB; tgz ≤ 20 MiB; every file within the H2 limits; initial frame JS ≤ 4 MiB raw; tool-card frame (no CanvasKit) ≤ 300 KiB; frame heap ≤ 300 MB with a 10-screen document. Report a breakdown: wasm / JS / fonts / other. | Over budget → subset fonts to GB2312 + JIS level 1, lazy-load panels, try the non-`full` CanvasKit build (needs a core locator patch). |
| S6 *(stretch)* | Yjs replica: the vendored `collab` binding runs headless in Node, and frame↔backend sync converges after concurrent edits. | 100 random concurrent edits converge; the backend `rev` equals the frame's state vector. | Switch to D4's fallback (per-page snapshot sync). |

**Exit:** a short report in `packages/pencil/SPIKE.md` with numbers, screenshots, the CSP header and the static-scan output. GO requires S1–S5 to pass.

---

## 6. Roadmap (person-days, with ranges)

| Phase | Scope | Host | Protocol | Plugin |
|---|---|---|---|---|
| P0 Spike | §5 | 1 | 0.25 | 1.5–2 |
| P1 Platform generics | H1–H5, H7, H9, P1–P6, Excalidraw regression | 6–8 | 1.5 | – |
| P2 MVP: screens | Shell + vendored panels, adapter, PencilOps, proposals with previews, tool card, open/save `.fig`, fonts, H8 policy and catalog | 1–2 | – | 12–15 |
| P3 Collaboration safety | Yjs replica, locks, Tasks + H6, stage machine, batches/restore, conflict UI, partial accept | 2 | 0.5 | 9–11 |
| P4 Flows, tokens, export | Flow page renderer, token collections ↔ variables, tokens CSS/JSON, PNG/SVG/HTML/React-Tailwind export as proposals, lint plus render feedback loop in `read_me` | 1 | – | 8–10 |
| P5 Hardening and release | Fidelity corpus, performance (500-node pages), zh/en, a11y of panels, upgrade/freeze paths, upstream bump drill, publish through the existing release scripts, host E2E | 3 | 0.25 | 6–8 |
| **Total** | | **14–17** | **≈2.5** | **37–46** |

### 6.1 Test strategy

| Layer | What runs |
|---|---|
| Contract (pure TS, fast) | PencilOp, flow and token validators; gate (stage, locks, scope, limits); precondition rebase; inverse ops; CAS conflicts; `kind:"tool"` vs `"action"` routing; untrusted-wrapper caps. Property tests: random op sequences + random human edits → accept never touches a locked or out-of-scope node, and `restore(apply(x)) == x` when nothing else changed. |
| Adapter golden (Node) | `.fig` round-trip corpus (our fixtures + upstream oracles): projection equality and a pixelmatch threshold. Layout snapshots. CJK and Arabic renders. Codegen snapshots (HTML, React-Tailwind). Network-deny stubs on every test. License gate and Function-scan on the build output. |
| Runtime with fake broker | Same pattern as Excalidraw `runtime.test.ts`: restart, legacy-free init, binary file hash conflicts, generation fencing, signal emission. |
| Browser (Playwright, real CSP, packed tgz) | `test:csp` (S1 kept as a regression), frame handshake and lifecycle (flush/freeze/dispose), Yjs sync, proposal overlay accept/reject, lock toggles, task chip, tool card. |
| Host | H1–H7 unit tests; Excalidraw header and behavior unchanged; `test/hosted-*-e2e` covering install → tool call → accept → save → restart → restore batch. |
| Agent evals (manual + scripted, per release) | 10 prompts (login, onboarding, settings, dashboard, e-commerce PDP, CJK app…), scored for stage compliance, lint findings, overlap count and token adherence. |
| Upstream bump drill | `pnpm pencil:upstream-check <version>` runs the golden suites against a candidate pin before any bump. |

---

## 7. Main risks

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Upstream churn (beta, frequent breaking releases) | High / High | Exact pins, a single adapter module, hash-checked build adapters, golden suites, monthly bump drill. **Fork triggers:** more than 3 patches needed, two consecutive minors breaking the golden suites, or `collab` internals moving without a public API. |
| `.fig` fidelity on real Figma files (connectors, grid, prototypes, mixed text runs) | High / Med | Use patch-mode export for opened files; show an "unsupported features" notice on open (from the roadmap matrix); never claim Figma parity; keep the original file's hash so "Save as" is the default for imported files. |
| Core under Node 24 in the child process | Med / High | S2 decides. Fallback: a controller-frame executor, with "editor must be open" documented. |
| `collab` is private and may change | Med / Med | Vendor with provenance; D4 fallback (snapshot sync). |
| Bundle size and memory (CanvasKit 8 MB + CJK fonts) | Med / Med | S5 budgets, font subsets, lazy panels, light tool cards (D14). |
| Prompt injection through imported designs | Med / Med | §4: authority model + untrusted wrapper + no dangerous tools. |
| Agent quality falls short of "close to Figma" | Med / High | Render + lint feedback loop (H4 images), token-first workflow, a curated `read_me` with layout recipes, the eval suite in P5. |
| Same-origin, unsandboxed frame | Low (reviewed official plugin) / High | H10 later; keep the plugin reviewed and in the official catalog only. |
| License creep (elkjs EPL/GPL, future deps) | Med / Med | License gate on the esbuild/Vite metafiles; NOTICE generation as Excalidraw does. |
| Base64 binary over JSON IPC (+33 %) for large `.fig` | Low / Low | 64 MiB rule cap; a streaming or blob capability later if needed. |

### Open items to settle in the spike or in P2

S1 bundle `Function(` scan · S2 Node runtime · S4 WOFF2 vs TTF in CanvasKit · S6 headless `collab` · whether upstream editor undo can be scoped to Yjs local origin · pluginData round-trip of the `pi-pencil` namespace (test exists upstream: `plugin-data.test.ts`, not yet run by us) · Figma-desktop acceptance of saved files (manual, outside the offline constraint).
