import React, { useEffect, useRef, useState } from 'react'
import { IconCloseCircleFillRegular, IconPlanOutlineRegular } from './primitives.ts'
import type { Copy } from './types.ts'
import css from './PlanModeControl.module.css'

export interface PlanChipProps {
  useProjection(key: 'plan'): { active: boolean; pending: boolean } | undefined
  executing?: boolean
  locked: boolean
  exitPlanMode(): Promise<string | null>
  t: Copy
}

/**
 * Plan-mode status over the host-computed `plan` projection. The chip renders
 * only while the effective target is plan mode (`pending ? !active : active`
 * — a folded host value, not client optimism) and executes /plan off.
 */
export function PlanChip({ useProjection, locked, executing, exitPlanMode, t }: PlanChipProps) {
  const plan = useProjection('plan')
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  if (plan === undefined) return null
  const target = plan.pending ? !plan.active : plan.active
  if (!target) return null

  const off = (): void => {
    // No leaving/locked guard: both disable the button, so no click arrives.
    setLeaving(true)
    setError(null)
    void exitPlanMode().then((failure) => {
      if (!aliveRef.current) return
      setLeaving(false)
      setError(failure)
    }, (reason: unknown) => {
      if (!aliveRef.current) return
      setLeaving(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={css.chip}
        aria-label={t(executing ? 'chip.executing' : 'chip.on.aria')}
        title={t(executing ? 'chip.executing' : 'chip.on.title')}
        disabled={locked || leaving}
        onClick={off}
      >
        <span className={css.glyph} aria-hidden>
          <IconPlanOutlineRegular className={css.restGlyph} size={14} />
          <IconCloseCircleFillRegular className={css.hoverGlyph} size={14} />
        </span>
        {t(executing ? 'chip.executing' : 'chip.label')}
      </button>
      {error !== null && <span className={css.error} role="status" title={error}>{t('chip.exitFailed')}</span>}
    </span>
  )
}
