// PencilOp → typed Figma Plugin API calls. No eval, no JSX render. Validation of shapes happens in
// contract/ops.js; this module enforces graph rules (existence, locks) and applies.
import { OpenPencilAPI } from '@open-pencil/core/openpencil-api';
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
      let node;
      if (op.type === 'INSTANCE') {
        // An instance of a component, or of a variant set's default variant (its first variant).
        const source = graph.getNode(resolve(op.component, i));
        const main = source.type === 'COMPONENT_SET' ? graph.getNode(source.childIds?.[0]) : source;
        if (main?.type !== 'COMPONENT') throw new OpError(`op ${i}: component must be a COMPONENT or a variant set`, 400, 'invalid_op', i);
        node = figma.getNodeById(main.id).createInstance();
      } else node = op.type === 'TEXT' ? figma.createText() : op.type === 'RECTANGLE' ? figma.createRectangle() : op.type === 'ELLIPSE' ? figma.createEllipse() : op.type === 'COMPONENT' ? figma.createComponent() : figma.createFrame();
      if (op.type === 'TEXT') node.fontName = { family: CJK_FAMILY, style: 'Regular' };
      const parentProxy = figma.getNodeById(parent);
      if (op.index === undefined) parentProxy.appendChild(node); else parentProxy.insertChild(op.index, node);
      if ((op.type === 'FRAME' || op.type === 'COMPONENT') && !op.props?.fill) node.fills = [];
      refs.set(op.ref, node.id); touched.add(node.id);
      if (op.parent === '$page') roots.push(node.id);
      setProps(node, op.props ?? {}, op.type);
      interactive(op.props ?? {}, node.id, i);
    } else if (op.op === 'variants') {
      // Components named like "State=Off" / "State=On" become one variant set; its variant property
      // ("State") is what a toggle, switch or checkbox behaviour binds its value to.
      const ids = op.ids.map((ref) => resolve(ref, i));
      for (const id of ids) { guardWrite(id, i); if (graph.getNode(id).type !== 'COMPONENT') throw new OpError(`op ${i}: variants combines COMPONENT nodes only`, 400, 'invalid_op', i); }
      const parent = op.parent === '$page' ? (pageId ?? figma.currentPageId) : resolve(op.parent, i);
      if (op.parent !== '$page') guardWrite(parent, i);
      else if (scope) throw new OpError(`op ${i}: creating on the page is outside the task scope`, 403, 'out_of_scope', i);
      let set;
      try { set = figma.combineAsVariants(ids.map((id) => figma.getNodeById(id)), figma.getNodeById(parent)); }
      catch (error) { throw new OpError(`op ${i}: ${error.message}`, 400, 'invalid_op', i); }
      refs.set(op.ref, set.id); touched.add(set.id);
      if (op.parent === '$page') roots.push(set.id);
      setProps(set, op.props ?? {}, 'COMPONENT_SET');
      interactive(op.props ?? {}, set.id, i);
    } else if (op.op === 'update') {
      const id = resolve(op.id, i); guardWrite(id, i);
      setProps(figma.getNodeById(id), op.props ?? {}, graph.getNode(id).type); touched.add(id);
      interactive(op.props ?? {}, id, i);
    } else if (op.op === 'delete') {
      const id = resolve(op.id, i); guardWrite(id, i);
      const below = lockedBelow(graph, id);
      if (below) throw new OpError(`op ${i}: deleting ${id} would remove locked "${below.name}"`, 423, 'node_locked', i);
      figma.getNodeById(id).remove(); touched.add(id);
    } else throw new OpError(`op ${i}: unsupported op ${op.op}`);
  }
  return { refs: Object.fromEntries(refs), touched: [...touched], roots };

  /** Component properties, layer bindings and behaviours: what makes a component a live control in preview. */
  function interactive(p, id, i) {
    const node = graph.getNode(id);
    const fail = (message, reason = 'invalid_op') => { throw new OpError(`op ${i}: ${message}`, 400, reason, i); };
    if (p.properties) {
      if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') fail('properties can only be added to a COMPONENT or a variant set');
      for (const def of p.properties) {
        try { figma.getNodeById(id).addComponentProperty(def.name, def.type, def.type === 'BOOLEAN' ? def.default === true || def.default === 'true' : String(def.default ?? '')); }
        catch (error) { fail(error.message); }
      }
    }
    if (p.bind) {
      // The nearest component (or variant set) above that defines the property owns the binding.
      const field = { text: 'TEXT', visible: 'VISIBLE' };
      for (const [key, name] of Object.entries(p.bind)) {
        if (key === 'text' && node.type !== 'TEXT') fail('bind.text needs a TEXT layer');
        let definition = null;
        for (let n = node.parentId ? graph.getNode(node.parentId) : null; n && !definition; n = n.parentId ? graph.getNode(n.parentId) : null)
          if (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') definition = (n.componentPropertyDefinitions ?? []).find((d) => d.name === name && d.type === (key === 'text' ? 'TEXT' : 'BOOLEAN'));
        if (!definition) fail(`no ${key === 'text' ? 'TEXT' : 'BOOLEAN'} property "${name}" on a component above this layer`);
        const kept = (node.componentPropertyReferences ?? []).filter((ref) => ref.field !== field[key]);
        graph.updateNode(id, { componentPropertyReferences: [...kept, { field: field[key], propertyId: definition.id }] });
      }
    }
    if (p.behaviour) {
      if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') fail('behaviour can only be set on a COMPONENT or a variant set');
      if (node.type === 'COMPONENT' && graph.getNode(node.parentId)?.type === 'COMPONENT_SET') fail('set the behaviour on the variant set, not on one variant');
      const { kind, values, states, parts } = p.behaviour;
      let handle;
      try {
        handle = new OpenPencilAPI(figma).setBehaviour(id, { kind, ...(values ? { values } : {}), ...(states ? { states } : {}) });
        for (const [part, ref] of Object.entries(parts ?? {})) handle.bindPart(part, resolve(ref, i));
      } catch (error) { if (error instanceof OpError) throw error; fail(`behaviour: ${error.message}`); }
      // A behaviour with an unbound required value renders but does nothing: refuse it with what is missing.
      if (handle.missing.length) fail(`behaviour "${kind}" still needs: ${handle.missing.join(', ')}`, 'behaviour_incomplete');
    }
  }
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
