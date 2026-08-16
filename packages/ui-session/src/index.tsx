import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Clock3,
  LoaderCircle,
  MessageSquare,
  Play,
  ShieldCheck,
  X,
} from 'lucide-react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, HostDescription } from '@deepseek-ai/dsh-client-connection/client'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import type {
  ISessions,
  PendingInteraction,
  SessionFace,
  SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import { workspaceTitleOf } from '@deepseek-ai/dsh-client-runtime/client'
import type { RouteProps } from '@dsh-companion/ui-shell'
import type { CompanionDeviceTrustService } from '@dsh-companion/device-trust-web'
import { ConversationHistory } from './conversation.tsx'

export const name = 'companion-ui-session'
export const inject = ['companionUi', 'companionDeviceTrust', 'connection', 'sessions']

type ApprovalWait = Extract<PendingInteraction, { kind: 'approval' }>
type QuestionWait = Extract<PendingInteraction, { kind: 'question' }>
type RenderStatus = 'running' | 'waiting' | 'completed'

function renderStatus(session: SessionSummary): RenderStatus {
  if (session.pendingInteraction !== undefined) return 'waiting'
  if (session.running) return 'running'
  return 'completed'
}

function statusMeta(status: RenderStatus) {
  switch (status) {
    case 'running': return { label: '运行中', icon: Play }
    case 'waiting': return { label: '等待你', icon: Clock3 }
    case 'completed': return { label: '已完成', icon: CheckCircle2 }
    default: return status satisfies never
  }
}

function workspaceLabel(cwd: string | undefined): string {
  if (cwd === undefined) return '未提供工作区'
  return workspaceTitleOf(cwd) || cwd
}

function summaryLabel(session: SessionSummary): string {
  if (session.pendingInteraction === 'approval') return '等待审批后继续执行'
  if (session.pendingInteraction === 'plan-review') return '等待确认执行计划'
  if (session.pendingInteraction === 'question') return '等待回答后继续执行'
  if (session.running) return 'Agent 正在执行任务'
  return 'Session 当前没有运行中的任务'
}

function SessionsList({ sessions, navigate }: { sessions: ISessions; navigate(path: string): void }) {
  const snapshot = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  return (
    <div className="page page-sessions">
      <header className="page-header">
        <div><p className="eyebrow">工作室电脑</p><h1>Session</h1></div>
        <div className="header-count subtle"><strong>{snapshot.ids.length}</strong><span>最近任务</span></div>
      </header>
      <section className="session-list" aria-label="Session 列表">
        {snapshot.ids.map(id => {
          const session = snapshot.byId[id]
          if (session === undefined) return null
          const status = renderStatus(session)
          const meta = statusMeta(status)
          const Icon = meta.icon
          return (
            <button className="session-row" key={id} type="button" onClick={() => { navigate(`/sessions/${id}`) }}>
              <span className="session-status-icon" data-status={status}><Icon aria-hidden="true" size={18} /></span>
              <span className="session-row-copy">
                <span className="session-row-meta"><span>{workspaceLabel(session.cwd)}</span><span>{meta.label}</span></span>
                <strong>{session.displayTitle}</strong>
                <span>{summaryLabel(session)}</span>
              </span>
              <ChevronRight aria-hidden="true" size={19} />
            </button>
          )
        })}
        {snapshot.phase === 'ready' && snapshot.ids.length === 0 && (
          <div className="empty-state"><MessageSquare aria-hidden="true" size={28} /><strong>还没有 Session</strong></div>
        )}
      </section>
    </div>
  )
}

function useHost(connection: ConnectionHandle): HostDescription | undefined {
  return useSyncExternalStore<HostDescription | undefined>(
    connection.hostDescription.subscribe,
    connection.hostDescription.getSnapshot,
  )
}

function ApprovalPanel({ wait, connected }: { wait: ApprovalWait; connected: boolean }) {
  const [state, setState] = useState<'idle' | 'submitting' | 'failed'>('idle')
  const [error, setError] = useState<string>()

  const submit = (outcome: 'allowed-once' | 'rejected') => {
    setState('submitting')
    setError(undefined)
    void wait.respond({
      ok: true,
      value: { sessionId: wait.sessionId, approvalId: wait.payload.approvalId, outcome },
    }).then(receipt => {
      if (!receipt.accepted) throw new Error(`Host 拒绝了这次应答：${receipt.reason}`)
    }).catch((cause: unknown) => {
      setState('failed')
      setError(cause instanceof Error ? cause.message : '提交失败')
    })
  }

  const submitting = state === 'submitting'
  return (
    <section className="interaction-panel" data-testid={`interaction-${wait.key}`} data-state={state}>
      <div className="interaction-heading">
        <span className="interaction-leading"><ShieldCheck aria-hidden="true" size={20} /></span>
        <div><span>需要审批</span><h2>{wait.payload.toolName}</h2></div>
      </div>
      <div className="approval-detail">
        <div className="approval-meta"><span>{wait.payload.toolName}</span><span data-risk="medium">等待决定</span></div>
        {wait.payload.callId !== undefined && <code>{wait.payload.callId}</code>}
        <p>{wait.payload.reason ?? '这个工具调用需要你的明确许可。'}</p>
      </div>
      {error !== undefined && <p className="inline-error"><CircleAlert aria-hidden="true" size={16} />{error}</p>}
      <div className="interaction-actions">
        <button className="button secondary" type="button" disabled={!connected || submitting} onClick={() => { submit('rejected') }}>
          <X aria-hidden="true" size={18} />拒绝
        </button>
        <button className="button primary" type="button" disabled={!connected || submitting} onClick={() => { submit('allowed-once') }}>
          {submitting
            ? <><LoaderCircle className="spin" aria-hidden="true" size={18} />等待 Host 确认</>
            : <><Check aria-hidden="true" size={18} />允许一次</>}
        </button>
      </div>
    </section>
  )
}

function QuestionPanel({ wait, connected }: { wait: QuestionWait; connected: boolean }) {
  const [selected, setSelected] = useState<Readonly<Record<string, readonly string[]>>>({})
  const [custom, setCustom] = useState<Readonly<Record<string, string>>>({})
  const [state, setState] = useState<'idle' | 'submitting' | 'failed'>('idle')
  const [error, setError] = useState<string>()
  const questions: readonly AskUserQuestionItem[] = wait.payload.questions

  const choose = (questionId: string, option: string, multiSelect: boolean) => {
    setSelected(current => {
      const values = current[questionId] ?? []
      const next = multiSelect
        ? values.includes(option) ? values.filter(value => value !== option) : [...values, option]
        : [option]
      return { ...current, [questionId]: next }
    })
  }

  const submit = () => {
    setState('submitting')
    setError(undefined)
    const answers = questions.map(question => {
      const value = custom[question.id]?.trim()
      return value === undefined || value === ''
        ? { id: question.id, selected: [...(selected[question.id] ?? [])] }
        : { id: question.id, selected: [...(selected[question.id] ?? [])], custom: value }
    })
    void wait.respond({
      ok: true,
      value: { sessionId: wait.sessionId, answer: { answers } },
    }).then(receipt => {
      if (!receipt.accepted) throw new Error(`Host 拒绝了这次应答：${receipt.reason}`)
    }).catch((cause: unknown) => {
      setState('failed')
      setError(cause instanceof Error ? cause.message : '提交失败')
    })
  }

  const submitting = state === 'submitting'
  return (
    <section className="interaction-panel" data-testid={`interaction-${wait.key}`} data-state={state}>
      <div className="interaction-heading">
        <span className="interaction-leading"><CircleHelp aria-hidden="true" size={20} /></span>
        <div><span>需要回答</span><h2>{questions[0]?.header ?? 'Agent 提问'}</h2></div>
      </div>
      {questions.map(question => {
        const values = selected[question.id] ?? []
        const multiSelect = question.multiSelect === true
        return (
          <fieldset className="question-options" disabled={!connected || submitting} key={question.id}>
            <legend>{question.question}</legend>
            {question.detail !== undefined && <p>{question.detail}</p>}
            {(question.options ?? []).map(option => (
              <label key={option.label} data-selected={values.includes(option.label)}>
                <input
                  type={multiSelect ? 'checkbox' : 'radio'}
                  name={`${wait.key}-${question.id}`}
                  value={option.label}
                  checked={values.includes(option.label)}
                  onChange={() => { choose(question.id, option.label, multiSelect) }}
                />
                <span>{option.label}{option.description !== undefined && <small>{option.description}</small>}</span>
                {values.includes(option.label) && <Check aria-hidden="true" size={17} />}
              </label>
            ))}
            <div className="question-custom">
              <input
                type="text"
                aria-label={`${question.question}的其他回答`}
                placeholder="其他回答（可选）"
                value={custom[question.id] ?? ''}
                onChange={event => { setCustom(current => ({ ...current, [question.id]: event.target.value })) }}
              />
            </div>
          </fieldset>
        )
      })}
      {error !== undefined && <p className="inline-error"><CircleAlert aria-hidden="true" size={16} />{error}</p>}
      <div className="interaction-actions">
        <button className="button primary" type="button" disabled={!connected || submitting} onClick={submit}>
          {submitting
            ? <><LoaderCircle className="spin" aria-hidden="true" size={18} />等待 Host 确认</>
            : <><MessageSquare aria-hidden="true" size={18} />提交回答</>}
        </button>
      </div>
    </section>
  )
}

function PendingPanel({ wait, connected }: { wait: PendingInteraction; connected: boolean }) {
  switch (wait.kind) {
    case 'approval': return <ApprovalPanel wait={wait} connected={connected} />
    case 'question': return <QuestionPanel wait={wait} connected={connected} />
    default: return wait satisfies never
  }
}

function SessionConversation({ session, connected, allowInteractions }: {
  session: SessionFace
  connected: boolean
  allowInteractions: boolean
}) {
  const snapshot = useSyncExternalStore(
    listener => session.subscribe(listener),
    () => session.getSnapshot(),
  )
  if (snapshot.openState === 'error') {
    return <div className="empty-state"><CircleAlert aria-hidden="true" size={28} /><strong>Session 加载失败</strong></div>
  }
  if (snapshot.openState !== 'open') {
    return <div className="empty-state"><LoaderCircle className="spin" aria-hidden="true" size={28} /><strong>正在读取 Session</strong></div>
  }
  return (
    <>
      <ConversationHistory session={session} snapshot={snapshot} />
      {allowInteractions
        ? snapshot.pending.map(wait => <PendingPanel key={wait.key} wait={wait} connected={connected} />)
        : snapshot.pending.length > 0 && (
          <div className="readonly-notice"><ShieldCheck aria-hidden="true" size={18} /><span>此设备仅可查看，待处理事项请在电脑端完成</span></div>
        )}
    </>
  )
}

function SessionDetail({ sessions, connection, trust, rawId, navigate }: {
  sessions: ISessions
  connection: ConnectionHandle
  trust: CompanionDeviceTrustService
  rawId: string
  navigate(path: string): void
}) {
  const list = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  const decoded = decodeURIComponent(rawId)
  const id = list.ids.find(candidate => candidate === decoded)
  const host = useHost(connection)

  useEffect(() => {
    if (id !== undefined) sessions.open(id)
  }, [id, sessions])

  if (id === undefined) {
    return <div className="empty-state"><CircleAlert aria-hidden="true" size={28} /><strong>找不到这个 Session</strong></div>
  }
  const summary = list.byId[id]
  const binding = sessions.binding(id)
  if (summary === undefined || binding === undefined) {
    return <div className="empty-state"><LoaderCircle className="spin" aria-hidden="true" size={28} /><strong>正在读取 Session</strong></div>
  }
  const status = renderStatus(summary)
  const meta = statusMeta(status)
  const StatusIcon = meta.icon

  return (
    <div className="page page-session-detail">
      <button className="back-button" type="button" onClick={() => { navigate('/sessions') }}>
        <ArrowLeft aria-hidden="true" size={18} />返回 Session
      </button>
      <header className="session-header">
        <div className="session-heading-copy">
          <span className="session-context">{workspaceLabel(summary.cwd)} · {summary.agentPreset ?? '默认 Agent'}</span>
          <h1>{summary.displayTitle}</h1>
          <p>{summaryLabel(summary)}</p>
        </div>
        <span className="session-status" data-status={status}><StatusIcon aria-hidden="true" size={16} />{meta.label}</span>
      </header>
      <div className="session-facts" aria-label="Session 上下文">
        <span><small>模型</small>{host?.model ?? 'Host 默认'}</span>
        <span><small>工作区</small>{workspaceLabel(summary.cwd)}</span>
        <span><small>连接</small>{host === undefined ? '只读' : '已同步'}</span>
      </div>
      <SessionConversation session={binding.session} connected={host !== undefined} allowInteractions={trust.canAnswerInteractions()} />
    </div>
  )
}

function SessionsRoute({ sessions, connection, trust, path, navigate }: {
  sessions: ISessions
  connection: ConnectionHandle
  trust: CompanionDeviceTrustService
} & RouteProps) {
  const detail = useMemo(() => /^\/sessions\/([^/]+)$/.exec(path)?.[1], [path])
  return detail === undefined
    ? <SessionsList sessions={sessions} navigate={navigate} />
    : <SessionDetail sessions={sessions} connection={connection} trust={trust} rawId={detail} navigate={navigate} />
}

export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.companionUi.registerRoute({
    id: 'sessions',
    path: '/sessions',
    label: 'Session',
    order: 20,
    icon: MessageSquare,
    match: path => path === '/sessions' || path.startsWith('/sessions/'),
    component: props => <SessionsRoute sessions={ctx.sessions} connection={connection} trust={ctx.companionDeviceTrust} {...props} />,
  })
}
