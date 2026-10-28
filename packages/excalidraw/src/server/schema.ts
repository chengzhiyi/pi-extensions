type Schema = Record<string, any>;
const optional = Symbol("optional");
export const Type = {
  String: (options: Schema = {}) => ({type: "string", ...options}),
  Number: (options: Schema = {}) => ({type: "number", ...options}),
  Integer: (options: Schema = {}) => ({type: "integer", ...options}),
  Literal: (value: string) => ({const: value, type: "string"}),
  Union: (items: Schema[]) => ({anyOf: items}),
  Array: (items: Schema, options: Schema = {}) => ({type: "array", items, ...options}),
  Optional: (schema: Schema) => ({...schema, [optional]: true}),
  Object: (properties: Record<string, Schema>) => ({type: "object", properties, required: Object.keys(properties).filter(k => !properties[k][optional as any])}),
};
