export interface PlanQuestion {
  id: string;
  question: string;
  options: { label: string; description?: string }[];
  recommended?: number;
}
export type QuestionDecision = { decision: "cancel" } | { decision: "answer"; answers: { id: string; value: string }[] };

function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit) throw new Error(`Expected 1–${limit} characters`);
  return value.trim();
}
export function parseQuestions(value: unknown): PlanQuestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) throw new Error("Ask 1–5 questions at a time");
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== "object") throw new Error("Invalid question");
    const id = text(item.id, 80);
    if (ids.has(id)) throw new Error("Question IDs must be unique");
    ids.add(id);
    if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 5) throw new Error("Provide 2–5 choices per question");
    const options = item.options.map((option: Record<string, unknown>) => {
      if (!option || typeof option !== "object") throw new Error("Invalid option");
      return { label: text(option.label, 200), ...(option.description === undefined ? {} : { description: text(option.description, 1000) }) };
    });
    if (new Set(options.map((option: { label: string }) => option.label)).size !== options.length) throw new Error("Choices must be unique");
    if (item.recommended !== undefined && (!Number.isInteger(item.recommended) || item.recommended < 0 || item.recommended >= options.length)) throw new Error("Invalid recommended choice");
    return { id, question: text(item.question, 2000), options, ...(item.recommended === undefined ? {} : { recommended: item.recommended }) };
  });
}
export function parseQuestionDecision(value: unknown, questions: readonly PlanQuestion[]): QuestionDecision {
  if (!value || typeof value !== "object") throw new Error("Invalid question response");
  const data = value as Record<string, unknown>;
  if (data.decision === "cancel") return { decision: "cancel" };
  if (data.decision !== "answer" || !Array.isArray(data.answers) || data.answers.length !== questions.length) throw new Error("Answer every question");
  const answers = new Map<string, string>();
  for (const item of data.answers) {
    if (!item || typeof item !== "object" || !questions.some(question => question.id === item.id) || answers.has(item.id)) throw new Error("Invalid answer identity");
    answers.set(item.id, text(item.value, 4000));
  }
  return { decision: "answer", answers: questions.map(question => ({ id: question.id, value: answers.get(question.id)! })) };
}
