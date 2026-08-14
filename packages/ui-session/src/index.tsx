import { useMemo, useState, useSyncExternalStore } from 'react'
import {
  ArrowLeft,
  Bot,
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
  TerminalSquare,
  UserRound,
  X,
} from 'lucide-react'
import type { Context } from '@deepseek-ai/cordis'
import { sessionId, type ConversationMessage, type Interaction, type SessionRecord } from '@dsh-companion/connection'
import type { CompanionRuntimeService } from '@dsh-companion/runtime'
import type { RouteProps } from '@dsh-companion/ui-shell'

export const name = 'companion-ui-session'
export const inject = ['companionUi', 'companionRuntime']

function statusMeta(status: SessionRecord['status']) {
  switch (status) {
    case 'running': return { label: '运行中', icon: Play }
    case 'waiting': return { label: '等待你', icon: Clock3 }
    case 'completed': return { label: '已完成', icon: CheckCircle2 }
    case 'failed': return { label: '失败', icon: CircleAlert }
    default: return status satisfies never
  }
}

function SessionsList({ runtime, navigate }: { runtime: CompanionRuntimeService; navigate(path: string): void }) {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  return (
    <div className="page page-sessions">
      <header className="page-header">
        <div><p className="eyebrow">工作室电脑</p><h1>Session</h1></div>
        <div className="header-count subtle"><strong>{snapshot.sessions.length}</strong><span>最近任务</span></div>
      </header>
      <section className="session-list" aria-label="Session 列表">
        {snapshot.sessions.map(session => {
          const meta = statusMeta(session.status)
          const Icon = meta.icon
          return (
            <button className="session-row" key={session.id} type="button" onClick={() => { navigate(`/sessions/${session.id}`) }}>
              <span className="session-status-icon" data-status={session.status}><Icon aria-hidden="true" size={18} /></span>
              <span className="session-row-copy">
                <span className="session-row-meta"><span>{session.workspace}</span><span>{meta.label}</span></span>
                <strong>{session.title}</strong>
                <span>{session.summary}</span>
              </span>
              <ChevronRight aria-hidden="true" size={19} />
            </button>
          )
        })}
      </section>
    </div>
  )
}

function messageIcon(message: ConversationMessage) {
  switch (message.role) {
    case 'user': return UserRound
    case 'assistant': return Bot
    case 'tool': return TerminalSquare
    case 'system': return CheckCircle2
    default: return message.role satisfies never
  }
}

function Conversation({ messages }: { messages: readonly ConversationMessage[] }) {
  return (
    <section className="conversation" aria-label="对话记录">
      {messages.map(message => {
        const Icon = messageIcon(message)
        return (
          <article className="message-row" data-role={message.role} key={message.id}>
            <span className="message-avatar"><Icon aria-hidden="true" size={17} /></span>
            <div className="message-body">
              <div className="message-meta">
                <strong>{message.role === 'user' ? '你' : message.role === 'assistant' ? 'Codex' : message.role === 'tool' ? message.toolName : '状态更新'}</strong>
                {message.toolStatus && <span data-tool-status={message.toolStatus}>{message.toolStatus === 'running' ? '执行中' : message.toolStatus === 'completed' ? '已完成' : '失败'}</span>}
              </div>
              <p>{message.content}</p>
            </div>
          </article>
        )
      })}
    </section>
  )
}

function InteractionPanel({ runtime, interaction }: { runtime: CompanionRuntimeService; interaction: Interaction }) {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  const operation = snapshot.operations[interaction.id]
  const [selection, setSelection] = useState(interaction.kind === 'question' ? interaction.options[0] ?? '' : '')
  const [localError, setLocalError] = useState<string>()

  if (interaction.status === 'resolved') {
    return (
      <section className="interaction-panel resolved" data-testid="interaction-state" data-state="resolved">
        <span className="interaction-leading"><Check aria-hidden="true" size={19} /></span>
        <div><strong>已经处理</strong><p>{interaction.resolution}</p></div>
      </section>
    )
  }

  const submitting = operation?.kind === 'submitting'
  const submit = (resolution: string) => {
    setLocalError(undefined)
    void runtime.resolveInteraction(interaction.id, resolution).catch(error => {
      setLocalError(error instanceof Error ? error.message : '提交失败')
    })
  }

  return (
    <section className="interaction-panel" data-testid="interaction-state" data-state={submitting ? 'submitting' : 'pending'}>
      <div className="interaction-heading">
        <span className="interaction-leading">
          {interaction.kind === 'question' ? <CircleHelp aria-hidden="true" size={20} /> : <ShieldCheck aria-hidden="true" size={20} />}
        </span>
        <div><span>{interaction.kind === 'question' ? '需要回答' : '需要审批'}</span><h2>{interaction.title}</h2></div>
      </div>

      {interaction.kind === 'question' ? (
        <fieldset className="question-options" disabled={submitting}>
          <legend>{interaction.prompt}</legend>
          {interaction.options.map(option => (
            <label key={option} data-selected={selection === option}>
              <input type="radio" name={interaction.id} value={option} checked={selection === option} onChange={() => { setSelection(option) }} />
              <span>{option}</span>
              {selection === option && <Check aria-hidden="true" size={17} />}
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="approval-detail">
          <div className="approval-meta"><span>{interaction.toolName}</span><span data-risk={interaction.risk}>中等风险</span></div>
          <code>{interaction.command}</code>
          <p>{interaction.detail}</p>
        </div>
      )}

      {(localError ?? (operation?.kind === 'failed' ? operation.message : undefined)) && (
        <p className="inline-error"><CircleAlert aria-hidden="true" size={16} />{localError ?? (operation?.kind === 'failed' ? operation.message : '')}</p>
      )}

      <div className="interaction-actions">
        {interaction.kind === 'approval' && (
          <button className="button secondary" type="button" disabled={submitting} onClick={() => { submit('拒绝') }}>
            <X aria-hidden="true" size={18} />拒绝
          </button>
        )}
        <button
          className="button primary"
          type="button"
          disabled={submitting || (interaction.kind === 'question' && selection.length === 0)}
          onClick={() => { submit(interaction.kind === 'question' ? selection : '允许一次') }}
        >
          {submitting
            ? <><LoaderCircle className="spin" aria-hidden="true" size={18} />提交中</>
            : interaction.kind === 'question'
              ? <><MessageSquare aria-hidden="true" size={18} />提交回答</>
              : <><Check aria-hidden="true" size={18} />允许一次</>}
        </button>
      </div>
    </section>
  )
}

function SessionDetail({ runtime, rawId, navigate }: { runtime: CompanionRuntimeService; rawId: string; navigate(path: string): void }) {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  const id = sessionId(decodeURIComponent(rawId))
  const session = snapshot.sessions.find(candidate => candidate.id === id)
  const interactions = snapshot.interactions.filter(interaction => interaction.sessionId === id)

  if (session === undefined) {
    return <div className="empty-state"><CircleAlert aria-hidden="true" size={28} /><strong>找不到这个 Session</strong></div>
  }
  const meta = statusMeta(session.status)
  const StatusIcon = meta.icon

  return (
    <div className="page page-session-detail">
      <button className="back-button" type="button" onClick={() => { navigate('/sessions') }}>
        <ArrowLeft aria-hidden="true" size={18} />返回 Session
      </button>
      <header className="session-header">
        <div className="session-heading-copy">
          <span className="session-context">{session.workspace} · {session.agent}</span>
          <h1>{session.title}</h1>
          <p>{session.summary}</p>
        </div>
        <span className="session-status" data-status={session.status}><StatusIcon aria-hidden="true" size={16} />{meta.label}</span>
      </header>
      <div className="session-facts" aria-label="Session 上下文">
        <span><small>模型</small>{session.model}</span>
        <span><small>工作区</small>{session.workspace}</span>
        <span><small>连接</small>{snapshot.phase === 'connected' ? '已同步' : '只读'}</span>
      </div>
      <Conversation messages={session.messages} />
      {interactions.map(interaction => <InteractionPanel key={interaction.id} runtime={runtime} interaction={interaction} />)}
    </div>
  )
}

function SessionsRoute({ runtime, path, navigate }: { runtime: CompanionRuntimeService } & RouteProps) {
  const detail = useMemo(() => /^\/sessions\/([^/]+)$/.exec(path)?.[1], [path])
  return detail === undefined
    ? <SessionsList runtime={runtime} navigate={navigate} />
    : <SessionDetail runtime={runtime} rawId={detail} navigate={navigate} />
}

export function apply(ctx: Context): void {
  ctx.companionUi.registerRoute({
    id: 'sessions',
    path: '/sessions',
    label: 'Session',
    order: 20,
    icon: MessageSquare,
    match: path => path === '/sessions' || path.startsWith('/sessions/'),
    component: props => <SessionsRoute runtime={ctx.companionRuntime} {...props} />,
  })
}
