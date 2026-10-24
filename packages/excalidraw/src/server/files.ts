import { DiagramError, MAX_SCENE_BYTES, validateScene, type DiagramScene } from "../contract/diagrams.ts";
export interface Broker { call(method: string, input: unknown): Promise<any> }
export interface DiagramFiles { read(path: unknown): Promise<{scene: DiagramScene; hash: string}>; save(path: unknown, scene: DiagramScene, expectedHash: string | null, guard: () => void): Promise<string> }
function relativePath(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096 || !value.endsWith(".excalidraw") || /[\\\x00-\x1f:]/.test(value) || value.split("/").some(p => !p || p === "." || p === "..")) throw new DiagramError("需要相对 .excalidraw 路径");
  return value;
}
export function brokerFiles(broker: Broker): DiagramFiles {
  return {
    async read(path) {
      const result = await broker.call("workspace.read", {path: relativePath(path), maxBytes: MAX_SCENE_BYTES});
      if (!result) throw new DiagramError("图稿文件不存在", 404);
      return {scene: validateScene(JSON.parse(result.text)), hash: result.hash};
    },
    async save(path, scene, expectedHash, guard) {
      const text = JSON.stringify(validateScene(scene));
      if (new TextEncoder().encode(text).length > MAX_SCENE_BYTES) throw new DiagramError("图稿过大");
      guard();
      // Host owns lock/hash/no-replace and generation fencing immediately before commit.
      const result = await broker.call("workspace.commit", {path: relativePath(path), text, expectedHash});
      return result.hash;
    },
  };
}
