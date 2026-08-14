import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    companionConnection: ConnectionService
  }
}

/** Opaque identifier that cannot cross domains as an unqualified string. */
export type Branded<Value, Name extends string> = Value & { readonly __brand: Name }

export type HostId = Branded<string, 'HostId'>
export type SessionId = Branded<string, 'SessionId'>
export type InteractionId = Branded<string, 'InteractionId'>
export type OperationId = Branded<string, 'OperationId'>
export type MessageId = Branded<string, 'MessageId'>
export type ResumeCursor = Branded<string, 'ResumeCursor'>

function nonEmptyId<Name extends string>(value: string, name: Name): Branded<string, Name> {
  if (value.trim().length === 0) throw new ConnectionError(`${name} cannot be empty`, 'INVALID_ID')
  return value as Branded<string, Name>
}

export const hostId = (value: string): HostId => nonEmptyId(value, 'HostId')
export const sessionId = (value: string): SessionId => nonEmptyId(value, 'SessionId')
export const interactionId = (value: string): InteractionId => nonEmptyId(value, 'InteractionId')
export const operationId = (value: string): OperationId => nonEmptyId(value, 'OperationId')
export const messageId = (value: string): MessageId => nonEmptyId(value, 'MessageId')
export const resumeCursor = (value: string): ResumeCursor => nonEmptyId(value, 'ResumeCursor')

export type ConnectionPhase = 'booting' | 'connected' | 'reconnecting' | 'resyncing' | 'offline' | 'failed'
export type SessionStatus = 'running' | 'waiting' | 'completed' | 'failed'

/** Host identity and negotiated fixture capabilities. */
export interface HostDescription {
  id: HostId
  name: string
  mode: 'fixture'
  protocolVersion: string
  capabilities: readonly string[]
}

/** One conversation row rendered by the mobile Session surface. */
export interface ConversationMessage {
  id: MessageId
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  createdAt: string
  toolName?: string
  toolStatus?: 'running' | 'completed' | 'failed'
}

/** Session summary and bounded conversation window supplied by the Host. */
export interface SessionRecord {
  id: SessionId
  title: string
  workspace: string
  status: SessionStatus
  agent: string
  model: string
  summary: string
  updatedAt: string
  unread: boolean
  messages: readonly ConversationMessage[]
}

interface InteractionBase {
  id: InteractionId
  sessionId: SessionId
  createdAt: string
  source: string
  status: 'pending' | 'resolved'
  resolution?: string
  resolvedAt?: string
}

/** Question whose offered options are owned by the Host request. */
export interface QuestionInteraction extends InteractionBase {
  kind: 'question'
  title: string
  prompt: string
  options: readonly string[]
}

/** Approval with bounded, Host-owned presentation fields. */
export interface ApprovalInteraction extends InteractionBase {
  kind: 'approval'
  title: string
  toolName: string
  command: string
  risk: 'low' | 'medium' | 'high'
  detail: string
}

export type Interaction = QuestionInteraction | ApprovalInteraction

/** Complete replaceable client baseline. */
export interface HostBaseline {
  cursor: ResumeCursor
  sessions: readonly SessionRecord[]
  interactions: readonly Interaction[]
}

/** Authoritative downlink frames consumed by the Runtime. */
export type ConnectionFrame =
  | { kind: 'replace-baseline'; baseline: HostBaseline }
  | {
    kind: 'interaction-resolved'
    cursor: ResumeCursor
    interactionId: InteractionId
    resolution: string
    resolvedAt: string
    sessionStatus: SessionStatus
    sessionSummary: string
    message: ConversationMessage
  }

/** Physical connection status, independent of Session business state. */
export interface ConnectionStatus {
  phase: ConnectionPhase
  host?: HostDescription
  detail?: string
}

/** One state-changing Interaction command. */
export interface ResolveInteractionCommand {
  kind: 'resolve-interaction'
  interactionId: InteractionId
  resolution: string
  operationId: OperationId
}

/** Stable command outcome taxonomy. */
export type ResolveInteractionResult =
  | { kind: 'accepted'; operationId: OperationId }
  | { kind: 'stale'; operationId: OperationId; resolution: string }
  | { kind: 'forbidden'; operationId: OperationId }
  | { kind: 'invalid'; operationId: OperationId; message: string }

/** Provider contract for one authenticated physical carrier. */
export interface ConnectionProvider {
  getStatus(): ConnectionStatus
  subscribeStatus(listener: () => void): () => void
  subscribeFrames(listener: (frame: ConnectionFrame) => void): () => void
  start(): Promise<void>
  reconnect(): void
  resolveInteraction(command: ResolveInteractionCommand): Promise<ResolveInteractionResult>
  dispose(): Promise<void>
}

/** Stable Connection Service failures. */
export class ConnectionError extends Error {
  constructor(message: string, readonly code: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ConnectionError'
  }
}

/** `ctx.companionConnection`: one active carrier Provider and its Consumer API. */
export class ConnectionService extends Service {
  private provider: ConnectionProvider | undefined

  constructor(ctx: Context) {
    super(ctx, 'companionConnection')
  }

  /** Register the only active Connection Provider for this Cordis context. */
  registerProvider(provider: ConnectionProvider): () => void {
    const dispose = this.ctx.effect(function* (this: ConnectionService) {
      if (this.provider !== undefined) {
        throw new ConnectionError('a Companion Connection Provider is already registered', 'DUPLICATE_PROVIDER')
      }
      this.provider = provider
      yield () => { this.provider = undefined }
    }.bind(this), 'companionConnection.registerProvider()')
    return () => void dispose()
  }

  getStatus(): ConnectionStatus {
    return this.requireProvider().getStatus()
  }

  subscribeStatus(listener: () => void): () => void {
    return this.requireProvider().subscribeStatus(listener)
  }

  subscribeFrames(listener: (frame: ConnectionFrame) => void): () => void {
    return this.requireProvider().subscribeFrames(listener)
  }

  start(): Promise<void> {
    return this.requireProvider().start()
  }

  reconnect(): void {
    this.requireProvider().reconnect()
  }

  resolveInteraction(command: ResolveInteractionCommand): Promise<ResolveInteractionResult> {
    return this.requireProvider().resolveInteraction(command)
  }

  dispose(): Promise<void> {
    return this.requireProvider().dispose()
  }

  private requireProvider(): ConnectionProvider {
    if (this.provider === undefined) {
      throw new ConnectionError('no Companion Connection Provider is registered', 'NO_PROVIDER')
    }
    return this.provider
  }
}

export default ConnectionService
