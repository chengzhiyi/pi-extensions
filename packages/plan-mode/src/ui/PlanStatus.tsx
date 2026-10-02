import React, { useRef, useState } from 'react'
import type { PlanArtifact } from '../state.js'
import type { Copy } from './types.ts'
import css from './PlanPreview.module.css'

export function PlanStatus({ plan, t, resubmit }: { plan: PlanArtifact; t: Copy; resubmit?: (callId: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sending = useRef(false)
  const retry = () => {
    if (!resubmit || sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    void resubmit(plan.callId).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => { sending.current = false; setBusy(false) })
  }
  return <div className={css.status} data-plan-status={plan.status}>
    <span>{t('plan.version', { revision: String(plan.revision) })} · {t(`status.${plan.status}`)}</span>
    {plan.feedback && <p>{t('plan.feedback')}：{plan.feedback}</p>}
    {(plan.canResubmit || plan.canResume) && <><p>{t(plan.canResume ? 'plan.resumeReason' : 'plan.interruptedReason')}</p>{resubmit && <button type="button" className={css.cardOpen} disabled={busy} onClick={retry}>{t(plan.canResume ? 'plan.resume' : 'plan.resubmit')}</button>}</>}
    {error && <p role="alert">{error}</p>}
  </div>
}
