import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Clock3,
  Folder,
  LoaderCircle,
  Menu,
  MessageSquare,
  Plus,
  Play,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, HostDescription, RpcError } from '@deepseek-ai/dsh-client-connection/client'
import { OperationId } from '@deepseek-ai/dsh-client-connection/client'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import type {
  ISessions,
  IWorkspaces,
  ConversationSnapshot,
  PendingInteraction,
  SessionFace,
  SessionSummary,
  WorkspaceId,
} from '@deepseek-ai/dsh-client-runtime/client'
import { SessionCreateError, workspaceTitleOf } from '@deepseek-ai/dsh-client-runtime/client'
import type { RouteProps } from '@dsh-companion/ui-shell'
import type { CompanionDeviceTrust } from '@dsh-companion/device-trust-web'
import { ConversationHistory } from './conversation.tsx'
import {
  AgentPresetPicker,
  CommandMenuButton,
  ModelMenu,
  PermissionMenu,
  type CommandActions,
  type ComposerMenu,
} from './controls.tsx'

export const name = 'companion-ui-session'
export const inject = [
  'companionUi',
  'companionDeviceTrust',
  'connection',
  'sessions',
  'workspaces',
  'remote',
  'remote.commands',
]

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

function sessionCreateError(cause: unknown): string {
  if (cause instanceof SessionCreateError) {
    switch (cause.rpcError.code) {
      case 'forbidden': return '此设备没有新建 Session 的权限'
      case 'workspace-not-found': return '这个 Workspace 已不存在，请等待列表刷新'
      case 'workspace-attach-failed': return 'Session 已创建，但未能加入这个 Workspace'
      default: return cause.rpcError.message
    }
  }
  return cause instanceof Error ? cause.message : '无法创建 Session，请重试'
}

function WorkspacePicker({ sessions, workspaces, connection, connected, navigate, onClose }: {
  sessions: ISessions
  workspaces: IWorkspaces
  connection: ConnectionHandle
  connected: boolean
  navigate(path: string): void
  onClose(): void
}) {
  const snapshot = useSyncExternalStore(workspaces.list.subscribe, workspaces.list.getSnapshot)
  const mounted = useRef(true)
  const [creating, setCreating] = useState<WorkspaceId>()
  const [error, setError] = useState<string>()
  const [agentPreset, setAgentPreset] = useState<string>()
  const [presetLoading, setPresetLoading] = useState(true)
  const choosePreset = useCallback((id: string | undefined) => { setAgentPreset(id) }, [])
  const setPresetBusy = useCallback((loading: boolean) => { setPresetLoading(loading) }, [])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const connect = async (workspaceId: WorkspaceId): Promise<void> => {
    setCreating(workspaceId)
    setError(undefined)
    try {
      const sessionId = await workspaces.connectWorkspace(workspaceId)
      const summary = sessions.list.getSnapshot().byId[sessionId]
      if (agentPreset !== undefined && summary?.agentPreset !== agentPreset) {
        const response = await connection.api.agentPresets.select({ sessionId, agentPreset })
        if (!response.result.ok) throw new Error(response.result.error.message)
        sessions.noteAgentPreset(sessionId, response.result.value.agentPreset)
      }
      if (!mounted.current) return
      sessions.open(sessionId)
      navigate(`/sessions/${encodeURIComponent(sessionId)}`)
    } catch (cause) {
      if (!mounted.current) return
      setError(sessionCreateError(cause))
      setCreating(undefined)
    }
  }

  return (
    <section className="workspace-picker" aria-labelledby="workspace-picker-title">
      <div className="workspace-picker-heading">
        <div><span>新建对话</span><h2 id="workspace-picker-title">选择工作区</h2></div>
        <button className="icon-button" title="关闭" aria-label="关闭工作区选择" type="button" disabled={creating !== undefined} onClick={onClose}><X aria-hidden="true" size={18} /></button>
      </div>
      <AgentPresetPicker
        connection={connection}
        disabled={!connected || creating !== undefined}
        onSelectionChange={choosePreset}
        onLoadingChange={setPresetBusy}
      />
      {snapshot.phase !== 'ready' ? (
        <div className="workspace-picker-state"><LoaderCircle className="spin" aria-hidden="true" size={19} />正在读取电脑上的 Workspace</div>
      ) : snapshot.items.length === 0 ? (
        <div className="workspace-picker-state"><Folder aria-hidden="true" size={19} />请先在电脑 Harness 中注册 Workspace</div>
      ) : (
        <div className="workspace-options">
          {snapshot.items.map(workspace => (
            <button
              className="workspace-option"
              type="button"
              key={workspace.workspaceId}
              disabled={!connected || presetLoading || creating !== undefined}
              onClick={() => { void connect(workspace.workspaceId) }}
            >
              <span className="workspace-option-icon"><Folder aria-hidden="true" size={18} /></span>
              <span><strong>{workspace.title}</strong><small>{workspace.path}</small></span>
              {creating === workspace.workspaceId
                ? <LoaderCircle className="spin" aria-label="正在创建 Session" size={18} />
                : <ChevronRight aria-hidden="true" size={18} />}
            </button>
          ))}
        </div>
      )}
      {!connected && <p className="inline-error" role="alert"><CircleAlert aria-hidden="true" size={16} />正在重新连接 Harness</p>}
      {error !== undefined && <p className="inline-error" role="alert"><CircleAlert aria-hidden="true" size={16} />{error}</p>}
    </section>
  )
}

function SessionsList({ sessions, workspaces, connection, trust, createRequested, navigate }: {
  sessions: ISessions
  workspaces: IWorkspaces
  connection: ConnectionHandle
  trust: CompanionDeviceTrust
  createRequested: boolean
  navigate(path: string): void
}) {
  const snapshot = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  const workspaceSnapshot = useSyncExternalStore(workspaces.list.subscribe, workspaces.list.getSnapshot)
  const host = useHost(connection)
  useSyncExternalStore(trust.subscribe, trust.getSnapshot)
  const [pickerOpen, setPickerOpen] = useState(createRequested)
  const canCreate = trust.canPrompt()

  useEffect(() => { setPickerOpen(createRequested) }, [createRequested])

  const closePicker = (): void => {
    setPickerOpen(false)
    if (createRequested) navigate('/sessions')
  }

  return (
    <div className="page page-sessions">
      {!createRequested && (
        <header className="page-header">
          <div><p className="eyebrow">工作室电脑</p><h1>Session</h1></div>
          <div className="session-header-actions">
            <div className="header-count subtle"><strong>{snapshot.ids.length}</strong><span>最近任务</span></div>
            {canCreate && (
              <button className="icon-button" title="新建 Session" aria-label="新建 Session" type="button" disabled={host === undefined} onClick={() => { setPickerOpen(current => !current) }}>
                <Plus aria-hidden="true" size={20} />
              </button>
            )}
          </div>
        </header>
      )}
      {pickerOpen && canCreate && (
        <WorkspacePicker
          sessions={sessions}
          workspaces={workspaces}
          connection={connection}
          connected={host !== undefined}
          navigate={navigate}
          onClose={closePicker}
        />
      )}
      {!createRequested && <section className="session-list" aria-label="Session 列表">
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
          <div className="empty-state">
            <MessageSquare aria-hidden="true" size={28} />
            <strong>还没有 Session</strong>
            <span>{canCreate
              ? workspaceSnapshot.phase !== 'ready'
                ? '正在读取电脑上的 Workspace'
                : workspaceSnapshot.items.length === 0
                  ? '请先在电脑 Harness 中注册 Workspace'
                  : '选择电脑上的 Workspace 开始对话'
              : '此设备只有查看权限'}</span>
            {canCreate && workspaceSnapshot.phase === 'ready' && workspaceSnapshot.items.length > 0 && (
              <button className="button primary" type="button" disabled={host === undefined} onClick={() => { setPickerOpen(true) }}>
                <Plus aria-hidden="true" size={18} />开始对话
              </button>
            )}
          </div>
        )}
      </section>}
    </div>
  )
}

function useHost(connection: ConnectionHandle): HostDescription | undefined {
  return useSyncExternalStore<HostDescription | undefined>(
    connection.hostDescription.subscribe,
    connection.hostDescription.getSnapshot,
  )
}

function responseError(reason: string): Error {
  if (reason === 'forbidden') return new Error('此设备没有回答权限，或权限刚刚被撤销')
  if (reason === 'conflict') return new Error('其他设备正在处理这项待办，请等待同步结果')
  if (reason === 'not-pending') return new Error('这项待处理事项已在其他设备完成')
  return new Error(`Host 拒绝了这次应答：${reason}`)
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
      if (!receipt.accepted) throw responseError(receipt.reason)
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
      if (!receipt.accepted) throw responseError(receipt.reason)
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

function promptErrorMessage(error: RpcError): string {
  switch (error.code) {
    case 'forbidden': return '此设备没有发送权限，或权限刚刚被撤销'
    case 'operation-conflict': return '这次重试与已提交的消息不一致，请重新编辑后发送'
    case 'session-not-found': return '这个 Session 已不存在'
    case 'agent-busy': return 'Harness 暂时无法接收这条消息'
    case 'cancelled': return '发送已取消，可以直接重试'
    default: return error.message
  }
}

function PromptComposer({ session, snapshot, connection, commands, connected, allowPrompt }: {
  session: SessionFace
  snapshot: ConversationSnapshot
  connection: ConnectionHandle
  commands: CommandActions
  connected: boolean
  allowPrompt: boolean
}) {
  const [draft, setDraft] = useState('')
  const [operation, setOperation] = useState<ReturnType<typeof OperationId>>()
  const [submitting, setSubmitting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string>()
  const [stopError, setStopError] = useState<string>()
  const [controlNotice, setControlNotice] = useState<{ text: string; error: boolean }>()
  const [commandHint, setCommandHint] = useState<string>()
  const [activeMenu, setActiveMenu] = useState<ComposerMenu>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const queued = snapshot.queue.filter(item => item.placement === 'queued')
  const ordinary = snapshot.subagent === null
  const available = allowPrompt && ordinary && !snapshot.removed
  const text = draft.trim()

  useEffect(() => {
    if (activeMenu === null) return
    const dismiss = (event: PointerEvent): void => {
      if (event.target instanceof Node && !controlsRef.current?.contains(event.target)) setActiveMenu(null)
    }
    const dismissWithKeyboard = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setActiveMenu(null)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismissWithKeyboard)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismissWithKeyboard)
    }
  }, [activeMenu])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!connected || !available || submitting || text === '') return
    const operationId = operation ?? OperationId(globalThis.crypto.randomUUID())
    setOperation(operationId)
    setSubmitting(true)
    setError(undefined)
    void session.prompt([{ type: 'text', text }], 'queue', operationId).then(result => {
      if (!result.ok) throw new Error(promptErrorMessage(result.error))
      setDraft('')
      setCommandHint(undefined)
      setOperation(undefined)
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : '发送失败，可以直接重试')
    }).finally(() => { setSubmitting(false) })
  }

  const insertCommand = (line: string, hint?: string): void => {
    setDraft(line)
    setCommandHint(hint)
    setOperation(undefined)
    setError(undefined)
  }

  const reportControl = (message: string | undefined, controlError = false): void => {
    setControlNotice(message === undefined ? undefined : { text: message, error: controlError })
  }

  const stop = (): void => {
    if (!connected || stopping || !snapshot.running) return
    setStopping(true)
    setStopError(undefined)
    void session.cancel().then(result => {
      if (!result.ok) throw new Error(promptErrorMessage(result.error))
    }).catch((cause: unknown) => {
      setStopError(cause instanceof Error ? cause.message : '停止失败，可以重试')
    }).finally(() => { setStopping(false) })
  }

  return (
    <section className="prompt-composer" data-testid="prompt-composer">
      {queued.length > 0 && (
        <ol className="prompt-queue" aria-label="等待执行的消息">
          {queued.map(item => <li key={item.id}>{item.preview || '无文字预览'}</li>)}
        </ol>
      )}
      {!allowPrompt ? (
        <div className="prompt-unavailable"><ShieldCheck aria-hidden="true" size={18} /><span>此设备只有查看权限，请在电脑端授予“完整控制”</span></div>
      ) : !ordinary ? (
        <div className="prompt-unavailable"><ShieldCheck aria-hidden="true" size={18} /><span>子 Agent Session 暂不支持从 Companion 继续</span></div>
      ) : snapshot.removed ? (
        <div className="prompt-unavailable"><CircleAlert aria-hidden="true" size={18} /><span>这个 Session 已移除，不能继续发送</span></div>
      ) : (
        <form className="prompt-form" onSubmit={submit}>
          <div className="prompt-card" data-testid="prompt-card">
            <textarea
              aria-label="排队消息"
              placeholder={commandHint ?? '给智能体发消息'}
              rows={2}
              value={draft}
              disabled={!connected || submitting}
              onChange={event => {
                setDraft(event.target.value)
                if (!event.target.value.startsWith('/')) setCommandHint(undefined)
                setOperation(undefined)
                setError(undefined)
              }}
            />
            <div className="prompt-toolbar" ref={controlsRef}>
              <div className="prompt-context-meta">
                <CommandMenuButton
                  sessionId={session.sessionId}
                  actions={commands}
                  activeMenu={activeMenu}
                  setActiveMenu={setActiveMenu}
                  insertCommand={insertCommand}
                  report={reportControl}
                />
                <PermissionMenu
                  session={session}
                  actions={commands}
                  connected={connected}
                  activeMenu={activeMenu}
                  setActiveMenu={setActiveMenu}
                  report={reportControl}
                />
                <span data-connected={connected}>{connected ? '已连接' : '重新连接中'}</span>
                {queued.length > 0 && <span><Clock3 aria-hidden="true" size={14} />{queued.length} 条排队</span>}
              </div>
              <div className="prompt-command-buttons">
                <ModelMenu
                  session={session}
                  connection={connection}
                  connected={connected}
                  activeMenu={activeMenu}
                  setActiveMenu={setActiveMenu}
                  report={reportControl}
                />
                {snapshot.running && (
                  <button className="button secondary prompt-stop" title="停止生成" aria-label="停止生成" type="button" disabled={!connected || stopping} onClick={stop}>
                    {stopping
                      ? <><LoaderCircle className="spin" aria-hidden="true" size={18} /><span>正在停止</span></>
                      : <><Square aria-hidden="true" size={15} /><span>停止生成</span></>}
                  </button>
                )}
                <button className="button primary prompt-send" aria-label="排队发送" title="发送消息" type="submit" disabled={!connected || submitting || text === ''}>
                  {submitting
                    ? <><LoaderCircle className="spin" aria-hidden="true" size={18} /><span>等待确认</span></>
                    : <><ArrowUp aria-hidden="true" size={19} /><span>排队发送</span></>}
                </button>
              </div>
            </div>
          </div>
          {error !== undefined && <p className="inline-error" role="alert"><CircleAlert aria-hidden="true" size={16} />{error}</p>}
          {stopError !== undefined && <p className="inline-error" role="alert"><CircleAlert aria-hidden="true" size={16} />{stopError}</p>}
          {controlNotice !== undefined && <p className={controlNotice.error ? 'inline-error' : 'inline-notice'} role={controlNotice.error ? 'alert' : 'status'}>{controlNotice.text}</p>}
        </form>
      )}
    </section>
  )
}

function SessionConversation({ session, connection, commands, connected, allowInteractions, allowPrompt }: {
  session: SessionFace
  connection: ConnectionHandle
  commands: CommandActions
  connected: boolean
  allowInteractions: boolean
  allowPrompt: boolean
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
    <div className="session-conversation">
      <ConversationHistory session={session} snapshot={snapshot} />
      {snapshot.pending.length > 0 && (
        <div className="session-pending" data-testid="session-pending">
          {allowInteractions
            ? snapshot.pending.map(wait => <PendingPanel key={wait.key} wait={wait} connected={connected} />)
            : <div className="readonly-notice"><ShieldCheck aria-hidden="true" size={18} /><span>此设备仅可查看，待处理事项请在电脑端完成</span></div>}
        </div>
      )}
      <PromptComposer session={session} snapshot={snapshot} connection={connection} commands={commands} connected={connected} allowPrompt={allowPrompt} />
    </div>
  )
}

function SessionDetail({ sessions, connection, commands, trust, rawId, openNavigation }: {
  sessions: ISessions
  connection: ConnectionHandle
  commands: CommandActions
  trust: CompanionDeviceTrust
  rawId: string
  openNavigation(): void
}) {
  const list = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  const decoded = decodeURIComponent(rawId)
  const id = list.ids.find(candidate => candidate === decoded)
  const host = useHost(connection)
  useSyncExternalStore(trust.subscribe, trust.getSnapshot)

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
      <header className="session-chat-header" data-testid="session-chat-header">
        <button className="session-menu-button" title="打开侧边栏" aria-label="打开侧边栏" type="button" aria-controls="mobile-session-drawer" onClick={openNavigation}>
          <Menu aria-hidden="true" size={20} />
        </button>
        <div className="session-heading-copy">
          <h1>{summary.displayTitle}</h1>
        </div>
        <span className="session-status" data-status={status}><StatusIcon aria-hidden="true" size={16} />{meta.label}</span>
      </header>
      <p className="session-summary">{summaryLabel(summary)}</p>
      <div className="session-facts" aria-label="Session 上下文">
        <span><small>工作区</small>{workspaceLabel(summary.cwd)}</span>
        <span><small>连接</small>{host === undefined ? '只读' : '已同步'}</span>
      </div>
      <SessionConversation
        key={id}
        session={binding.session}
        connection={connection}
        commands={commands}
        connected={host !== undefined}
        allowInteractions={trust.canAnswerInteractions()}
        allowPrompt={trust.canPrompt()}
      />
    </div>
  )
}

function SessionsRoute({ sessions, workspaces, connection, commands, trust, path, navigate, openNavigation }: {
  sessions: ISessions
  workspaces: IWorkspaces
  connection: ConnectionHandle
  commands: CommandActions
  trust: CompanionDeviceTrust
} & RouteProps) {
  const snapshot = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  const detail = useMemo(() => /^\/sessions\/([^/]+)$/.exec(path)?.[1], [path])
  const createRequested = detail === 'new'

  useEffect(() => {
    if (path !== '/sessions' || snapshot.phase !== 'ready' || snapshot.ids.length === 0) return
    const target = snapshot.current !== undefined && snapshot.ids.includes(snapshot.current)
      ? snapshot.current
      : snapshot.ids[0]
    if (target !== undefined) navigate(`/sessions/${encodeURIComponent(target)}`)
  }, [navigate, path, snapshot.current, snapshot.ids, snapshot.phase])

  if (path === '/sessions' && snapshot.phase !== 'ready') {
    return <div className="empty-state"><LoaderCircle className="spin" aria-hidden="true" size={28} /><strong>正在读取 Session</strong></div>
  }
  if (path === '/sessions' && snapshot.ids.length > 0) {
    return <div className="empty-state"><LoaderCircle className="spin" aria-hidden="true" size={28} /><strong>正在打开 Session</strong></div>
  }
  if (detail === undefined || createRequested) {
    return <SessionsList sessions={sessions} workspaces={workspaces} connection={connection} trust={trust} createRequested={createRequested} navigate={navigate} />
  }
  return <SessionDetail sessions={sessions} connection={connection} commands={commands} trust={trust} rawId={detail} openNavigation={openNavigation} />
}

export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const commands: CommandActions = {
    async list(sessionId) {
      const result = await ctx.remote.commands.list(sessionId)
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return result.value
    },
    async execute(sessionId, line) {
      const result = await ctx.remote.commands.execute(sessionId, line)
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      if (result.value === undefined) throw new Error(`Host 无法识别命令：${line}`)
      if (result.value.result.kind === 'error') throw new Error(result.value.result.text)
      return result.value.result.text
    },
  }
  ctx.companionUi.registerRoute({
    id: 'sessions',
    path: '/sessions',
    label: 'Session',
    order: 10,
    icon: MessageSquare,
    match: path => path === '/sessions' || path.startsWith('/sessions/'),
    component: props => <SessionsRoute sessions={ctx.sessions} workspaces={ctx.workspaces} connection={connection} commands={commands} trust={ctx.companionDeviceTrust} {...props} />,
  })
}
