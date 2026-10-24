import assert from "node:assert/strict";
import test from "node:test";
import { emptyScene, validateDrawing, partialDrawing, validateGraph, validatePatch, validateScene, type DiagramDraft } from "../src/contract/diagrams.ts";
import { DiagramStore } from "../src/server/store.ts";
import { architectureExample } from "../src/contract/reference.ts";
const scene = () => ({ ...emptyScene(), elements: [{ id: "input", type: "rectangle", x: 20, y: 30, width: 200, height: 100 }, { id: "text", type: "text", text: "手动修改", containerId: "input", x: 40, y: 50, width: 100, height: 30 }] });
const graph = { nodes: [{ id: "input", label: "输入验证码" }, { id: "check", label: "验证通过？", kind: "decision" }, { id: "success", label: "登录成功" }], edges: [{ id: "e1", from: "input", to: "check" }, { id: "e2", from: "check", to: "success", label: "是" }, { id: "e3", from: "check", to: "input", label: "否，重试" }] };

test("diagram wire validation rejects duplicate IDs, missing endpoints, executable resources and bounds", () => {
  assert.equal(validateGraph(graph).nodes.length, 3);
  assert.throws(() => validateGraph({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] }), /重复/);
  assert.throws(() => validateGraph({ nodes: graph.nodes, edges: [{ id: "e", from: "input", to: "unknown" }] }), /不存在/);
  assert.throws(() => validateGraph({ nodes: Array.from({ length: 31 }, (_, i) => ({ id: `n${i}`, label: "节点" })) }), /30/);
  assert.throws(() => validateGraph({ nodes: [{ id: "node", label: "test", x: Infinity }] }), /坐标/);
  assert.throws(() => validateScene({ ...scene(), files: { png: {} } }), /附件/);
  assert.throws(() => validateScene({ ...scene(), elements: [{ ...scene().elements[0], type: "iframe" }] }), /不支持/);
  assert.throws(() => validateScene({ ...scene(), elements: [{ ...scene().elements[0], link: "https://example.com" }] }), /外链/);
  assert.throws(() => validateScene({ ...scene(), elements: [{ ...scene().elements[0], x: NaN }] }), /数值/);
  assert.throws(() => validateScene({ ...scene(), elements: [{ ...scene().elements[0], points: [[Infinity, 0]] }] }), /坐标/);
  assert.deepEqual(validateScene({ ...scene(), appState: { viewBackgroundColor: "#fff", collaborators: ["secret"], selectedElementIds: { input: true } } }).appState, { viewBackgroundColor: "#fff" });
  assert.equal(validatePatch({ updateNodes: [{ id: "input", label: "新文案" }] }, scene()).updateNodes?.[0]?.id, "input");
  assert.throws(() => validatePatch({ updateNodes: [{ id: "text", label: "wrong" }] }, scene()), /节点不存在/);
  assert.throws(() => validatePatch({ addNodes: [{ id: "input", label: "重复" }] }, scene()), /已存在/);
  assert.throws(() => validatePatch({ removeIds: ["missing"] }, scene()), /不存在/);
});

test("native frames round-trip without permitting web embeds or invalid frame references", () => {
  const framed = { ...scene(), elements: [{ id: "frame", type: "frame", x: 0, y: 0, width: 500, height: 500, name: "核心层" }, ...scene().elements.map(e => ({ ...e, frameId: "frame" }))] };
  assert.deepEqual(validateScene(framed).elements, framed.elements);
  assert.throws(() => validateScene({ ...framed, elements: [{ ...scene().elements[0], frameId: "missing" }] }), /画框引用/);
  assert.throws(() => validateScene({ ...framed, elements: [{ ...framed.elements[0], name: {} }] }), /画框名称/);
  assert.throws(() => validateScene({ ...framed, elements: [{ ...framed.elements[0], type: "embeddable" }] }), /不支持/);
});

test("rich composition preserves safe styling, grouping, paths and targeted edits", () => {
  const graph = validateGraph(architectureExample);
  assert.equal(graph.nodes.filter(n => n.kind === "group").length, 4);
  assert.equal(graph.nodes.find(n => n.id === "title")?.fontSize, 36);
  assert.equal(graph.edges.find(e => e.id === "experimental")?.strokeStyle, "dashed");
  const rich = { nodes: [{ id: "a", label: "A", width: 300 }], edges: [{ id: "e", from: "a", to: "a", waypoints: [[300, 10]], strokeColor: "#aabbcc" }] };
  assert.deepEqual(validateGraph(rich).edges[0]?.waypoints, [[300, 10]]);
  for (const input of [{ fontSize: 300 }, { width: -2 }, { strokeColor: "url(https://evil.example)" }, { strokeStyle: "script" }, { groupId: "missing" }]) assert.throws(() => validateGraph({ nodes: [{ id: "a", label: "A", ...input }] }));
  assert.throws(() => validateGraph({ nodes: [{ id: "a", label: "A", kind: "text" }], edges: [{ id: "e", from: "a", to: "a" }] }), /不存在/);
  assert.throws(() => validateGraph({ ...rich, edges: [{ ...rich.edges[0], waypoints: [[NaN, 0]] }] }), /途经点/);
  const edit = validatePatch({ updateElements: [{ id: "input", x: 200, backgroundColor: "#ffffff", label: "修改" }] }, scene());
  assert.equal(edit.updateElements?.[0]?.x, 200);
  for (const input of [{ id: "missing", x: 10 }, { id: "text", x: 10 }, { id: "input" }, { id: "input", width: Infinity }]) assert.throws(() => validatePatch({ updateElements: [input] }, scene()));
  assert.throws(() => validatePatch({ updateNodes: [{ id: "input", label: "a" }], updateElements: [{ id: "input", x: 100 }] }, scene()), /重复/);
  const store = new DiagramStore({read: async () => {throw new Error("unused")}, save: async () => {throw new Error("unused")}});
  const reference = store.tool("/example", "a", "reference", {}) as { guide: string; example: { graph: unknown } };
  assert.match(reference.guide, /waypoints/);
  assert.equal(validateGraph(reference.example.graph).nodes.length, graph.nodes.length);
});

