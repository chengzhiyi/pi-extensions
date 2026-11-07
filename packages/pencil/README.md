# @chengzhiyi/pi-pencil

Agent-assisted UI design for [pi-webapp](https://github.com/chengzhiyi/pi-webapp), built on [OpenPencil](https://github.com/open-pencil/open-pencil). Designs are `.fig` files in your workspace. pi's agent proposes changes to them, and you accept or reject each proposal in the editor.

## Install

Use a pi-webapp host that lists **Pencil** in its official plugin catalog. Open **Plugins**, find **Pencil**, choose **Install**, then **Enable**. The package already contains the editor, CanvasKit, HarfBuzz, the fonts and its backend, so it has no runtime dependencies and nothing gets built on install.

## What it does

- **Editor.** OpenPencil's canvas and drawing tools: frames, shapes, pen, text, auto layout, components, boolean operations, pages and layers. It also includes the Design, Code (JSX / React + Tailwind / HTML) and Inspect (design checks) panels, plus PNG/JPG/WebP/SVG export.
- **Agent.** The `pencil_read_me`, `pencil_status`, `pencil_inspect`, `pencil_render` and `pencil_propose_changes` tools. A proposal is a typed batch of operations, never code. Only you can accept it, from the Agent tab.
- **Files.** Saves write `.fig` files through the host with a content-hash check, so an external change is never overwritten.
- **Host.** Theme and language follow pi-webapp's settings. OpenPencil's own AI chat is not included, because pi-webapp's agent does that job.

Disabling or uninstalling the plugin keeps your workspace `.fig` files.

## Build and test

From this directory (Node 24):

```sh
node scripts/build.mjs        # dist/, resources.json and THIRD-PARTY-NOTICES.txt
node --test test/*.test.mjs   # backend
node test/loop.browser.mjs    # editor in Chromium against a scripted host
node test/csp.browser.mjs     # boot under the hosted CSP
```

During development, add this directory to `~/.pi/agent/pi-web/hosted-dev.json` (`{"roots": ["/abs/path/packages/pencil"]}`). A running host then switches to each new build.

## License

MIT. Third-party notices for everything bundled into `dist/` are in `NOTICE.txt` and `dist/THIRD-PARTY-NOTICES.txt`.
