/** Must evaluate before the editor registers its FontFace sources. Keep this a separate import. */
(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL("./", import.meta.url).href;
