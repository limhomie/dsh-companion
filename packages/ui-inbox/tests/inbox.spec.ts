import type { SessionId, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it, vi } from 'vitest'
import { deriveAttention } from '../src/index.tsx'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  workspaceTitleOf: (cwd: string) => cwd.split(/[\\/]/).at(-1) ?? cwd,
}))

function summary(id: SessionId, overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id,
    displayTitle: String(id),
    running: false,
    blank: false,
    updatedAt: 0,
    ...overrides,
  }
}

function snapshot(rows: readonly SessionSummary[]): SessionListState {
  return {
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, row])) as Record<SessionId, SessionSummary>,
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

describe('attention inbox projection', () => {
  it('derives pending work and completed outcomes from the Harness list snapshot', () => {
    const approval = 'approval' as SessionId
    const question = 'question' as SessionId
    const completed = 'completed' as SessionId

    const items = deriveAttention(snapshot([
      summary(approval, { displayTitle: '审批', pendingInteraction: 'approval', cwd: 'D:/work/a', updatedAt: 20 }),
      summary(question, { displayTitle: '提问', pendingInteraction: 'question', cwd: 'D:/work/b', updatedAt: 30 }),
      summary(completed, { displayTitle: '完成', completed: true, updatedAt: 10 }),
    ]))

    expect(items.map(item => [item.kind, item.title])).toEqual([
      ['question', '提问'],
      ['approval', '审批'],
      ['completed', '完成'],
    ])
    expect(items[0]?.id).toBe('pending:question')
  })

  it('does not invent an inbox item for an ordinary running Session', () => {
    const running = 'running' as SessionId
    expect(deriveAttention(snapshot([summary(running, { running: true })]))).toEqual([])
  })
})
