import type { Context } from '@deepseek-ai/cordis'
import {
  ConnectionError,
  messageId,
  resumeCursor,
  type ConnectionFrame,
  type ConnectionProvider,
  type ConnectionStatus,
  type HostBaseline,
  type Interaction,
  type ResolveInteractionCommand,
  type ResolveInteractionResult,
  type SessionRecord,
} from '@dsh-companion/connection'
import { createFixtureBaseline, FIXTURE_HOST } from './data.ts'

export const name = 'companion-connection-fixture'
export const inject = ['companionConnection']

export interface Config {
  initialConnectDelayMs?: number
  resolveDelayMs?: number
  reconnectDelayMs?: number
  resyncDelayMs?: number
}

interface ResolvedConfig {
  initialConnectDelayMs: number
  resolveDelayMs: number
  reconnectDelayMs: number
  resyncDelayMs: number
}

function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    initialConnectDelayMs: config.initialConnectDelayMs ?? 120,
    resolveDelayMs: config.resolveDelayMs ?? 900,
    reconnectDelayMs: config.reconnectDelayMs ?? 700,
    resyncDelayMs: config.resyncDelayMs ?? 550,
  }
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new ConnectionError(`${key} must be a non-negative integer`, 'INVALID_CONFIG')
    }
  }
  return resolved
}

class FixtureConnectionProvider implements ConnectionProvider {
  private status: ConnectionStatus = { phase: 'booting', detail: '正在装载演示场景' }
  private baseline = createFixtureBaseline()
  private readonly statusListeners = new Set<() => void>()
  private readonly frameListeners = new Set<(frame: ConnectionFrame) => void>()
  private readonly tasks = new Set<Promise<unknown>>()
  private readonly operations = new Map<string, Promise<ResolveInteractionResult>>()
  private readonly interactionOperations = new Map<string, string>()
  private controller = new AbortController()
  private started = false
  private disposed = false
  private cursor = 1

  constructor(private readonly config: ResolvedConfig) {}

  getStatus(): ConnectionStatus {
    return this.status
  }

  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }

  subscribeFrames(listener: (frame: ConnectionFrame) => void): () => void {
    this.frameListeners.add(listener)
    return () => { this.frameListeners.delete(listener) }
  }

  async start(): Promise<void> {
    if (this.started) return
    if (this.disposed) throw new ConnectionError('fixture connection is disposed', 'DISPOSED')
    this.started = true
    await this.delay(this.config.initialConnectDelayMs, this.controller.signal)
    this.publishStatus({ phase: 'connected', host: FIXTURE_HOST })
    this.publishFrame({ kind: 'replace-baseline', baseline: this.cloneBaseline() })
  }

  reconnect(): void {
    if (this.disposed || this.status.phase === 'reconnecting' || this.status.phase === 'resyncing') return
    const task = this.runReconnect()
    this.track(task)
  }

  resolveInteraction(command: ResolveInteractionCommand): Promise<ResolveInteractionResult> {
    const existing = this.operations.get(command.operationId)
    if (existing !== undefined) return existing
    if (this.status.phase !== 'connected') {
      return Promise.reject(new ConnectionError('connection is not ready for mutations', 'NOT_CONNECTED'))
    }
    const inFlight = this.interactionOperations.get(command.interactionId)
    if (inFlight !== undefined && inFlight !== command.operationId) {
      return Promise.resolve({ kind: 'invalid', operationId: command.operationId, message: 'interaction already has an in-flight operation' })
    }
    const task = this.resolve(command)
    this.operations.set(command.operationId, task)
    this.interactionOperations.set(command.interactionId, command.operationId)
    void task.finally(() => {
      if (this.interactionOperations.get(command.interactionId) === command.operationId) {
        this.interactionOperations.delete(command.interactionId)
      }
    }).catch(() => undefined)
    this.track(task)
    return task
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.controller.abort()
    this.publishStatus({ phase: 'offline', detail: '演示连接已关闭' })
    await Promise.allSettled(this.tasks)
    this.statusListeners.clear()
    this.frameListeners.clear()
    this.operations.clear()
    this.interactionOperations.clear()
  }

  private async resolve(command: ResolveInteractionCommand): Promise<ResolveInteractionResult> {
    const interaction = this.baseline.interactions.find(item => item.id === command.interactionId)
    if (interaction === undefined) {
      return { kind: 'invalid', operationId: command.operationId, message: 'unknown interaction' }
    }
    if (interaction.status === 'resolved') {
      return { kind: 'stale', operationId: command.operationId, resolution: interaction.resolution ?? '' }
    }
    if (command.resolution.trim().length === 0) {
      return { kind: 'invalid', operationId: command.operationId, message: 'resolution cannot be empty' }
    }
    await this.delay(this.config.resolveDelayMs, this.controller.signal)
    if (this.disposed) throw new ConnectionError('fixture connection was disposed', 'DISPOSED')

    const resolvedAt = new Date().toISOString()
    const nextInteraction: Interaction = {
      ...interaction,
      status: 'resolved',
      resolution: command.resolution,
      resolvedAt,
    }
    const nextInteractions = this.baseline.interactions.map(item => item.id === interaction.id ? nextInteraction : item)
    const summary = interaction.kind === 'question'
      ? `已选择：${command.resolution}`
      : `审批结果：${command.resolution}`
    const message = {
      id: messageId(`message-resolution-${++this.cursor}`),
      role: 'system' as const,
      content: summary,
      createdAt: resolvedAt,
    }
    const nextSessions = this.baseline.sessions.map<SessionRecord>(session => session.id === interaction.sessionId
      ? {
        ...session,
        status: 'running',
        summary,
        updatedAt: resolvedAt,
        unread: false,
        messages: [...session.messages, message],
      }
      : session)
    const cursor = resumeCursor(`cursor-${this.cursor}`)
    this.baseline = { cursor, sessions: nextSessions, interactions: nextInteractions }
    this.publishFrame({
      kind: 'interaction-resolved',
      cursor,
      interactionId: interaction.id,
      resolution: command.resolution,
      resolvedAt,
      sessionStatus: 'running',
      sessionSummary: summary,
      message,
    })
    return { kind: 'accepted', operationId: command.operationId }
  }

  private async runReconnect(): Promise<void> {
    this.controller.abort()
    this.controller = new AbortController()
    const signal = this.controller.signal
    this.publishStatus({ phase: 'reconnecting', host: FIXTURE_HOST, detail: '连接中断，正在重试' })
    await this.delay(this.config.reconnectDelayMs, signal)
    this.publishStatus({ phase: 'resyncing', host: FIXTURE_HOST, detail: '正在校准 Session 状态' })
    await this.delay(this.config.resyncDelayMs, signal)
    if (signal.aborted || this.disposed) return
    this.publishFrame({ kind: 'replace-baseline', baseline: this.cloneBaseline() })
    this.publishStatus({ phase: 'connected', host: FIXTURE_HOST })
  }

  private publishStatus(status: ConnectionStatus): void {
    this.status = status
    for (const listener of this.statusListeners) listener()
  }

  private publishFrame(frame: ConnectionFrame): void {
    for (const listener of this.frameListeners) listener(frame)
  }

  private cloneBaseline(): HostBaseline {
    return structuredClone(this.baseline)
  }

  private track<T>(task: Promise<T>): void {
    this.tasks.add(task)
    void task.finally(() => { this.tasks.delete(task) }).catch(() => undefined)
  }

  private delay(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new ConnectionError('fixture operation was aborted', 'ABORTED'))
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer)
        reject(new ConnectionError('fixture operation was aborted', 'ABORTED'))
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, milliseconds)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}

/** Register the deterministic Stage 0 Connection Provider. */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = new FixtureConnectionProvider(resolveConfig(config))
  const unregister = ctx.companionConnection.registerProvider(provider)
  ctx.effect(() => async () => {
    unregister()
    await provider.dispose()
  }, 'connection-fixture.dispose')
}
