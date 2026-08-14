import { useMemo, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, CircleHelp, Inbox, ShieldCheck } from 'lucide-react'
import type { Context } from '@deepseek-ai/cordis'
import type { AttentionItem, CompanionRuntimeService } from '@dsh-companion/runtime'
import type { RouteProps } from '@dsh-companion/ui-shell'

export const name = 'companion-ui-inbox'
export const inject = ['companionUi', 'companionRuntime']

type Filter = 'all' | 'pending' | 'outcome'

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待处理' },
  { id: 'outcome', label: '结果' },
]

function itemMeta(item: AttentionItem) {
  switch (item.kind) {
    case 'question': return { label: '需要回答', icon: CircleHelp, tone: 'question' }
    case 'approval': return { label: '等待审批', icon: ShieldCheck, tone: 'approval' }
    case 'completed': return { label: '已经完成', icon: CheckCircle2, tone: 'completed' }
    case 'failed': return { label: '执行失败', icon: AlertTriangle, tone: 'failed' }
    default: return item.kind satisfies never
  }
}

function timeLabel(timestamp: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp))
}

function InboxPage({ runtime, navigate }: { runtime: CompanionRuntimeService; navigate(path: string): void }) {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  const [filter, setFilter] = useState<Filter>('all')
  const pendingCount = snapshot.attention.filter(item => item.kind === 'question' || item.kind === 'approval').length
  const items = useMemo(() => snapshot.attention.filter(item => {
    if (filter === 'pending') return item.kind === 'question' || item.kind === 'approval'
    if (filter === 'outcome') return item.kind === 'completed' || item.kind === 'failed'
    return true
  }), [filter, snapshot.attention])

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
    component: ({ navigate }: RouteProps) => <InboxPage runtime={ctx.companionRuntime} navigate={navigate} />,
  })
}
