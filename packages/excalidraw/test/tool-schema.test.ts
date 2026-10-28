import assert from "node:assert/strict";
import test from "node:test";
import { diagramTools } from "../src/server/tools.ts";

// Model APIs use schema-valued items, not the legacy draft-07 tuple syntax.
// Inspect every advertised tool, including tools the current turn never calls.
function assertModelArraySchemas(schema: any, path = "parameters"): void {
  if (!schema || typeof schema !== "object") return;
  if ("items" in schema) {
    assert.ok(!Array.isArray(schema.items) && (typeof schema.items === "boolean" || (schema.items !== null && typeof schema.items === "object")), `${path}.items must be a schema, not a tuple array`);
  }
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === "object") assertModelArraySchemas(value, `${path}.${key}`);
  }
}

test("all six advertised tool schemas use model-compatible array items (ORI-55)", () => {
  const tools = diagramTools();
  assert.equal(tools.length, 6);
  for (const tool of tools) assertModelArraySchemas(tool.parameters, tool.name);
  assert.throws(() => assertModelArraySchemas({type: "array", items: [{type: "number"}, {type: "number"}]}), /not a tuple array/);
});

test("create and patch advertise bounded homogeneous two-number waypoints", () => {
  const tools = diagramTools();
  const create = tools.find(tool => tool.name === "diagram_create")!.parameters as any;
  const patch = tools.find(tool => tool.name === "diagram_patch")!.parameters as any;
  const edges = [create.properties.graph.properties.edges, patch.properties.patch.properties.addEdges];
  for (const edgeArray of edges) {
    const waypoints = edgeArray.items.properties.waypoints;
    assert.equal(waypoints.maxItems, 12);
    assert.deepEqual(waypoints.items, {type: "array", items: {type: "number", minimum: -100000, maximum: 100000}, minItems: 2, maxItems: 2});
  }
});
