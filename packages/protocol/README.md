# @chengzhiyi/pi-web-protocol

Versioned contract shared by pi-webapp and Pi packages with browser UI. A package declares `piWebapp: { "apiVersion": 1, "client": "./dist/client.js", "style": "./dist/client.css" }`; its browser ES module default exports one `defineWebPlugin` result with a required synchronous `activate(context)` method.

Client contributions declare slots, commands, and menu items. Actions execute in the matching Pi session through `registerWebActions`; plugins never receive the bridge token or Pi's raw event bus in their browser-facing API.

## Contract v1

The package manifest must contain `piWebapp.apiVersion: 1`, a `./dist/*.js` client entry, and an optional `./dist/*.css` style entry. pi-webapp discovers Web manifests only in enabled Pi extension packages or explicit local development roots, verifies real file paths within the package, and serves the assets from its own origin. The browser bundle uses `export default defineWebPlugin(...)`; the host imports and validates it before activating it for a browser session. The old global registration entry is not supported. React is provided by the host as `globalThis.__PI_WEBAPP_REACT__`; browser builds must keep React shared.

`defineWebPlugin` declares `composer.controls`, `turn.tail`, `rightbar.panel`, and `rightbar.title` slots. A command or menu item declares an action ID, while Pi code binds that ID with `registerWebActions`. Slot components receive read-only session data, plugin entries, panel controls, `invokeAction`, `sendMessage`, and a Markdown renderer. `invokeAction` includes the active session ID; the host validates it before and after the handler, times out after 15 seconds, and returns an error if the session changed. Browser bundles do not access `ExtensionAPI.events`.

Plugin custom entries should use a kind prefixed by the package ID, such as `@example/pi-foo/state`. The host projects only entries for enabled Web plugins, with a 128 KiB limit per entry. Each plugin must validate the shape of its own records.

## Session-bound interactions

A plugin declares `interactions: [{ kind, component }]`. The component replaces the composer only for a matching pending request in the current session. Pi code calls `requestWebInteraction(events, { requestId, sessionId, pluginId, kind, data }, signal)`; `WebInteractionHost` accepts requests only from an enabled plugin in that session. The acknowledgement has a short deadline (300 ms); a human decision has no timeout. Without a host, `WebInteractionUnavailable` lets a plugin use the native TUI. Abort, host unload and session change release listeners and cancel requests.

The host projects pending requests into `session.interactions`; the browser never sees an event bus. The matching component receives `interaction` and `resolveInteraction(value)`. The authenticated bridge checks session, plugin and request identity and accepts a result once. Plugins validate their decision payloads. A rejected or expired response re-enables the UI. Live interactions are transient; plugins separately persist artifacts and decisions as custom session entries.

`composerPlaceholder(session, locale)` provides a mode-specific hint. `artifactTools` lists tools represented by artifact cards rather than raw chat JSON; their full arguments remain in the trajectory. `turn.completed` lets artifact cards wait for a completed turn. `rightbar.title` provides each tab's title; tabs are bound to the same session and `panelId` as their body.

## Composer command presentation

A command may declare `presentation: { label, description, icon, section }` and `input: { token, hint, attachments }`. Display text accepts a string or `{ zh, en }`. `section` is `add` or `commands`; `icon` is a shared-React component receiving `size` and `className`. The canonical command `id` and action identity never change with locale. A Web contribution supplies the browser presentation for the same Pi command, preventing a duplicate unlocalized SDK row. A command appears in both the plus menu and slash completion, so it does not need a separate toggle menu item.

Selecting an input command inserts its localized token and a separator, highlights the prefix, and shows the hint while arguments are blank. Both localized spellings and the canonical ID remain accepted. The action receives `{ args: string[], text: string, attachments: string[] }`: `text` preserves internal whitespace and newlines; `attachments` contains host receipt IDs. When an action returns `{ message }`, the host sends that message with the accepted attachments. Attachments require explicit `input.attachments: true`; files remain in the composer if no message is returned. Existing command declarations keep their original behavior. These optional fields require an updated pi-webapp host to render the richer presentation.

## Lifecycle ownership (development contract, apiVersion remains 1)

```ts
export default defineWebPlugin({
  id: "@example/pi-foo",
  apiVersion: 1,
  activate({ sessionId, signal, onDispose }) {
    const handleResize = () => { /* update session-owned resources */ };
    window.addEventListener("resize", handleResize);
    onDispose(() => window.removeEventListener("resize", handleResize));
    // Pass signal to asynchronous work. Check it before publishing late results.
  },
  slots: [],
});
```

Module top-level code declares definitions only. Each browser connection/session activates its own resource scope; module evaluation may be cached. `activate` and `onDispose` callbacks are synchronous and return void. Activation without resources still declares `activate() {}`. Cleanup aborts the signal first, then invokes registered callbacks once in reverse order; one throwing callback does not stop the rest. Registering a cleanup after disposal executes it immediately. React components own their effects separately and must return effect cleanup functions.

Module/style loading has a 10-second deadline. Invalid exports, activation errors and load failures affect only that plugin; errors carry plugin ID, session ID, generation and stage. Builds use content fingerprints for module URLs. Disconnect, session change and frontend unmount dispose frontend resources. Hiding a panel does not dispose the plugin. Browser/page teardown releases the frontend environment; cleanup never depends on an asynchronous unload HTTP request.

Backend instances are separate from browser activations. Switching from an SDK workspace to the TUI retains the SDK instance in the background. Browser disconnect retains pending human interactions; reconnect displays them again. Session replacement, plugin removal and host shutdown cancel interactions. SDK replacements emit `session_shutdown` before invalidating the old context, and initialization errors leave the previous runtime selected. Close handlers must finish within five seconds and own their cleanup; arbitrary plugin code is not sandboxed or forcibly terminated.

Register Web actions on `session_start`, retain their unsubscribe function and call it on `session_shutdown`. Repeated startup must replace, rather than accumulate, registrations. Unsubscription suppresses responses from unfinished handlers but does not cancel their execution. The host releases the caller's wait when its runtime ends and checks runtime identity before accepting results. Never retain an old Pi context across reload; restore persistent artifacts from session entries, and clear temporary execution permissions.

This is a coordinated development update: rebuild protocol, plugins and host together. No compatibility loader or API version bump is introduced; old browser entries report a contract error.
