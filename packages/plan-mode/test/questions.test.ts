import assert from "node:assert/strict";
import test from "node:test";
import { parseQuestions, parseQuestionDecision } from "../src/questions.ts";

const questions = [{ id: "stack", question: "选择技术栈", options: [{ label: "React", description: "前端实践" }, { label: "Node.js" }], recommended: 0 }];
test("question batches preserve options and validate identities and recommendation bounds", () => {
  assert.deepEqual(parseQuestions(questions), questions);
  for (const batch of [[], [...questions, ...questions], [{ ...questions[0], options: [] }], [{ ...questions[0], recommended: 2 }], [{ ...questions[0], question: " " }]]) assert.throws(() => parseQuestions(batch));
});
test("answers are complete, trimmed, ordered by question and accept custom input", () => {
  const batch = [...questions, { id: "time", question: "学习时间", options: [{ label: "每天一小时" }, { label: "每天两小时" }] }];
  assert.deepEqual(parseQuestionDecision({ decision: "answer", answers: [{ id: "time", value: " 每周三小时 " }, { id: "stack", value: "React" }] }, batch), {
    decision: "answer", answers: [{ id: "stack", value: "React" }, { id: "time", value: "每周三小时" }],
  });
});
test("missing, duplicated, blank, oversized or foreign answers are rejected", () => {
  for (const answers of [[], [{ id: "stack", value: " " }], [{ id: "stack", value: "x".repeat(4001) }], [{ id: "unknown", value: "React" }], [{ id: "stack", value: "React" }, { id: "stack", value: "Node.js" }]]) {
    assert.throws(() => parseQuestionDecision({ decision: "answer", answers }, questions));
  }
  assert.throws(() => parseQuestionDecision({ decision: "approve" }, questions));
});
test("cancelling questions is an independent decision without implicit answers", () => {
  assert.deepEqual(parseQuestionDecision({ decision: "cancel" }, questions), { decision: "cancel" });
});
