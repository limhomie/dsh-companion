import { Context, Service } from '@deepseek-ai/cordis'
import {
  ConnectionError,
  operationId,
  type ConnectionFrame,
  type ConnectionPhase,
  type HostDescription,
  type Interaction,
  type InteractionId,
  type ResumeCursor,
  type SessionId,
  type SessionRecord,
} from '@dsh-companion/connection'

declare module '@deepseek-ai/cordis' {
  interface Context {
    companionRuntime: CompanionRuntimeService
  }
}

export type AttentionKind = 'question' | 'approval' | 'completed' | 'failed'

/** One derived row in the cross-Session attention inbox. */
export interface AttentionItem {
  id: string
  kind: AttentionKind
  sessionId: SessionId
  interactionId?: InteractionId
  title: string
  summary: string
  workspace: string
  updatedAt: string
  unread: boolean
}

export type OperationState =
  | { kind: 'submitting'; operationId: string }
  | { kind: 'failed'; operationId: string; message: string }

/** Immutable React-facing Runtime snapshot. */
export interface RuntimeSnapshot {
  phase: ConnectionPhase
  host?: HostDescription
  detail?: string
  cursor?: ResumeCursor
  sessions: readonly SessionRecord[]
  interactions: readonly Interaction[]
  attention: readonly AttentionItem[]
  operations: Readonly<Record<string, OperationState>>
}

const EMPTY_SNAPSHOT: RuntimeSnapshot = {
  phase: 'booting',
  sessions: [],
  interactions: [],
  attention: [],
  operations: {},
}

function deriveAttention(sessions: readonly SessionRecord[], interactions: readonly Interaction[]): readonly AttentionItem[] {
  const bySession = new Map(sessions.map(session => [session.id, session]))
  const pending = interactions.flatMap<AttentionItem>(interaction => {
    if (interaction.status !== 'pending') return []
    const session = bySession.get(interaction.sessionId)
    if (session === undefined) return []
    return [{
      id: `interaction:${interaction.id}`,
      kind: interaction.kind,
      sessionId: interaction.sessionId,
      interactionId: interaction.id,
      title: interaction.title,
      summary: interaction.kind === 'question' ? interaction.prompt : interaction.detail,
      workspace: session.workspace,
      updatedAt: interaction.createdAt,
      unread: true,
    }]
  })
  const outcomes = sessions.flatMap<AttentionItem>(session => {
    if (session.status !== 'completed' && session.status !== 'failed') return []
    return [{
      id: `session:${session.id}:${session.status}`,
      kind: session.status,
      sessionId: session.id,
      title: session.title,
      summary: session.summary,
      workspace: session.workspace,
      updatedAt: session.updatedAt,
      unread: session.unread,
    }]
  })
  return [...pending, ...outcomes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

/** One authoritative client projection for Session and Attention state. */
export class CompanionRuntimeService extends Service {
  static inject = ['companionConnection']

  private snapshot: RuntimeSnapshot = EMPTY_SNAPSHOT
  private readonly listeners = new Set<() => void>()
  private readonly pending = new Map<InteractionId, Promise<void>>()

  constructor(ctx: Context) {
    super(ctx, 'companionRuntime')
  }

  protected async *[Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    const unsubscribeStatus = this.ctx.companionConnection.subscribeStatus(() => { this.handleStatus() })
    const unsubscribeFrames = this.ctx.companionConnection.subscribeFrames(frame => { this.handleFrame(frame) })
    yield async () => {
      unsubscribeStatus()
      unsubscribeFrames()
      await this.ctx.companionConnection.dispose()
      await Promise.allSettled(this.pending.values())
      this.listeners.clear()
    }
    this.handleStatus()
    await this.ctx.companionConnection.start()
  }

  getSnapshot = (): RuntimeSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSession(id: SessionId): SessionRecord | undefined {
    return this.snapshot.sessions.find(session => session.id === id)
  }

  getInteraction(id: InteractionId): Interaction | undefined {
    return this.snapshot.interactions.find(interaction => interaction.id === id)
  }

  /** Resolve one pending Interaction; duplicate calls share the in-flight operation. */
  resolveInteraction(id: InteractionId, resolution: string): Promise<void> {
    const existing = this.pending.get(id)
    if (existing !== undefined) return existing
    if (this.snapshot.phase !== 'connected') {
      return Promise.reject(new ConnectionError('mutations are disabled until connection state converges', 'NOT_CONNECTED'))
    }
    const interaction = this.getInteraction(id)
    if (interaction === undefined || interaction.status !== 'pending') {
      return Promise.reject(new ConnectionError('interaction is no longer pending', 'STALE_INTERACTION'))
    }
    if (resolution.trim().length === 0) {
      return Promise.reject(new ConnectionError('resolution cannot be empty', 'INVALID_RESOLUTION'))
    }
    const idempotencyKey = operationId(crypto.randomUUID())
    this.publish({
      ...this.snapshot,
      operations: {
        ...this.snapshot.operations,
        [id]: { kind: 'submitting', operationId: idempotencyKey },
      },
    })
    const task = this.submit(id, resolution, idempotencyKey)
    this.pending.set(id, task)
    void task.finally(() => { this.pending.delete(id) }).catch(() => undefined)
    return task
  }

  reconnect(): void {
    this.ctx.companionConnection.reconnect()
  }

  private async submit(id: InteractionId, resolution: string, idempotencyKey: ReturnType<typeof operationId>): Promise<void> {
    try {
      const result = await this.ctx.companionConnection.resolveInteraction({
        kind: 'resolve-interaction',
        interactionId: id,
        resolution,
        operationId: idempotencyKey,
      })
      if (result.kind === 'accepted') return
      if (result.kind === 'stale') {
        this.clearOperation(id)
        return
      }
      const message = result.kind === 'forbidden' ? '当前设备没有处理此事项的权限' : result.message
      this.failOperation(id, idempotencyKey, message)
      throw new ConnectionError(message, result.kind === 'forbidden' ? 'FORBIDDEN' : 'INVALID_COMMAND')
    } catch (error) {
      if (this.snapshot.operations[id]?.kind === 'submitting') {
        const message = error instanceof Error ? error.message : '提交失败'
        this.failOperation(id, idempotencyKey, message)
      }
      throw error
    }
  }

  private handleStatus(): void {
    const status = this.ctx.companionConnection.getStatus()
    this.publish({ ...this.snapshot, ...status })
  }

  private handleFrame(frame: ConnectionFrame): void {
    switch (frame.kind) {
      case 'replace-baseline': {
        const operations = Object.fromEntries(Object.entries(this.snapshot.operations).filter(([id]) =>
          frame.baseline.interactions.some(interaction => interaction.id === id && interaction.status === 'pending')))
        this.publish({
          ...this.snapshot,
          cursor: frame.baseline.cursor,
          sessions: frame.baseline.sessions,
          interactions: frame.baseline.interactions,
          attention: deriveAttention(frame.baseline.sessions, frame.baseline.interactions),
          operations,
        })
        return
      }
      case 'interaction-resolved': {
        const interactions = this.snapshot.interactions.map(interaction => interaction.id === frame.interactionId
          ? { ...interaction, status: 'resolved' as const, resolution: frame.resolution, resolvedAt: frame.resolvedAt }
          : interaction)
        const sessions = this.snapshot.sessions.map(session => {
          const ownsInteraction = this.snapshot.interactions.some(interaction =>
            interaction.id === frame.interactionId && interaction.sessionId === session.id)
          return ownsInteraction
            ? {
              ...session,
              status: frame.sessionStatus,
              summary: frame.sessionSummary,
              updatedAt: frame.resolvedAt,
              unread: false,
              messages: [...session.messages, frame.message],
            }
            : session
        })
        const operations = { ...this.snapshot.operations }
        delete operations[frame.interactionId]
        this.publish({
          ...this.snapshot,
          cursor: frame.cursor,
          sessions,
          interactions,
          attention: deriveAttention(sessions, interactions),
          operations,
        })
        return
      }
      default:
        return frame satisfies never
    }
  }

  private clearOperation(id: InteractionId): void {
    const operations = { ...this.snapshot.operations }
    delete operations[id]
    this.publish({ ...this.snapshot, operations })
  }

  private failOperation(id: InteractionId, key: string, message: string): void {
    this.publish({
      ...this.snapshot,
      operations: { ...this.snapshot.operations, [id]: { kind: 'failed', operationId: key, message } },
    })
  }

  private publish(snapshot: RuntimeSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

export default CompanionRuntimeService
