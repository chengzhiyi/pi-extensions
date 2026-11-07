// Export and code generation through OpenPencil's own IO formats (the formats its app uses for
// File → Export and the Code tab). Downloads go through the host inside pi-webapp: a blob link
// inside the iframe is blocked by some browsers.
import { IORegistry, htmlFormat, jpgFormat, jsxFormat, pngFormat, svgFormat, tailwindJSXFormat, webpFormat } from '@open-pencil/core/io';
import { hostCall, hosted } from '../host.js';

export const io = new IORegistry([pngFormat, jpgFormat, webpFormat, svgFormat, jsxFormat, tailwindJSXFormat, htmlFormat]);
export const EXPORT_FORMATS = ['png', 'jpg', 'webp', 'svg'];
const context = (editor) => ({ canvasKit: editor.renderer?.ck, renderer: editor.renderer });

/** Text of the selection (or page) in one of the code formats: 'jsx' | 'tailwind-jsx' | 'html'. */
export async function generateCode(editor, format, target) {
  const result = await io.exportContent(format, { graph: editor.graph, target }, undefined, context(editor));
  return typeof result.data === 'string' ? result.data : new TextDecoder().decode(result.data);
}

const safeName = (name) => (String(name || 'export').replace(/[/\\\x00-\x1f\x7f:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'export');

export async function download(blob, name) {
  if (hosted) { await hostCall('downloadDrawing', { blob, name }, true); return; }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true; document.body.append(a);
  try { a.click(); } finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000); }
}

/** Export one target at one setting and download it (`Name@2x.png`, like OpenPencil). */
export async function exportTarget(editor, target, name, { format, scale = 1 }) {
  const result = await io.exportContent(format, { graph: editor.graph, target, fileName: safeName(name) }, { scale }, context(editor));
  const blob = new Blob([result.data], { type: result.mimeType });
  const suffix = format !== 'svg' && scale !== 1 ? `@${scale}x` : '';
  await download(blob, `${safeName(name)}${suffix}.${result.extension}`);
}
