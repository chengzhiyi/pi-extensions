/** Persistent transcript cards and pending-review sidebar navigation. */
import React, { useEffect } from 'react'
import { DocumentIcon, IconChevronRightOutlineRegular } from './primitives.ts'
import type { PlanArtifact } from '../state.js'
import type { Copy, PlanReview } from './types.ts'
import css from './PlanPreview.module.css'
import { PlanStatus } from './PlanStatus.tsx'

interface PlanCardsProps {
  turn: { turn: string }
  usePlans(key: string): readonly PlanArtifact[] | undefined
  openPlan(callId: string): void
  t: Copy
  resubmit?: (callId: string) => Promise<void>
}
interface PlanReviewOpenProps {
  review: PlanReview
  requestKey: string
  openReview(review: PlanReview, requestKey: string): void
  useSidebarMounted(select: (session: string | undefined) => boolean): boolean
  useStore(select: (state: { opened: Record<string, boolean> }) => boolean): boolean
  actions: { markOpened(identity: string): void }
  t: Copy
}

/**
 * Render the completed Turn's submitted plans in invocation order.
 * @param props - Logged plan, localized copy, and Session-bound navigation.
 * @returns keyboard-accessible plan cards, or null for a Turn without plans.
 */
export function PlanCards({ turn, usePlans, openPlan, t, resubmit }: PlanCardsProps) {
  const plans = usePlans(String(turn.turn))
  if (plans === undefined || plans.length === 0) return null
  return (
    <div className={css.cards} data-plan-artifacts>
      {plans.map(plan => <div key={plan.callId}><button type="button" className={css.card} data-plan-card={plan.callId}
        aria-label={t('preview.openNamed', { title: plan.title })}
        onClick={() => { openPlan(plan.callId) }}>
        <span className={css.cardIcon}><DocumentIcon kind="markdown" size={20} /></span>
        <span className={css.cardDetails}>
          <span className={css.cardTitle}>{plan.title}</span>
          <span className={css.cardDescription}>{t('preview.document')}</span>
        </span>
        <span className={css.cardOpen}>{t('preview.action')}</span>
      </button><PlanStatus plan={plan} t={t} resubmit={resubmit} /></div>)}
    </div>
  )
}

/**
 * Open each pending plan automatically and retain a manual opener without answering it.
 *
 * The automatic open waits for a mounted Sidebar seat: a review that arrives
 * while the Conversation is off screen mounts in the same commit as the seat,
 * ahead of it, and the seat binds from its own effect. Reading the bound
 * session through the hook opens once that binding exists.
 * @param props - Review identity, Session store, localized copy, and navigation.
 * @returns an opener for either logged or temporary plan text.
 */
export function PlanReviewOpen({ review, requestKey, openReview, useSidebarMounted, t, useStore, actions }: PlanReviewOpenProps) {
  const identity = review.callId === undefined ? `review:${requestKey}` : `call:${review.callId}`
  const opened = useStore(state => state.opened[identity] === true)
  const mounted = useSidebarMounted(session => session !== undefined)
  useEffect(() => {
    if (opened || !mounted) return
    openReview(review, requestKey)
    actions.markOpened(identity)
  }, [identity, opened, mounted, openReview, review, requestKey, actions])
  return <button type="button" className={css.reviewLink} title={t('preview.open')} aria-label={t('preview.open')}
    onClick={() => { openReview(review, requestKey) }}>{t('preview.full')}<IconChevronRightOutlineRegular size={14} /></button>
}
