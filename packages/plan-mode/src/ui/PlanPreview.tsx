/** Read-only Markdown viewer for logged plans. */
import React from 'react'
import { DocumentIcon } from './primitives.ts'
import type { Copy } from './types.ts'
import type { PlanArtifact } from '../state.js'
import css from './PlanPreview.module.css'
import { PlanStatus } from './PlanStatus.tsx'

interface PlanPreviewProps {
  plan?: PlanArtifact
  t: Copy
  renderMarkdown(text: string): React.ReactNode
  resubmit?: (callId: string) => Promise<void>
}

/**
 * Render the submitted plan with its complete Markdown.
 * @param props - Selected plan, localized copy, and host Markdown renderer.
 * @returns the plan document or a localized unavailable state.
 */
export function PlanPreview({ plan, t, renderMarkdown, resubmit }: PlanPreviewProps) {
  if (plan === undefined) return (
    <div className={css.message} role="status">
      {t('preview.unavailable')}
    </div>
  )
  return (
    <section className={css.preview} data-plan-preview={plan.callId} aria-label={plan.title}>
      <PlanStatus plan={plan} t={t} resubmit={resubmit} />
      <div className={css.document}>{renderMarkdown(plan.markdown)}</div>
    </section>
  )
}

/**
 * Display a plain document icon and the selected plan's title.
 */
export function PlanTitle({ plan }: { plan?: PlanArtifact }) {
  return <><DocumentIcon kind="other" size={16} className={css.titleIcon} />{plan?.title ?? 'Plan'}</>
}
