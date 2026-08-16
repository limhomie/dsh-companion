import { useMemo, useState, useSyncExternalStore } from 'react'
import { CheckCircle2, ChevronRight, CircleHelp, Inbox, ListChecks, ShieldCheck } from 'lucide-react'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { workspaceTitleOf } from '@deepseek-ai/dsh-client-runtime/client'
import type { RouteProps } from '@dsh-companion/ui-shell'

export const name = 'companion-ui-inbox'
export const inject = ['companionUi', 'sessions']

type Filter = 'all' | 'pending' | 'outcome'
type AttentionKind = 'question' | 'plan-review' | 'approval' | 'completed'

export interface AttentionItem {
  id: string
  kind: AttentionKind
  sessionId: SessionId
  title: string
  summary: string
  workspace: string
  updatedAt: number
}

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待处理' },
  { id: 'outcome', label: '结果' },
]

/** Derive the cross-Session inbox without owning a second state store. */
export function deriveAttention(snapshot: SessionListState): readonly AttentionItem[] {
  return snapshot.ids.flatMap<AttentionItem>(id => {
    const session = snapshot.byId[id]
    if (session === undefined) return []
    const workspace = session.cwd === undefined ? '未提供工作区' : workspaceTitleOf(session.cwd) || session.cwd
    if (session.pendingInteraction !== undefined) {
      const kind = session.pendingInteraction
      const summary = kind === 'approval'
        ? 'Agent 正在等待你的审批。'
        : kind === 'plan-review'
          ? 'Agent 提交了一份计划等待确认。'
          : 'Agent 有问题需要你回答。'
      return [{
        id: `pending:${id}`,
        kind,
        sessionId: id,
        title: session.displayTitle,
        summary,
        workspace,
        updatedAt: session.updatedAt,
      }]
    }
    if (session.completed !== true) return []
    return [{
      id: `completed:${id}`,
      kind: 'completed' as const,
      sessionId: id,
      title: session.displayTitle,
      summary: '这个 Session 已经完成。',
      workspace,
      updatedAt: session.updatedAt,
    }]
  }).sort((left, right) => right.updatedAt - left.updatedAt)
}

function itemMeta(item: AttentionItem) {
  switch (item.kind) {
    case 'question': return { label: '需要回答', icon: CircleHelp, tone: 'question' }
    case 'plan-review': return { label: '计划评审', icon: ListChecks, tone: 'question' }
    case 'approval': return { label: '等待审批', icon: ShieldCheck, tone: 'approval' }
    case 'completed': return { label: '已经完成', icon: CheckCircle2, tone: 'completed' }
    default: return item.kind satisfies never
  }
}

function timeLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp))
}

function InboxPage({ sessions, navigate }: { sessions: ISessions; navigate(path: string): void }) {
  const snapshot = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  const [filter, setFilter] = useState<Filter>('all')
  const attention = useMemo(() => deriveAttention(snapshot), [snapshot])
  const pendingCount = attention.filter(item => item.kind !== 'completed').length
  const items = useMemo(() => attention.filter(item => {
    if (filter === 'pending') return item.kind !== 'completed'
    if (filter === 'outcome') return item.kind === 'completed'
    return true
  }), [attention, filter])

  return (
    <div className="page page-inbox">
      <header className="page-header">
        <div>
          <p className="eyebrow">需要你的注意</p>
          <h1>收件箱</h1>
        </div>
        <div className="header-count" aria-label={`${pendingCount} 项待处理`}>
          <strong>{pendingCount}</strong><span>待处理</span>
        </div>
      </header>

      <div className="segmented-control" aria-label="收件箱筛选">
        {FILTERS.map(item => (
          <button key={item.id} type="button" data-active={filter === item.id} onClick={() => { setFilter(item.id) }}>
            {item.label}
          </button>
        ))}
      </div>

      <section className="attention-list" aria-label="事项列表" aria-live="polite">
        {items.map(item => {
          const meta = itemMeta(item)
          const Icon = meta.icon
          return (
            <button
              className="attention-row"
              data-tone={meta.tone}
              data-testid={`attention-${item.id}`}
              key={item.id}
              type="button"
              onClick={() => { navigate(`/sessions/${item.sessionId}`) }}
            >
              <span className="attention-icon"><Icon aria-hidden="true" size={20} /></span>
              <span className="attention-copy">
                <span className="attention-meta"><span>{meta.label}</span><time>{timeLabel(item.updatedAt)}</time></span>
                <strong>{item.title}</strong>
                <span className="attention-summary">{item.summary}</span>
                <span className="workspace-label">{item.workspace}</span>
              </span>
              <ChevronRight className="row-chevron" aria-hidden="true" size={19} />
            </button>
          )
        })}
        {items.length === 0 && (
          <div className="empty-state">
            <Inbox aria-hidden="true" size={30} />
            <strong>这里已经处理完了</strong>
            <span>新的待处理事项会出现在这里。</span>
          </div>
        )}
      </section>
    </div>
  )
}

export function apply(ctx: Context): void {
  ctx.companionUi.registerRoute({
    id: 'inbox',
    path: '/inbox',
    label: '收件箱',
    order: 10,
    icon: Inbox,
    badge: 'attention',
    match: path => path === '/' || path === '/inbox',
    component: ({ navigate }: RouteProps) => <InboxPage sessions={ctx.sessions} navigate={navigate} />,
  })
}
