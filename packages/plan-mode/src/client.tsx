import React from "react";
import { defineWebPlugin, type PluginEntry, type WebSlotProps, type WebComposerAction } from "@chengzhiyi/pi-web-protocol";
import { PLAN_TOOL, QUESTION_TOOL, QUESTIONS_KIND, ANSWERS_KIND, PLUGIN_ID, STATE_KIND, type PlanDocument, planArtifacts } from "./state.js";
import { PlanChip } from "./ui/PlanModeControl.tsx";
import { PlanCards, PlanReviewOpen } from "./ui/PlanCard.tsx";
import { PlanPreview, PlanTitle } from "./ui/PlanPreview.tsx";
import { PlanReviewPanel } from "./ui/PlanReviewPanel.tsx";
import { IconPlanOutlineRegular } from "./ui/primitives.ts";
import { QuestionComposer } from "./ui/QuestionComposer.tsx";
import questionCss from "./ui/QuestionComposer.module.css";
import { parseQuestions, parseQuestionDecision } from "./questions.js";
import { copyFor } from "./ui/locales.ts";

function latestState(entries: readonly PluginEntry[]): boolean {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.pluginId === PLUGIN_ID && entry.kind === STATE_KIND) return (entry.data as { enabled?: unknown } | undefined)?.enabled === true;
  }
  return false;
}
function entries(session: WebSlotProps["session"]) {
  return (session?.pluginEntries ?? []).filter(entry => entry.pluginId === PLUGIN_ID)
    .map(entry => ({ type: "custom", customType: entry.kind, data: entry.data }));
}
function artifacts(session: WebSlotProps["session"]) {
  return planArtifacts(entries(session), { running: session?.idle === false,
    pendingCallIds: session?.interactions?.filter(item => item.pluginId === PLUGIN_ID && item.kind === "plan.review")
      .map(item => (item.data as PlanDocument).callId) ?? [] });
}
function resubmitFor(props: WebSlotProps) {
  return async (callId: string) => {
    await props.invokeAction("plan.recover", { callId });
  };
}
function ResumeIcon({ size = 16 }: { size?: number }) {
  return <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true"><path d="M4 2.5a.75.75 0 0 1 1.15-.64l8 5.5a.75.75 0 0 1 0 1.28l-8 5.5A.75.75 0 0 1 4 13.5Z" fill="currentColor" /></svg>;
}
function composerAction(session: NonNullable<WebSlotProps['session']>, locale: 'zh' | 'en'): WebComposerAction | undefined {
  if (!latestState(session.pluginEntries)) return;
  const plans = artifacts(session);
  if (!session.idle && plans.some(plan => plan.status === 'executing')) return {
    kind: 'stop', label: locale === 'zh' ? '暂停执行' : 'Pause execution',
    title: locale === 'zh' ? '暂停当前执行；保留进度，继续时重新审批' : 'Pause execution; keep progress and review before continuing',
  };
  const plan = [...plans].reverse().find(plan => plan.canResume);
  if (!session.idle || !plan) return;
  return { kind: 'invoke', label: locale === 'zh' ? '继续执行计划' : 'Continue plan',
    title: locale === 'zh' ? '检查已有进度，重新审批并继续未完成步骤' : 'Check progress, review and continue unfinished steps',
    icon: ResumeIcon, action: 'plan.recover', input: { callId: plan.callId } };
}
function Control({ session, invokeAction, locale }: WebSlotProps) {
  return <PlanChip useProjection={() => session ? { active: latestState(session.pluginEntries), pending: false } : undefined}
    locked={!session?.idle} executing={artifacts(session).some(plan => plan.status === "executing")} t={copyFor(locale)} exitPlanMode={async () => {
      await invokeAction("plan.setMode", { enabled: false }); return null;
    }} />;
}
function Cards(props: WebSlotProps) {
  const { session, turn, openPanel, locale } = props;
  if (!session || !turn) return null;
  return <><QuestionHistory {...props} /><PlanCards turn={{ turn: turn.id }} usePlans={() => artifacts(session).filter((plan) => turn.toolCallIds.includes(plan.callId))}
    openPlan={(callId) => openPanel(`plan:${callId}`)} t={copyFor(locale)} resubmit={session.idle ? resubmitFor(props) : undefined} /></>;
}
function Questions({ interaction, session, locale, resolveInteraction }: WebSlotProps) {
  if (!interaction) return null;
  let questions;
  try { questions = parseQuestions((interaction.data as { questions?: unknown })?.questions); } catch { return null; }
  return <QuestionComposer key={interaction.requestId} draftKey={`${session?.sessionId}/${interaction.requestId}`} questions={questions} locale={locale} resolve={resolveInteraction} />;
}
function QuestionHistory({ session, turn, locale }: WebSlotProps) {
  if (!session || !turn) return null;
  return <>{session.pluginEntries.filter(entry => entry.pluginId === PLUGIN_ID && entry.kind === QUESTIONS_KIND).map(entry => {
    const data = entry.data as { callId?: string; questions?: unknown };
    if (!data.callId || !turn.toolCallIds.includes(data.callId)) return null;
    try {
      const questions = parseQuestions(data.questions);
      const answer = [...session.pluginEntries].reverse().find(item => item.pluginId === PLUGIN_ID && item.kind === ANSWERS_KIND && (item.data as { callId?: string })?.callId === data.callId);
      const decision = answer ? parseQuestionDecision(answer.data, questions) : null;
      const pending = session.interactions?.some(item => item.pluginId === PLUGIN_ID && item.kind === "plan.questions" && (item.data as { callId?: string })?.callId === data.callId);
      const status = decision?.decision === "answer" ? (locale === "zh" ? "已回答" : "Answered") : decision?.decision === "cancel" ? (locale === "zh" ? "已取消提问" : "Questions cancelled") : pending ? (locale === "zh" ? "待回答" : "Awaiting answers") : (locale === "zh" ? "提问已中断" : "Questions interrupted");
      return <details key={entry.id} className={questionCss.history}>
        <summary>{status} · {questions.length} {locale === "zh" ? "个问题" : "questions"}</summary>
        <dl>{questions.map(question => <React.Fragment key={question.id}><dt>{question.question}</dt><dd>{decision?.decision === "answer" ? decision.answers.find(item => item.id === question.id)?.value : '—'}</dd></React.Fragment>)}</dl>
      </details>;
    } catch { return null; }
  })}</>;
}
function selectedPlan({ session, panelId }: WebSlotProps) {
  return panelId?.startsWith("plan:") ? artifacts(session).find((plan) => plan.callId === panelId.slice(5)) : undefined;
}
function Preview(props: WebSlotProps) {
  if (!props.panelId?.startsWith("plan:")) return null;
  return <PlanPreview plan={selectedPlan(props)} t={copyFor(props.locale)} renderMarkdown={props.renderMarkdown} resubmit={props.session?.idle ? resubmitFor(props) : undefined} />;
}
function Title(props: WebSlotProps) {
  if (!props.panelId?.startsWith("plan:")) return null;
  return <PlanTitle plan={selectedPlan(props)} />;
}
// Browser-lifetime ledger, partitioned by session. Closing a preview must not
// reopen it on unrelated snapshots; a page refresh recovers a pending review.
const opened: Record<string, Record<string, boolean>> = {};
function Review(props: WebSlotProps) {
  const { interaction, session, locale, openPanel, resolveInteraction } = props;
  if (!interaction || !session) return null;
  const plan = artifacts(session).find((item) => item.callId === (interaction.data as PlanDocument)?.callId);
  if (!plan) return null;
  const t = copyFor(locale);
  const review = { id: interaction.requestId, question: t("plan.header"), title: plan.title, callId: plan.callId, plan: plan.markdown, approve: { label: "approve" } };
  const ledger = opened[session.sessionId] ??= {};
  return <PlanReviewPanel key={interaction.requestId} review={review} t={t} resolve={resolveInteraction}
    renderSlot={() => <PlanReviewOpen review={review} requestKey={interaction.requestId} t={t}
      openReview={() => openPanel(`plan:${plan.callId}`)} useSidebarMounted={(select) => select(session.sessionId)}
      useStore={(select) => select({ opened: ledger })} actions={{ markOpened: (identity) => { ledger[identity] = true; } }} />} />;
}
const plugin = defineWebPlugin({
  id: PLUGIN_ID, apiVersion: 1,
  activate() {},
  composerAction,
  slots: [
    { id: "mode-control", slot: "composer.controls", component: Control },
    { id: "plan-card", slot: "turn.tail", component: Cards },
    { id: "plan-preview", slot: "rightbar.panel", component: Preview },
    { id: "plan-title", slot: "rightbar.title", component: Title },
  ],
  interactions: [{ kind: "plan.review", component: Review }, { kind: "plan.questions", component: Questions }],
  composerPlaceholder: (session, locale) => latestState(session.pluginEntries) ? (locale === "zh" ? "描述你的任务以生成计划" : "Describe your task to generate a plan") : undefined,
  artifactTools: [PLAN_TOOL, QUESTION_TOOL],
  commands: [{
    id: "plan", title: "Plan mode", action: "plan.command", args: ["on", "off"],
    presentation: {
      label: { zh: "计划", en: "Plan" },
      description: { zh: "进入或退出计划模式", en: "Enter or leave plan mode" },
      icon: IconPlanOutlineRegular, section: "add",
    },
    input: {
      token: { zh: "计划", en: "plan" },
      hint: { zh: "描述你的任务以生成计划", en: "Describe your task to generate a plan" },
      attachments: true,
    },
  }],
});
export default plugin;
