// Field-level preconditions for proposals (plan D3). At proposal time we record, for every op that
// touches an EXISTING node, the values of exactly the fields that op writes. At accept time, if the
// design moved on (human edits, other accepted batches), an op still applies when those fields are
// unchanged; otherwise it is a conflict. Derived geometry from auto-layout reflow is not compared
// unless the op itself writes geometry.
import { createHash } from 'node:crypto';

const FIELDS = {
  name: ['name'], x: ['x'], y: ['y'], width: ['width'], height: ['height'],
  fill: ['fills'], stroke: ['strokes'], radius: ['cornerRadius'], opacity: ['opacity'], clip: ['clipsContent'],
  layout: ['layoutMode', 'itemSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'primaryAxisAlign', 'counterAxisAlign', 'layoutWrap'],
  text: ['text', 'fontSize', 'fontFamily', 'fontStyle', 'fontWeight', 'textAlignHorizontal', 'textAutoResize', 'lineHeight'],
  sizingH: ['layoutGrow', 'layoutAlignSelf', 'primaryAxisSizing', 'counterAxisSizing'], sizingV: ['layoutGrow', 'layoutAlignSelf', 'primaryAxisSizing', 'counterAxisSizing'],
};
const ALL = [...new Set(Object.values(FIELDS).flat())].filter((f) => !['x', 'y', 'width', 'height'].includes(f));
const digest = (node, fields) => createHash('sha256').update(JSON.stringify(fields.map((f) => [f, node?.[f] ?? null]))).digest('hex').slice(0, 16);
const fieldsFor = (props = {}) => [...new Set(Object.keys(props).flatMap((k) => FIELDS[k] ?? []))];

/** Computed on the base graph BEFORE applying the ops. */
export function preconditions(graph, ops) {
  const out = [];
  ops.forEach((op, index) => {
    const target = op.op === 'create' ? op.parent : op.id;
    if (!target || target === '$page' || target.startsWith('$')) return;
    const node = graph.getNode(target);
    if (!node) return; // the fork apply will report unknown_node
    if (op.op === 'create') out.push({ index, nodeId: target, kind: 'exists' });
    else if (op.op === 'delete') out.push({ index, nodeId: target, kind: 'unchanged', fields: ALL, hash: digest(node, ALL) });
    else { const fields = fieldsFor(op.props); out.push({ index, nodeId: target, kind: 'fields', fields, hash: digest(node, fields) }); }
  });
  return out;
}

/** Returns conflicts against the CURRENT graph: [{index, nodeId, reason}]. Empty = safe to apply. */
export function conflicts(graph, pre) {
  const found = [];
  for (const p of pre) {
    const node = graph.getNode(p.nodeId);
    if (!node) found.push({ index: p.index, nodeId: p.nodeId, reason: 'deleted' });
    else if (p.kind !== 'exists' && digest(node, p.fields) !== p.hash) found.push({ index: p.index, nodeId: p.nodeId, reason: 'changed', fields: p.fields });
  }
  return found;
}
