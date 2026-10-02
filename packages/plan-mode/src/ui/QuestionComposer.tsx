import React, { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Button, IconEditOutlineRegular } from './primitives.ts'
import { IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconCloseOutlineRegular } from './primitives/icons/index.tsx'
import type { PlanQuestion, QuestionDecision } from '../questions.js'
import { answerForDraft, restoreQuestionProgress, type QuestionDraft, type QuestionProgress } from '../question-drafts.js'
import css from './QuestionComposer.module.css'

export function QuestionComposer({ questions, locale, draftKey, resolve }: {
  questions: readonly PlanQuestion[]; locale: 'zh' | 'en'; draftKey: string; resolve(value: QuestionDecision): Promise<void>
}) {
  const copy = (zh: string, en: string) => locale === 'zh' ? zh : en
  const storageKey = `pi-plan-question-draft:${draftKey}`
  const [progress, setProgress] = useState<QuestionProgress>(() => {
    try {
      const saved = restoreQuestionProgress(sessionStorage.getItem(storageKey), questions)
      if (saved) return saved
    } catch { /* The questionnaire works when browser storage is unavailable. */ }
    return { index: 0, drafts: questions.map(question => ({ selected: question.recommended ?? 0, custom: '', useCustom: false })) }
  })
  const { index, drafts } = progress
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sending = useRef(false)
  const card = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const options = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  useEffect(() => {
    card.current?.focus({ preventScroll: true })
    if (body.current) body.current.scrollTop = 0
  }, [index])
  useEffect(() => {
    if (sending.current) return
    try { sessionStorage.setItem(storageKey, JSON.stringify({ questions, ...progress })) } catch { /* Best-effort draft persistence. */ }
  }, [progress, storageKey])
  const question = questions[index]!
  const draft = drafts[index]!
  const values = questions.map((item, position) => answerForDraft(item, drafts[position]!))
  const valid = !!values[index] && values[index]!.length <= 4000
  const invalid = values[index]!.length > 4000
  const last = index === questions.length - 1
  const update = (patch: Partial<QuestionDraft>) => {
    setError(null)
    setProgress(current => ({ ...current, drafts: current.drafts.map((value, position) => position === index ? { ...value, ...patch } : value) }))
  }
  const go = (position: number) => {
    if (busy || position < 0 || position >= questions.length) return
    setError(null)
    setProgress(current => ({ ...current, index: position }))
  }
  const settle = async (value: QuestionDecision) => {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      await resolve(value)
      try { sessionStorage.removeItem(storageKey) } catch { /* Storage may be blocked. */ }
    } catch (cause) {
      sending.current = false
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const advance = (nextDrafts = drafts) => {
    if (busy) return
    const answers = questions.map((item, position) => ({ id: item.id, value: answerForDraft(item, nextDrafts[position]!) }))
    if (!answers[index]!.value || answers[index]!.value.length > 4000) return
    if (!last) { go(index + 1); return }
    const missing = answers.findIndex(answer => !answer.value || answer.value.length > 4000)
    if (missing >= 0) {
      go(missing)
      setError(copy('请先完成这道题，再提交所有回答', 'Complete this question before submitting all answers'))
      return
    }
    void settle({ decision: 'answer', answers })
  }
  const choose = (position: number, continueAfter: boolean) => {
    if (busy) return
    const selected = { selected: position, custom: '', useCustom: false }
    update(selected)
    if (continueAfter) advance(drafts.map((value, at) => at === index ? selected : value))
  }
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (busy || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    const editing = event.target === input.current
    if (editing) {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); advance() }
      return
    }
    if (event.altKey || event.metaKey || event.ctrlKey) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); go(index + (event.key === 'ArrowRight' ? 1 : -1))
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const position = Math.max(0, Math.min(question.options.length - 1, (draft.selected ?? -1) + (event.key === 'ArrowDown' ? 1 : -1)))
      choose(position, false); options.current[position]?.focus()
    } else if (/^[1-5]$/.test(event.key) && Number(event.key) <= question.options.length) {
      event.preventDefault(); choose(Number(event.key) - 1, true)
    } else if (event.key === 'Enter' && event.target === card.current) {
      event.preventDefault(); advance()
    }
  }
  return <div className={css.frame} data-plan-question-composer="">
    <section ref={card} tabIndex={-1} className={css.card} aria-label={copy('计划澄清', 'Planning questions')} aria-busy={busy}
      aria-labelledby={`${id}-question`} aria-describedby={`${id}-progress`} onKeyDown={keyboard}>
      <header className={css.header}>
        <h3 id={`${id}-question`} className={css.title} aria-live="polite">{question.question}</h3>
        <div className={css.navigation}>
          <Button className={css.iconButton} size="sm" disabled={busy || index === 0} title={copy('上一题 · ←', 'Previous question · ←')} aria-label={copy('上一题', 'Previous question')} onClick={() => go(index - 1)}><IconChevronLeftOutlineRegular /></Button>
          <span id={`${id}-progress`} className={css.progress} aria-live="polite">{index + 1}/{questions.length}</span>
          <Button className={css.iconButton} size="sm" disabled={busy || last} title={copy('下一题 · →', 'Next question · →')} aria-label={copy('下一题', 'Next question')} onClick={() => go(index + 1)}><IconChevronRightOutlineRegular /></Button>
          <Button className={css.iconButton} size="sm" disabled={busy} title={copy('取消提问', 'Cancel questions')} aria-label={copy('取消提问', 'Cancel questions')} onClick={() => void settle({ decision: 'cancel' })}><IconCloseOutlineRegular /></Button>
        </div>
      </header>
      <div ref={body} className={css.body} role="radiogroup" aria-labelledby={`${id}-question`}>
        {question.options.map((option, position) => {
          const selected = !draft.useCustom && draft.selected === position
          return <button key={`${question.id}/${position}`} ref={element => { options.current[position] = element }} type="button" role="radio" aria-checked={selected}
            disabled={busy} tabIndex={selected || (draft.useCustom && position === 0) ? 0 : -1} className={`${css.option} ${selected ? css.selected : ''}`} onClick={() => choose(position, true)}>
            <span className={css.number} aria-hidden="true">{position + 1}</span>
            <span className={css.optionContent}><span className={css.optionLabel}>{question.recommended === position ? option.label.replace(/\s*[（(](?:推荐|recommended)[）)]\s*$/i, '') : option.label}
              {question.recommended === position && <span className={css.recommended}>{copy('推荐', 'Recommended')}</span>}</span>
              {option.description && <span className={css.description}>{option.description}</span>}</span>
            <span className={css.choiceKeys} aria-hidden="true">↑↓</span>
          </button>
        })}
      </div>
      <footer className={css.footer}>
        <div className={css.answerRow}>
          <IconEditOutlineRegular className={css.editIcon} />
          <div className={css.answerField}>
            <span className={css.answerMirror} aria-hidden="true">{draft.custom || ' '}<br /></span>
            <textarea ref={input} id={`${id}-custom`} rows={1} value={draft.custom} disabled={busy} aria-label={copy('自定义回答', 'Custom answer')}
              aria-invalid={invalid} aria-describedby={`${id}-error`} placeholder={copy('其他答案…', 'Something else…')}
              onFocus={() => update({ useCustom: true })} onChange={event => update({ custom: event.target.value, useCustom: true })} />
          </div>
          <Button className={css.continueButton} variant="primary" disabled={busy || !valid} onClick={() => advance()}>{busy ? copy('提交中…', 'Submitting…') : last ? copy('提交', 'Submit') : copy('继续', 'Continue')}<kbd aria-hidden="true">↵</kbd></Button>
        </div>
        <div id={`${id}-error`} role="alert" className={css.error}>{error ?? (invalid ? copy('回答不能超过 4000 字符', 'Answers cannot exceed 4000 characters') : '')}</div>
      </footer>
    </section>
  </div>
}
