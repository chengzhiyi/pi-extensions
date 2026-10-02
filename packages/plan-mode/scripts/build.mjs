import { build, context } from "esbuild";

const sharedReact = {
  name: "host-react",
  setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "host-react" }));
    build.onLoad({ filter: /.*/, namespace: "host-react" }, () => ({
      contents: `const React = globalThis.__PI_WEBAPP_REACT__;
        if (!React) throw new Error("pi-webapp React runtime is unavailable");
        export default React;
        export const useState = React.useState;
        export const useMemo = React.useMemo;
        export const useEffect = React.useEffect;
        export const useRef = React.useRef;
        export const useId = React.useId;
        export const forwardRef = React.forwardRef;`,
      loader: "js",
    }));
  },
};

const server = {
  entryPoints: ["src/extension.ts"], outfile: "dist/extension.js", bundle: true,
  format: "esm", platform: "node", target: "node22", sourcemap: "external",
  external: ["@earendil-works/*", "typebox"],
};
const client = {
  entryPoints: ["src/client.tsx"], outdir: "dist", entryNames: "client", bundle: true,
  format: "esm", platform: "browser", target: "es2022", sourcemap: "external",
  jsx: "transform", jsxFactory: "React.createElement", jsxFragment: "React.Fragment",
  plugins: [sharedReact],
};

if (process.argv.includes("--watch")) {
  const contexts = await Promise.all([context(server), context(client)]);
  for (const item of contexts) await item.watch();
  console.log("Watching Pi and browser plugin bundles");
} else {
  await build(server);
  await build(client);
}
