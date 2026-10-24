# Production CSP font fix (ORI-30)

## Root cause and decision

Excalidraw 0.18.1 `chunk-EIO257PC.js` contains Emscripten named-function and dynCall constructors (`new Function`), WOFF2 codec WASM and Harfbuzz WASM compilation. Replacing only the two JS constructors would still fail under `script-src 'self'` without `wasm-unsafe-eval`. No host policy expansion was approved or made.

The build therefore deliberately replaces the shared subset module (used by both worker and main-thread fallback) with full-font embedding. Its four minified exports retain the upstream command/base64/binary API. The binary API checks WOFF2 signature and exact encoded file length, then returns the original bytes unchanged; base64 is chunked to avoid large spread argument limits. The upstream font selection still chooses unicode-range partitions matching the text. This disables *glyph subsetting*, not fonts, Chinese support, SVG embedding or native exports. There is an explicit once-per-realm console info diagnostic. Malformed fonts fail, rather than silently returning degraded output.

A second checked patch removes the upstream CDN fallback from font source lists. Real HTTP CSP testing found that merely registering those fallback URLs triggered font-src violations, even with valid local fonts. Local `EXCALIDRAW_ASSET_PATH` remains mandatory. Both patches check SHA-256 of exact upstream files, exact replacement count and successful loading at build end. They do not edit node_modules, patch arbitrary errors or change host headers.

## Regression and commands

Run from `packages/excalidraw` with the existing offline dependency tree:

```
npm run check
npm run build
npm test
npm run test:browser
npm run test:independent
npm run verify
npm run test:csp
```

`test:csp` uses the exact packed archive, extracted to a temporary directory, with no runtime node_modules. It serves all frame, worker, JS, CSS and font responses with the hosted asset handler's production CSP:

```
default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'
```

No browser route fulfillment/interception supplies resources. The HTTP server exists only during the test and is closed in finally. An in-memory MessagePort host fixture supplies a real native scene containing Chinese and Latin text. The real tool view exports an embedFonts SVG; each embedded WOFF2 must equal an original packaged font partition and pass the browser FontFace decoder. A real editor uses its native menus to download PNG and `.excalidraw`; PNG signature/size and source text are checked. The test disables the OS file picker before startup to select Excalidraw's own browser-download fallback. No production code or exported functions are injected into the frame. The test inspects the SVG blob from the parent realm because frame `connect-src 'self'` intentionally disallows blob fetch.

Observed Chromium result: 362,345-byte SVG, six exact embedded font partitions, 11,493-byte PNG, source download preserving Chinese text, 30 served resources; zero page errors, console errors, CSP violations or external requests. Unit suite: 12 tests. Existing native editor lifecycle browser test passes. Independent offline build copies 165 resolved package versions and proves no external dependency resolution. `verify` validates packed resource hashes and executes the backend with no runtime dependencies. Two builds in the same worktree produce identical resource manifests. Paths/chunk hashes may differ in the isolated dependency closure, as documented by the existing independent-build check.

## Adverse findings / limits

- Full partition embedding increases SVG size versus successful glyph subsetting. For this fixture it is about 354 KiB; no size/performance guarantee is made for large multilingual diagrams. Visual quality is preserved through original bytes, not a fallback system font. The test decodes fonts but is not a pixel-golden comparison or exhaustive glyph coverage test.
- Static scan of **every** generated JS resource still finds guarded Lodash `Function("return this")` global fallbacks. Browser/worker `self` short-circuits them. No other Function/eval constructor remains in the scan. Actual exercised font worker paths contain neither dynamic constructors nor WASM compilation.
- Two lazy image-processing chunks (pica and image-blob-reduce) retain WASM compilation code. The regression asserts neither is even requested during thumbnail/native text PNG/source exports. Image attachments are unsupported by this plugin. This is not a blanket claim that every optional upstream lazy feature is CSP-compatible.
- Chromium is covered, not Firefox/WebKit or OS save-picker integration. The fixture is same-origin iframe HTTP, matching the host's hosted-asset origin, with a MessagePort broker fixture rather than the full host App/SDK. Parent owns real host lifecycle/cleanup acceptance.
- Version remains unpublished development `0.1.0`. No registry install, push or publish occurred. No shared host or parent worktree was edited.
