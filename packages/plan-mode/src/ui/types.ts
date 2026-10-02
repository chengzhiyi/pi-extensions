export type Copy = (key: string, params?: Record<string, string>) => string

export interface PlanReview {
  id: string
  question: string
  title: string
  callId?: string
  plan: string
  approve: { label: string; description?: string }
}
