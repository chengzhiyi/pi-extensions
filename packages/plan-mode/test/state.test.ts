import assert from "node:assert/strict";
import test from "node:test";
import { PLAN_KIND, STATE_KIND, mayCallTool, planDocuments, planState } from "../src/state.ts";

test("plan state restores latest value from session branch", () => {
  const entries = [
    { type: "custom" as const, customType: STATE_KIND, data: { enabled: true } },
    { type: "custom" as const, customType: STATE_KIND, data: { enabled: false } },
  ];
  assert.equal(planState(entries).enabled, false);
  assert.equal(planState(entries.slice(0, 1)).enabled, true);
});

test("only read and planning interaction tools work during planning", () => {
  for (const name of ["read", "grep", "find", "ls", "submit_plan", "ask_user"]) assert.equal(mayCallTool(true, name), true);
  for (const name of ["bash", "write", "edit", "powershell", "other_extension_tool"]) assert.equal(mayCallTool(true, name), false);
  assert.equal(mayCallTool(false, "bash"), true);
});

test("submitted plans restore with their tool call identities", () => {
  const entries = [{ type: "custom" as const, customType: PLAN_KIND, data: { callId: "call-1", title: "A", markdown: "# A" } }];
  assert.deepEqual(planDocuments(entries), [{ schemaVersion: 2, planId: "call-1", revision: 1, callId: "call-1", title: "A", markdown: "# A" }]);
});

test("legacy and versioned plans keep their identities and review states", async () => {
  const { planArtifacts, REVIEW_KIND } = await import("../src/state.ts");
  const entries = [
    { type: "custom", customType: PLAN_KIND, data: { callId: "old", title: "Legacy", markdown: "## Goal" } },
    { type: "custom", customType: REVIEW_KIND, data: { callId: "old", decision: "approve" } },
    { type: "custom", customType: PLAN_KIND, data: { schemaVersion: 2, planId: "p", revision: 1, callId: "one", title: "First", markdown: "A" } },
    { type: "custom", customType: REVIEW_KIND, data: { callId: "one", decision: "discuss", feedback: "Add tests" } },
    { type: "custom", customType: PLAN_KIND, data: { schemaVersion: 2, planId: "p", revision: 2, callId: "two", title: "Revised", markdown: "B" } },
  ];
  const artifacts = planArtifacts(entries, { pendingCallIds: ["two"], running: true });
  assert.equal(artifacts[0].planId, "old");
  assert.equal(artifacts[0].revision, 1);
  assert.equal(artifacts[0].status, "approved");
  assert.equal(artifacts[1].status, "superseded");
  assert.equal(artifacts[1].feedback, "Add tests");
  assert.equal(artifacts[2].status, "waiting");
  assert.equal(artifacts[2].canResubmit, false);
});

test("only interrupted unapproved plans can be resubmitted", async () => {
  const { planArtifacts, REVIEW_KIND, EXECUTION_KIND } = await import("../src/state.ts");
  const doc = (callId: string) => ({ type: "custom", customType: PLAN_KIND, data: { callId, title: callId, markdown: "Plan" } });
  const artifacts = planArtifacts([
    doc("interrupted"), doc("cancelled"), doc("approved"), doc("executing"),
    { type: "custom", customType: REVIEW_KIND, data: { callId: "cancelled", decision: "cancel" } },
    { type: "custom", customType: REVIEW_KIND, data: { callId: "approved", decision: "approve" } },
    { type: "custom", customType: EXECUTION_KIND, data: { callId: "executing", outcome: "started" } },
  ], { running: false });
  assert.deepEqual(artifacts.map(p => [p.status, p.canResubmit]), [["interrupted", true], ["cancelled", false], ["approved", false], ["interrupted", false]]);
});

test("execution projection distinguishes request completion from failure or interruption", async () => {
  const { planArtifacts, EXECUTION_KIND } = await import("../src/state.ts");
  for (const [outcome, status] of [["started", "executing"], ["completed", "finished"], ["error", "failed"], ["aborted", "interrupted"]]) {
    const artifacts = planArtifacts([
      { type: "custom", customType: PLAN_KIND, data: { callId: "x", title: "X", markdown: "Plan" } },
      { type: "custom", customType: EXECUTION_KIND, data: { callId: "x", outcome } },
    ], { running: true });
    assert.equal(artifacts[0].status, status);
  }
});

test("review feedback is trimmed, bounded and distinguishes legacy discussion from cancellation", async () => {
  const { parseReviewDecision } = await import("../src/state.ts");
  assert.deepEqual(parseReviewDecision({ decision: "discuss", feedback: "  Add tests\n " }), { decision: "discuss", feedback: "Add tests" });
  assert.deepEqual(parseReviewDecision({ decision: "discuss" }), { decision: "discuss" });
  assert.deepEqual(parseReviewDecision({ decision: "cancel" }), { decision: "cancel" });
  for (const feedback of ["  ", "x".repeat(4001), 3]) assert.throws(() => parseReviewDecision({ decision: "discuss", feedback }));
  assert.throws(() => parseReviewDecision({ decision: "other" }));
});

test("failed or interrupted approved executions offer resume while preserving resubmit semantics", async () => {
  const { planArtifacts, REVIEW_KIND, EXECUTION_KIND } = await import("../src/state.ts");
  for (const outcome of ["aborted", "error", "interrupted"]) {
    const artifacts = planArtifacts([
      { type: "custom", customType: PLAN_KIND, data: { schemaVersion: 2, planId: "approved-plan", revision: 1, callId: "approved-call", title: "Approved", markdown: "Implementation steps" } },
      { type: "custom", customType: REVIEW_KIND, data: { callId: "approved-call", decision: "approve" } },
      { type: "custom", customType: EXECUTION_KIND, data: { callId: "approved-call", outcome } },
    ], { running: false });
    assert.equal(artifacts[0].canResume, true, `${outcome} must offer a resume action while idle`);
    assert.equal(artifacts[0].canResubmit, false, "approved execution recovery is distinct from unapproved review recovery");
    assert.equal(planArtifacts([
      { type: "custom", customType: PLAN_KIND, data: { callId: "approved-call", title: "Approved", markdown: "Plan" } },
      { type: "custom", customType: REVIEW_KIND, data: { callId: "approved-call", decision: "approve" } },
      { type: "custom", customType: EXECUTION_KIND, data: { callId: "approved-call", outcome } },
    ], { running: true })[0].canResume, false, "a running request cannot be resumed");
  }
});

test("finished cancelled superseded and approval-only versions never offer resume", async () => {
  const { planArtifacts, REVIEW_KIND, EXECUTION_KIND } = await import("../src/state.ts");
  const doc = (callId: string, planId = callId, revision = 1) => ({ type: "custom", customType: PLAN_KIND, data: { schemaVersion: 2, planId, revision, callId, title: callId, markdown: "Plan" } });
  const artifacts = planArtifacts([
    doc("completed"), doc("cancelled"), doc("approval-only"), doc("executing"), doc("old", "revised", 1), doc("new", "revised", 2),
    { type: "custom", customType: REVIEW_KIND, data: { callId: "completed", decision: "approve" } },
    { type: "custom", customType: EXECUTION_KIND, data: { callId: "completed", outcome: "completed" } },
    { type: "custom", customType: REVIEW_KIND, data: { callId: "cancelled", decision: "cancel" } },
    { type: "custom", customType: REVIEW_KIND, data: { callId: "approval-only", decision: "approve" } },
    { type: "custom", customType: REVIEW_KIND, data: { callId: "executing", decision: "approve" } },
    { type: "custom", customType: EXECUTION_KIND, data: { callId: "executing", outcome: "started" } },
    { type: "custom", customType: REVIEW_KIND, data: { callId: "old", decision: "approve" } },
    { type: "custom", customType: EXECUTION_KIND, data: { callId: "old", outcome: "aborted" } },
  ], { running: true });
  assert.deepEqual(artifacts.map(plan => plan.canResume), [false, false, false, false, false, false]);
  const idle = planArtifacts([
    doc("completed"), doc("cancelled"), doc("approval-only"), doc("old", "revised", 1), doc("new", "revised", 2),
    { type: "custom", customType: REVIEW_KIND, data: { callId: "completed", decision: "approve" } },
    { type: "custom", customType: EXECUTION_KIND, data: { callId: "completed", outcome: "completed" } },
    { type: "custom", customType: REVIEW_KIND, data: { callId: "cancelled", decision: "cancel" } },
    { type: "custom", customType: REVIEW_KIND, data: { callId: "approval-only", decision: "approve" } },
    { type: "custom", customType: REVIEW_KIND, data: { callId: "old", decision: "approve" } },
    { type: "custom", customType: EXECUTION_KIND, data: { callId: "old", outcome: "error" } },
  ]);
  assert.deepEqual(idle.map(plan => plan.canResume), [false, false, false, false, false]);
  assert.equal(idle.at(-1)?.canResubmit, true, "new unapproved version retains its original recovery semantics");
});
