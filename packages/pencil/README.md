# @chengzhiyi/pi-pencil

Agent-assisted UI design for [pi-webapp](https://github.com/chengzhiyi/pi-webapp), built on [OpenPencil](https://github.com/open-pencil/open-pencil). It shows up in pi-webapp as **OpenPencil**. Designs are `.fig` files in your workspace. pi's agent edits them directly: its changes appear on the canvas as they happen, and you can undo the latest one.

## Install

Use a pi-webapp host that lists **OpenPencil** in its official plugin catalog. Open **Plugins**, find **OpenPencil**, choose **Install**, then **Enable**. The package already contains the editor, CanvasKit, HarfBuzz, the fonts and its backend, so it has no runtime dependencies and nothing gets built on install.

## What it does

- **Editor.** OpenPencil's canvas and drawing tools: frames, shapes, pen, text, auto layout, components, boolean operations, pages and layers. It also includes the Design, Code (JSX / React + Tailwind / HTML) and Inspect (design checks) panels, plus PNG/JPG/WebP/SVG export. **Preview** (⌥⌘↩) runs the design on the canvas, as OpenPencil's own preview does. The editing UI goes away, animated shader fills play, and instances of components with a behaviour (button, switch, slider, tabs, text field…) work as live controls. **Reset** restarts them, and Esc exits.
- **Agent.** The `pencil_read_me`, `pencil_status`, `pencil_inspect`, `pencil_render` and `pencil_apply_changes` tools. A change is a typed batch of operations, never code. It applies at once: the changed frames are selected on your canvas, and a toast offers **Undo** until you edit after it. The agent can also build interactive components (components, variant sets, component properties and OpenPencil behaviours such as button, switch, checkbox and text field) and place instances of them, so its screens work in Preview. A behaviour that is missing a required value is refused with what is missing. The Agent tab lists recent agent changes. It also lets you lock layers, limit the agent to the selection, or give it the whole design again.
- **Files.** **File → Open workspace file…** opens a `.fig` from the workspace by its path; opening a file that is already open switches to its design. **File → Import from computer…**, or dropping a file onto the editor, turns a Figma (`.fig`), FigJam (`.jam`), Pencil (`.pen`) or draw.io (`.drawio`) file into a new design, and Save writes it under `designs/`. **Place image…** puts a PNG, JPG, WebP, GIF or SVG on the page. Saves write `.fig` files through the host with a content-hash check, so an external change is never overwritten. Designs stored by an older build are upgraded when they are opened. A design stored by a newer build is left untouched, with a prompt to update the plugin.
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
