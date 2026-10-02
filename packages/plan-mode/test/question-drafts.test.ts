import assert from 'node:assert/strict';
import test from 'node:test';
import { answerForDraft, restoreQuestionProgress } from '../src/question-drafts.ts';
import { parseQuestionDecision } from '../src/questions.ts';

const question = { id: 'stack', question: '选择技术栈', options: [{ label: 'React' }, { label: 'Python' }], recommended: 0 };

test('supplementing a choice preserves both the choice and the requirements in the submitted answer', () => {
  const value = answerForDraft(question, { selected: 0, custom: '  使用 TypeScript，重点学习错误排查  ', useCustom: false });
  assert.deepEqual(parseQuestionDecision({ decision: 'answer', answers: [{ id: 'stack', value }] }, [question]), {
    decision: 'answer', answers: [{ id: 'stack', value: 'React\n\n使用 TypeScript，重点学习错误排查' }],
  });
});

test('an explicit custom answer excludes the previously selected recommendation and requires text', () => {
  assert.equal(answerForDraft(question, { selected: 0, custom: '  Go + Gin  ', useCustom: true }), 'Go + Gin');
  assert.throws(() => parseQuestionDecision({ decision: 'answer', answers: [{ id: 'stack', value: answerForDraft(question, { selected: 0, custom: '  ', useCustom: true }) }] }, [question]));
});

test('choices without a supplement stay unchanged and the complete answer obeys the length limit', () => {
  assert.equal(answerForDraft(question, { selected: 1, custom: '  ', useCustom: false }), 'Python');
  assert.equal(answerForDraft(question, { custom: '直接回答', useCustom: true }), '直接回答');
  const value = answerForDraft(question, { selected: 0, custom: 'x'.repeat(4000), useCustom: false });
  assert.throws(() => parseQuestionDecision({ decision: 'answer', answers: [{ id: 'stack', value }] }, [question]));
});

test('refresh restores the current question and answers only for the same question batch', () => {
  const batch = [question, { ...question, id: 'environment' }];
  const progress = { index: 1, drafts: [{ selected: 1, custom: '', useCustom: false }, { custom: '本地 Docker', useCustom: true }] };
  const saved = JSON.stringify({ questions: batch, ...progress });
  assert.deepEqual(restoreQuestionProgress(saved, batch), progress);
  assert.equal(restoreQuestionProgress(saved, [{ ...question, options: [{ label: 'Go' }, { label: 'Rust' }] }]), null);
});

test('broken or out-of-range saved answers cannot replace the live question state', () => {
  for (const saved of ['invalid json', JSON.stringify({ questions: [question], index: 2, drafts: [] }), JSON.stringify({ questions: [question], index: 0, drafts: [{ selected: 9, custom: '', useCustom: false }] }), JSON.stringify({ questions: [question], index: 0, drafts: [{ selected: 0, custom: null, useCustom: false }] })]) {
    assert.equal(restoreQuestionProgress(saved, [question]), null);
  }
});
