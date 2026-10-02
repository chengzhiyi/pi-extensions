import type { PlanQuestion } from './questions.js';

export interface QuestionDraft { selected?: number; custom: string; useCustom: boolean }
export interface QuestionProgress { index: number; drafts: QuestionDraft[] }

export function restoreQuestionProgress(saved: string | null, questions: readonly PlanQuestion[]): QuestionProgress | null {
  if (!saved) return null;
  try {
    const value = JSON.parse(saved);
    if (JSON.stringify(value.questions) !== JSON.stringify(questions) || !Number.isInteger(value.index) || value.index < 0 || value.index >= questions.length
      || !Array.isArray(value.drafts) || value.drafts.length !== questions.length) return null;
    if (!value.drafts.every((draft: QuestionDraft, index: number) => draft && typeof draft.custom === 'string' && typeof draft.useCustom === 'boolean'
      && (draft.selected === undefined || (Number.isInteger(draft.selected) && draft.selected >= 0 && draft.selected < questions[index]!.options.length)))) return null;
    return { index: value.index, drafts: value.drafts };
  } catch { return null; }
}

export function answerForDraft(question: PlanQuestion, draft: QuestionDraft): string {
  const text = draft.custom.trim();
  if (draft.useCustom) return text;
  const choice = question.options[draft.selected ?? -1]?.label ?? '';
  return choice && text ? `${choice}\n\n${text}` : choice;
}
