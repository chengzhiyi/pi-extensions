import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button, extractMarkdownPlainText, IconEditOutlineRegular, StateDot } from './primitives.ts'
import type { Copy, PlanReview } from './types.ts'
import type { ReviewDecision } from '../state.js'
import css from './PlanReviewPanel.module.css'

export interface PlanReviewPanelProps {
  review: PlanReview
  t: Copy
  renderSlot(): React.ReactNode
  resolve(decision: ReviewDecision): Promise<void>
}

export function PlanReviewPanel({ review, t, renderSlot, resolve }: PlanReviewPanelProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const sending = useRef(false)
  const card = useRef<HTMLElement>(null)
  const feedbackId = useId()
  const errorId = useId()
  useEffect(() => { card.current?.focus() }, [])
  const settle = (decision: ReviewDecision): void => {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    void resolve(decision).catch((cause: unknown) => {
      sending.current = false
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }
  const summary = useMemo(() => extractMarkdownPlainText(review.plan, { mode: 'first-paragraph' }), [review.plan])
  const trimmed = feedback.trim()
  const invalid = trimmed.length > 4000
  return (
    <div className={css.frame} data-plan-review-key={review.id}>
      <section ref={card} tabIndex={-1} className={css.card} aria-label={review.question} aria-busy={busy}>
        <div className={css.strip}>
          <StateDot state={busy ? 'ongoing' : 'warning'} />{t('plan.header')}
          <div className={css.previewActions}>{renderSlot()}</div>
        </div>
        <div className={css.summary}>
          <h3 className={css.title}>{review.title}</h3>
          {summary !== review.title && <p className={css.description}>{summary}</p>}
        </div>
        <div className={css.revision}>
          <label htmlFor={feedbackId}>{t('plan.feedback')}</label>
          <textarea id={feedbackId} value={feedback} disabled={busy} rows={2}
            aria-invalid={invalid} aria-describedby={errorId} placeholder={t('plan.feedbackHint')}
            onChange={event => setFeedback(event.target.value)} />
        </div>
        <div className={css.footer}>
          <div id={errorId} className={css.feedback} role="alert">{error ?? (invalid ? t('plan.feedbackLimit') : '')}</div>
          <div className={css.actions}>
            <Button variant="outline" disabled={busy} onClick={() => settle({ decision: 'cancel' })}>{t('plan.cancel')}</Button>
            <Button variant="outline" className={css.discuss} icon={<IconEditOutlineRegular size={14} />}
              disabled={busy || !trimmed || invalid} onClick={() => settle({ decision: 'discuss', feedback: trimmed })}>{t('plan.discuss')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => settle({ decision: 'approve' })}>{t('plan.approve')}</Button>
          </div>
        </div>
      </section>
    </div>
  )
}
