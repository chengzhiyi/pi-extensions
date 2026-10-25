# ORI-41 local paired acceptance fixes

This is an unpublished local change from `b8f74b1`, not a registry release.
Pair it with the ORI-41 host patch; the host implements the private
`downloadDrawing` MessagePort method for editor/workspace frames. Do not install
this development archive into an unpatched host and claim export compatibility.

- Focus the native `.excalidraw` container only on canvas pointer-down. Firefox
  otherwise leaves `document.activeElement` at body, so non-global keyboard
  handlers never receive select-all/move/zoom. Inputs and the parent composer
  are not captured.
- Route user-triggered fallback/source downloads as a Blob through the bound
  host MessagePort. Firefox blocks iframe blob navigation under the unchanged
  parent CSP; the top document can perform the normal download without changing
  CSP. The host checks type, extension, safe filename and 16 MiB limit. Native
  filesystem destinations remain behind the unchanged Electron download guard.
- The upstream fallback adapter is build-time only, pinned to SHA256
  `3453a5d0851d7c16c8942ad8f0411ab796c3bd7839c992ba3448591f249733ca`.
  No installed dependency files are modified. Vendor Excalidraw JSON MIME is
  normalized to `application/json` rather than widening the desktop allowlist.

Final delivered tgz SHA256:
`d000ae308936b60e6bfeff05a988e6fce8df05df8f649efd6a1900587cf16088`.
Version stays 0.1.0 (local fixture), 427 controlled resources. This is **not** the
original supplied archive (`932c697f…`), which remains unchanged.

Verified: TypeScript check, 17 unit tests, resource verification, and independent
copied-dependency-closure build. Paired host Firefox/Chromium suites and packaged
macOS arm64 smoke/recovery use this exact final archive; see host report
`docs/hosted-platform-fixes-ori41.md`. OS IME/native dialogs and foreign OS
acceptance are not certified by these tests. No push/publication was performed.
