import { identifier, label, record, validateDrawing, validateGraph, validatePatch, validateScene, type DiagramDraft } from "../contract/diagrams.ts";
function draftRecord(value: unknown): DiagramDraft {
  if (!record(value)) throw new Error("Invalid checkpoint");
  const id = identifier(value.id), title = label(value.title), scene = validateScene(value.scene);
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0 ||
    !(value.savedRevision === null || (Number.isSafeInteger(value.savedRevision) && (value.savedRevision as number) >= 0 && (value.savedRevision as number) <= (value.revision as number))) ||
    !(value.path === null || (typeof value.path === "string" && value.path.length <= 4096)) ||
    !(value.diskHash === null || (typeof value.diskHash === "string" && /^[a-f0-9]{64}$/.test(value.diskHash)))) throw new Error("Invalid checkpoint metadata");
  const draft: DiagramDraft = { id, title, scene, revision: value.revision as number, savedRevision: value.savedRevision as number | null, path: value.path as string | null, diskHash: value.diskHash as string | null, candidate: null };
  if (value.candidate !== null) {
    const candidate = value.candidate;
    if (!record(candidate) || !Number.isSafeInteger(candidate.baseRevision) || (candidate.baseRevision as number) < 0 || (candidate.baseRevision as number) > draft.revision || [candidate.elements, candidate.graph, candidate.patch].filter(v => v !== undefined).length !== 1) throw new Error("Invalid checkpoint candidate");
    draft.candidate = { id: identifier(candidate.id), baseRevision: candidate.baseRevision as number,
      ...(candidate.elements === undefined ? {} : { elements: validateDrawing(candidate.elements) }),
      ...(candidate.graph === undefined ? {} : { graph: validateGraph(candidate.graph) }),
      // A stale patch remains rejectable after hand edits. Validation against the old scene
      // already happened at creation; never try to apply it during recovery.
      ...(candidate.patch === undefined ? {} : { patch: candidate.baseRevision === draft.revision ? validatePatch(candidate.patch, scene) : record(candidate.patch) ? structuredClone(candidate.patch) : (() => { throw new Error("Invalid checkpoint patch"); })() }),
    };
  }
  return draft;
}

export function checkpoint(value: unknown): {drafts: DiagramDraft[]; focused: string | null} {
  if (!record(value) || !Array.isArray(value.drafts) || value.drafts.length > 100) throw new Error("Invalid checkpoint");
  const drafts = value.drafts.map(draftRecord);
  if (new Set(drafts.map(d => d.id)).size !== drafts.length) throw new Error("Duplicate checkpoint IDs");
  if (value.focused !== null && (typeof value.focused !== "string" || !drafts.some(d => d.id === value.focused))) throw new Error("Invalid focus");
  return {drafts, focused: value.focused as string | null};
}
