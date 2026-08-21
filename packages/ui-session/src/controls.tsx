import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Command,
  FilePenLine,
  LoaderCircle,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import type {
  ConnectionHandle,
  ModelSelection,
  SessionId,
} from '@deepseek-ai/dsh-client-connection/client'
import type { SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/src/client/directory.ts'
import type { AgentPresetOption } from '@deepseek-ai/dsh-client-ui-agent-preset/src/client/settings-store.ts'
import {
  displayPermissionPreset,
  FULL_ACCESS_PRESET,
} from '@deepseek-ai/dsh-client-ui-permission-presets/src/client/presentation.ts'
import type { CommandDescriptor } from '@deepseek-ai/dsh-commands/types'
import type { PermissionSelect } from '@deepseek-ai/dsh-permission-presets/client'

interface BuiltInPresetCopy {
  name: string
  description: string
}

const BUILT_IN_PRESETS: Readonly<Record<string, BuiltInPresetCopy>> = {
  standard: {
    name: '标准模式',
    description: '功能完整的编码 Agent，支持文件编辑、Shell、检索、Skills、计划、目标、子代理和工作流。',
  },
  code: {
    name: 'PTC 模式',
    description: '具备标准模式的全部能力，并通过 Code Mode SDK 让模型组合多步操作。',
  },
  minimal: {
    name: '极简模式',
    description: '仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。',
  },
  cordis: {
    name: '创造模式',
    description: '用于创建自定义 Agent preset，并提供运行时检查、插件实验和创作指导。',
  },
}

function presetCopy(option: AgentPresetOption): BuiltInPresetCopy {
  const builtIn = option.trust === 'system' ? BUILT_IN_PRESETS[option.id] : undefined
  return builtIn ?? {
    name: option.name ?? option.id,
    description: option.description ?? (option.trust === 'user' ? '电脑上的自定义 Agent 预设。' : 'Host 提供的 Agent 预设。'),
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

const AGENT_PRESET_READ_TIMEOUT_MS = 8_000

async function readWithTimeout<T>(read: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error('读取 Agent 模式超时')) }, AGENT_PRESET_READ_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function readAgentPresets(connection: ConnectionHandle) {
  try {
    return await readWithTimeout(() => connection.api.agentPresets.list({}))
  } catch {
    return await readWithTimeout(() => connection.api.agentPresets.list({}))
  }
}

export function AgentPresetPicker({ connection, disabled, onSelectionChange, onLoadingChange }: {
  connection: ConnectionHandle
  disabled: boolean
  onSelectionChange(id: string | undefined): void
  onLoadingChange(loading: boolean): void
}) {
  const mounted = useRef(true)
  const [options, setOptions] = useState<readonly AgentPresetOption[]>([])
  const [current, setCurrent] = useState<string>()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [reload, setReload] = useState(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    onLoadingChange(true)
    setError(undefined)
    void readAgentPresets(connection).then((response) => {
      if (!active || !mounted.current) return
      if (!response.result.ok) throw new Error(response.result.error.message)
      const available = response.result.value.presets
        .filter(preset => preset.broken === undefined)
        .map(preset => ({
          id: preset.id,
          trust: preset.trust,
          ...(preset.name === undefined ? {} : { name: preset.name }),
          ...(preset.description === undefined ? {} : { description: preset.description }),
        }))
      const selected = response.result.value.presets.find(preset => preset.isDefault && preset.broken === undefined)?.id
        ?? available[0]?.id
      setOptions(available)
      setCurrent(selected)
      onSelectionChange(selected)
    }).catch((cause: unknown) => {
      if (!active || !mounted.current) return
      setError(messageOf(cause, '无法读取 Agent 模式'))
      onSelectionChange(undefined)
    }).finally(() => {
      if (!active || !mounted.current) return
      setLoading(false)
      onLoadingChange(false)
    })
    return () => { active = false }
  }, [connection, onLoadingChange, onSelectionChange, reload])

  if (!loading && options.length === 0 && error === undefined) return null
  const selected = options.find(option => option.id === current)
  const copy = selected === undefined ? undefined : presetCopy(selected)

  return (
    <div className="agent-preset-picker">
      <button
        className="agent-preset-trigger"
        type="button"
        aria-label={`Agent 模式，当前 ${copy?.name ?? '正在加载'}`}
        aria-expanded={open}
        disabled={disabled || loading || options.length === 0}
        onClick={() => { setOpen(value => !value) }}
      >
        {loading ? <LoaderCircle className="spin" aria-hidden="true" size={17} /> : <Brain aria-hidden="true" size={17} />}
        <span>{copy?.name ?? '正在读取模式'}</span>
        <ChevronDown aria-hidden="true" size={16} />
      </button>
      {open && (
        <div className="agent-preset-menu" role="menu" aria-label="选择 Agent 模式">
          {options.map((option) => {
            const text = presetCopy(option)
            return (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={option.id === current}
                key={option.id}
                onClick={() => {
                  setCurrent(option.id)
                  onSelectionChange(option.id)
                  setOpen(false)
                }}
              >
                <span><strong>{text.name}</strong><small>{text.description}</small></span>
                {option.id === current && <Check aria-hidden="true" size={18} />}
              </button>
            )
          })}
        </div>
      )}
      {error !== undefined && (
        <p className="inline-error agent-preset-error" role="alert">
          <CircleAlert aria-hidden="true" size={15} />
          <span>{error}</span>
          <button className="button secondary" type="button" disabled={loading} onClick={() => { setReload(value => value + 1) }}>
            <RotateCcw aria-hidden="true" size={15} />重试
          </button>
        </p>
      )}
    </div>
  )
}

export interface CommandActions {
  list(sessionId: SessionId): Promise<readonly CommandDescriptor[]>
  execute(sessionId: SessionId, line: string): Promise<string | undefined>
}

type ComposerMenu = 'commands' | 'permission' | 'model' | null

export function CommandMenuButton({ sessionId, actions, activeMenu, setActiveMenu, insertCommand, report }: {
  sessionId: SessionId
  actions: CommandActions
  activeMenu: ComposerMenu
  setActiveMenu(menu: ComposerMenu): void
  insertCommand(line: string, hint?: string): void
  report(message: string | undefined, error?: boolean): void
}) {
  const open = activeMenu === 'commands'
  const [commands, setCommands] = useState<readonly CommandDescriptor[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [running, setRunning] = useState<string>()

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError(undefined)
    void actions.list(sessionId).then((rows) => {
      if (active) setCommands(rows)
    }).catch((cause: unknown) => {
      if (active) setError(messageOf(cause, '无法读取命令'))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [actions, open, sessionId])

  const choose = (command: CommandDescriptor): void => {
    if (command.name === 'permission') {
      setActiveMenu('permission')
      return
    }
    if (command.input !== undefined) {
      insertCommand(`/${command.name} `, command.input.hint)
      setActiveMenu(null)
      return
    }
    setRunning(command.name)
    setError(undefined)
    void actions.execute(sessionId, `/${command.name}`).then((text) => {
      report(text ?? `/${command.name} 已提交`)
      setActiveMenu(null)
    }).catch((cause: unknown) => {
      const detail = messageOf(cause, `/${command.name} 执行失败`)
      setError(detail)
      report(detail, true)
    }).finally(() => { setRunning(undefined) })
  }

  const rows = commands.some(command => command.name === 'model')
    ? commands
    : [...commands, { name: 'model', description: '选择本会话使用的模型' }]

  return (
    <div className="composer-control composer-command-control">
      <button
        className="composer-icon-button"
        type="button"
        title="命令"
        aria-label="打开命令"
        aria-expanded={open}
        onClick={() => { setActiveMenu(open ? null : 'commands') }}
      >
        <Plus aria-hidden="true" size={19} />
      </button>
      {open && (
        <div className="composer-menu command-menu" role="menu" aria-label="命令">
          <div className="composer-menu-title"><Command aria-hidden="true" size={15} />命令</div>
          {loading && <div className="composer-menu-state"><LoaderCircle className="spin" aria-hidden="true" size={17} />正在读取命令</div>}
          {error !== undefined && <div className="composer-menu-error" role="alert">{error}</div>}
          {!loading && error === undefined && rows.map(command => (
            <button
              type="button"
              role="menuitem"
              key={command.name}
              disabled={running !== undefined}
              onClick={() => {
                if (command.name === 'model') setActiveMenu('model')
                else choose(command)
              }}
            >
              <span><strong>{command.name}</strong><small>{command.description}</small></span>
              {running === command.name
                ? <LoaderCircle className="spin" aria-hidden="true" size={17} />
                : command.input !== undefined || command.name === 'model' || command.name === 'permission'
                  ? <ChevronRight aria-hidden="true" size={17} />
                  : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function permissionIcon(value: string) {
  if (value === FULL_ACCESS_PRESET) return ShieldAlert
  if (value === 'workspace-write') return FilePenLine
  return ShieldCheck
}

export function PermissionMenu({ session, actions, connected, activeMenu, setActiveMenu, report }: {
  session: SessionFace
  actions: CommandActions
  connected: boolean
  activeMenu: ComposerMenu
  setActiveMenu(menu: ComposerMenu): void
  report(message: string | undefined, error?: boolean): void
}) {
  const face = useMemo(() => session.projections.faceOf('permissions'), [session])
  const selection = useSyncExternalStore(
    face.subscribe,
    () => face.getSnapshot() as PermissionSelect | undefined,
  )
  const open = activeMenu === 'permission'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [confirming, setConfirming] = useState<string>()
  const [acknowledged, setAcknowledged] = useState(false)
  const current = selection?.options.find(option => option.value === selection.currentValue)
  const label = current === undefined
    ? '权限'
    : displayPermissionPreset(current.value, current.name)
  const CurrentIcon = permissionIcon(selection?.currentValue ?? '')

  const choose = (value: string): void => {
    if (!connected || busy || selection === undefined) return
    if (value === selection.currentValue) {
      setActiveMenu(null)
      return
    }
    if (value === FULL_ACCESS_PRESET && confirming !== value) {
      setConfirming(value)
      setAcknowledged(false)
      return
    }
    setBusy(true)
    setError(undefined)
    void actions.execute(session.sessionId, `/permission ${value}`).then(() => {
      report('权限已由 Host 更新')
      setConfirming(undefined)
      setActiveMenu(null)
    }).catch((cause: unknown) => {
      const detail = messageOf(cause, '权限切换失败')
      setError(detail)
      report(detail, true)
    }).finally(() => { setBusy(false) })
  }

  if (selection === undefined) return null

  return (
    <div className="composer-control permission-control">
      <button
        className="composer-text-button"
        type="button"
        aria-label={`权限，当前 ${label}`}
        aria-expanded={open}
        disabled={!connected || busy}
        onClick={() => {
          setConfirming(undefined)
          setError(undefined)
          setActiveMenu(open ? null : 'permission')
        }}
      >
        <CurrentIcon aria-hidden="true" size={16} />
        <span>{label}</span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {open && (
        <div className="composer-menu permission-menu" role="menu" aria-label="权限模式">
          {confirming === FULL_ACCESS_PRESET ? (
            <div className="permission-confirmation">
              <ShieldAlert aria-hidden="true" size={22} />
              <strong>启用 Full access？</strong>
              <p>Agent 将不受 Workspace 沙箱限制，并且工具操作不再逐次询问。</p>
              <label>
                <input type="checkbox" checked={acknowledged} onChange={event => { setAcknowledged(event.target.checked) }} />
                <span>我了解这会授予电脑上的完整访问权限</span>
              </label>
              <div>
                <button type="button" onClick={() => { setConfirming(undefined) }}>取消</button>
                <button type="button" disabled={!acknowledged || busy} onClick={() => { choose(FULL_ACCESS_PRESET) }}>启用</button>
              </div>
            </div>
          ) : (
            selection.options.filter(option => option.value !== 'custom').map((option) => {
              const Icon = permissionIcon(option.value)
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.value === selection.currentValue}
                  key={option.value}
                  disabled={busy}
                  onClick={() => { choose(option.value) }}
                >
                  <Icon aria-hidden="true" size={18} />
                  <span><strong>{displayPermissionPreset(option.value, option.name)}</strong>{option.description !== undefined && <small>{option.description}</small>}</span>
                  {option.value === selection.currentValue && <Check aria-hidden="true" size={18} />}
                </button>
              )
            })
          )}
          {error !== undefined && <div className="composer-menu-error" role="alert">{error}</div>}
        </div>
      )}
    </div>
  )
}

type ModelPane = 'root' | 'model' | 'effort'

export function ModelMenu({ session, connection, connected, activeMenu, setActiveMenu, report }: {
  session: SessionFace
  connection: ConnectionHandle
  connected: boolean
  activeMenu: ComposerMenu
  setActiveMenu(menu: ComposerMenu): void
  report(message: string | undefined, error?: boolean): void
}) {
  const directory = useMemo(() => new ModelDirectory(
    connection.api.sessions,
    session.sessionId,
    () => true,
  ), [connection, session])
  const state = useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot)
  const open = activeMenu === 'model'
  const [pane, setPane] = useState<ModelPane>('root')

  useEffect(() => () => { directory.dispose() }, [directory])
  useEffect(() => {
    if (connected) void directory.load().catch(() => undefined)
  }, [connected, directory])
  useEffect(() => {
    if (!open) return
    setPane('root')
    void directory.load().catch(() => undefined)
  }, [directory, open])

  const choices = state.groups.flatMap(group => group.models.map(model => ({ group, model })))
  const currentChoice = choices.find(choice => choice.group.id === state.current?.provider && choice.model.id === state.current.model)
  const modelLabel = currentChoice?.model.name ?? state.current?.model ?? '选择模型'
  const reasoning = currentChoice?.model.reasoning
  const effort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning?.efforts.find(option => option.id === effort)?.name ?? effort
  const busy = state.status === 'selecting'

  const select = (selection: ModelSelection): void => {
    void directory.select(selection).then(() => {
      report('模型设置已由 Host 更新')
      setActiveMenu(null)
    }).catch((cause: unknown) => {
      report(messageOf(cause, '模型切换失败'), true)
    })
  }

  return (
    <div className="composer-control model-control">
      <button
        className="composer-text-button model-trigger"
        type="button"
        aria-label={`模型，当前 ${modelLabel}${effortLabel === undefined ? '' : `，推理等级 ${effortLabel}`}`}
        aria-expanded={open}
        disabled={!connected || busy}
        onClick={() => { setActiveMenu(open ? null : 'model') }}
      >
        <span>{modelLabel}</span>
        {effortLabel !== undefined && <small>{effortLabel}</small>}
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {open && (
        <div className="composer-menu model-menu" role="menu" aria-label="模型与推理等级">
          {pane !== 'root' && (
            <button className="composer-menu-back" type="button" onClick={() => { setPane('root') }}>
              <ChevronLeft aria-hidden="true" size={17} />返回
            </button>
          )}
          {state.status === 'loading' && <div className="composer-menu-state"><LoaderCircle className="spin" aria-hidden="true" size={17} />正在刷新模型</div>}
          {state.error !== null && <div className="composer-menu-error" role="alert">{state.error}</div>}
          {pane === 'root' && (
            <>
              <button type="button" role="menuitem" onClick={() => { setPane('model') }}>
                <span><strong>模型</strong><small>{modelLabel}</small></span><ChevronRight aria-hidden="true" size={17} />
              </button>
              {reasoning !== undefined && (
                <button type="button" role="menuitem" onClick={() => { setPane('effort') }}>
                  <span><strong>推理等级</strong><small>{effortLabel ?? '默认'}</small></span><ChevronRight aria-hidden="true" size={17} />
                </button>
              )}
            </>
          )}
          {pane === 'model' && state.groups.map(group => (
            <section className="model-group" aria-label={group.name} key={group.id}>
              <span>{group.name}</span>
              {group.models.map(model => {
                const selected = state.current?.provider === group.id && state.current.model === model.id
                return (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    key={model.id}
                    disabled={busy}
                    onClick={() => {
                      select({
                        provider: group.id,
                        model: model.id,
                        ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }),
                      })
                    }}
                  >
                    <span><strong>{model.name}</strong>{model.description !== undefined && <small>{model.description}</small>}</span>
                    {selected && <Check aria-hidden="true" size={18} />}
                  </button>
                )
              })}
            </section>
          ))}
          {pane === 'effort' && reasoning?.efforts.map(option => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={option.id === effort}
              key={option.id}
              disabled={busy || state.current === null}
              onClick={() => {
                if (state.current === null) return
                select({ ...state.current, reasoningEffort: option.id })
              }}
            >
              <span><strong>{option.name}</strong>{option.description !== undefined && <small>{option.description}</small>}</span>
              {option.id === effort && <Check aria-hidden="true" size={18} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export type { ComposerMenu }
