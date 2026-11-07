// PencilOp → typed Figma Plugin API calls. No eval, no JSX render. Validation of shapes happens in
// contract/ops.js; this module enforces graph rules (existence, locks) and applies.
import { CJK_FAMILY } from './engine.js';

const rgb = (hex) => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });
const paint = (hex) => [{ type: 'SOLID', color: rgb(hex), opacity: hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1 }];
export class OpError extends Error { constructor(message, status = 400, reason = 'invalid_op', opIndex) { super(message); this.status = status; this.reason = reason; this.opIndex = opIndex; } }

function lockedChain(graph, id) {
  for (let n = graph.getNode(id); n; n = n.parentId ? graph.getNode(n.parentId) : null) if (n.locked) return n;
  return null;
}
function lockedBelow(graph, id) {
  const n = graph.getNode(id); if (!n) return null;
  if (n.locked) return n;
  for (const c of n.childIds ?? []) { const hit = lockedBelow(graph, c); if (hit) return hit; }
  return null;
}

/** Fonts every text op needs, loaded before applying (Figma semantics). */
export function fontsFor(ops) {
  const set = new Set([`${CJK_FAMILY}|Regular`]);
  for (const op of ops) { const f = op.props?.text?.font; if (f || op.props?.text) set.add(`${f?.family ?? CJK_FAMILY}|${f?.style ?? 'Regular'}`); }
  return [...set].map((k) => { const [family, style] = k.split('|'); return { family, style }; });
}

/**
 * Applies ops to `figma`'s graph. Returns { refs: {$ref: id}, touched: [ids], roots: [new top-level ids] }.
 * `scope` (optional Set of node ids): every target/parent must be inside one of these subtrees.
 */
export async function applyOps(figma, graph, ops, { scope = null, pageId } = {}) {
  const refs = new Map(); const touched = new Set(); const roots = [];
  for (const font of fontsFor(ops)) await figma.loadFontAsync(font);
  const resolve = (id, i) => {
    const real = id?.startsWith?.('$') ? refs.get(id) : id;
    if (!real || !graph.getNode(real)) throw new OpError(`op ${i}: unknown node ${id}`, 404, 'unknown_node', i);
    return real;
  };
  const inScope = (id) => { if (!scope) return true; for (let n = graph.getNode(id); n; n = n.parentId ? graph.getNode(n.parentId) : null) if (scope.has(n.id)) return true; return false; };
  const guardWrite = (id, i) => {
    const lock = lockedChain(graph, id);
    if (lock) throw new OpError(`op ${i}: node ${id} is inside locked "${lock.name}"`, 423, 'node_locked', i);
    if (!inScope(id) && !refsHas(id)) throw new OpError(`op ${i}: node ${id} is outside the task scope`, 403, 'out_of_scope', i);
  };
  const refsHas = (id) => [...refs.values()].includes(id);
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.op === 'create') {
      let parent = op.parent === '$page' ? (pageId ?? figma.currentPageId) : resolve(op.parent, i);
      if (op.parent !== '$page') guardWrite(parent, i);
      else if (scope) throw new OpError(`op ${i}: creating on the page is outside the task scope`, 403, 'out_of_scope', i);
      const node = op.type === 'TEXT' ? figma.createText() : op.type === 'RECTANGLE' ? figma.createRectangle() : op.type === 'ELLIPSE' ? figma.createEllipse() : figma.createFrame();
      if (op.type === 'TEXT') node.fontName = { family: CJK_FAMILY, style: 'Regular' };
      const parentProxy = figma.getNodeById(parent);
      if (op.index === undefined) parentProxy.appendChild(node); else parentProxy.insertChild(op.index, node);
      if (op.type === 'FRAME' && !op.props?.fill) node.fills = [];
      refs.set(op.ref, node.id); touched.add(node.id);
      if (op.parent === '$page') roots.push(node.id);
      setProps(node, op.props ?? {}, op.type);
    } else if (op.op === 'update') {
      const id = resolve(op.id, i); guardWrite(id, i);
      setProps(figma.getNodeById(id), op.props ?? {}, graph.getNode(id).type); touched.add(id);
    } else if (op.op === 'delete') {
      const id = resolve(op.id, i); guardWrite(id, i);
      const below = lockedBelow(graph, id);
      if (below) throw new OpError(`op ${i}: deleting ${id} would remove locked "${below.name}"`, 423, 'node_locked', i);
      figma.getNodeById(id).remove(); touched.add(id);
    } else throw new OpError(`op ${i}: unsupported op ${op.op}`);
  }
  return { refs: Object.fromEntries(refs), touched: [...touched], roots };
}

function setProps(node, p, type) {
  if (p.name !== undefined) node.name = p.name;
  if (p.layout) {
    const l = p.layout;
    node.layoutMode = l.mode;
    if (l.mode !== 'NONE') {
      // Adapter default learned in the spike: auto-layout containers hug their cross axis.
      if (l.gap !== undefined) node.itemSpacing = l.gap;
      if (l.padding) { const s = l.padding; if (s.top !== undefined) node.paddingTop = s.top; if (s.right !== undefined) node.paddingRight = s.right; if (s.bottom !== undefined) node.paddingBottom = s.bottom; if (s.left !== undefined) node.paddingLeft = s.left; }
      if (l.align) node.counterAxisAlignItems = l.align;
      if (l.justify) node.primaryAxisAlignItems = l.justify;
      if (l.wrap !== undefined) node.layoutWrap = l.wrap ? 'WRAP' : 'NO_WRAP';
    }
  }
  if (p.width !== undefined || p.height !== undefined) node.resize(p.width ?? node.width, p.height ?? node.height);
  if (p.x !== undefined) node.x = p.x;
  if (p.y !== undefined) node.y = p.y;
  if (p.fill !== undefined) node.fills = p.fill === 'none' ? [] : paint(p.fill);
  if (p.stroke) { node.strokes = paint(p.stroke.color); node.strokeWeight = p.stroke.weight ?? 1; if (p.stroke.align) node.strokeAlign = p.stroke.align; }
  if (p.radius !== undefined) node.cornerRadius = p.radius;
  if (p.opacity !== undefined) node.opacity = p.opacity;
  if (p.clip !== undefined && 'clipsContent' in node) node.clipsContent = p.clip;
  if (p.text && type === 'TEXT') {
    const t = p.text;
    if (t.font) node.fontName = { family: t.font.family ?? CJK_FAMILY, style: t.font.style ?? 'Regular' };
    if (t.content !== undefined) node.characters = t.content;
    if (t.font?.size) node.fontSize = t.font.size;
    if (t.color) node.fills = paint(t.color);
    if (t.align) node.textAlignHorizontal = t.align;
    if (t.autoResize) node.textAutoResize = t.autoResize;
    if (t.lineHeight) node.lineHeight = { unit: 'PIXELS', value: t.lineHeight };
  }
  // Sizing last: FILL/HUG only make sense once the node sits in an auto-layout parent.
  if (p.sizingH) node.layoutSizingHorizontal = p.sizingH;
  if (p.sizingV) node.layoutSizingVertical = p.sizingV;
  else if (p.layout && p.layout.mode !== 'NONE' && type === 'FRAME' && p.height === undefined) {
    if (p.layout.mode === 'HORIZONTAL') node.layoutSizingVertical = 'HUG';
  }
}
