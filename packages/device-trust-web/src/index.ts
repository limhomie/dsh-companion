import { Context, Service } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import {
  DEVICE_PAIRING_PATHS,
  approveResponseSchema,
  claimResponseSchema,
  createResponseSchema,
  currentDeviceResponseSchema,
  devicePairingErrorSchema,
  devicesResponseSchema,
  pendingResponseSchema,
  pollResponseSchema,
  revokeResponseSchema,
  scopesResponseSchema,
  type ClaimPairingResponse,
  type CreatePairingResponse,
  type PendingPairingResponse,
  type PollPairingResponse,
  type TrustedDeviceResponse,
} from '@deepseek-ai/dsh-device-trust-connection'

declare module '@deepseek-ai/cordis' {
  interface Context {
    companionDeviceTrust: CompanionDeviceTrustService
  }
}

interface ResponseParser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false }
}

type FetchRequest = (input: string, init: RequestInit) => Promise<Response>

/** Browser authority established before the Companion runtime starts. */
export type CompanionTrustState = 'local' | 'paired' | 'unpaired'

/** Browser device-trust failure separated from Harness Connection failures. */
export class DeviceTrustClientError extends Error {
  override readonly name = 'DeviceTrustClientError'

  constructor(
    readonly kind: 'network' | 'http' | 'invalid-response' | 'closed',
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message)
  }
}

/**
 * Browser transport for the paired-device protocol. Each request owns an
 * AbortController; close aborts and awaits every in-flight request.
 */
export class DeviceTrustHttpClient {
  private readonly controllers = new Set<AbortController>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private closed = false

  constructor(private readonly fetchRequest: FetchRequest = globalThis.fetch.bind(globalThis)) {}

  createOffer(): Promise<CreatePairingResponse> {
    return this.post(DEVICE_PAIRING_PATHS.create, {}, createResponseSchema)
  }

  claimOffer(offerId: string, label: string): Promise<ClaimPairingResponse> {
    return this.post(DEVICE_PAIRING_PATHS.claim, { offerId, label }, claimResponseSchema)
  }

  pollClaim(claimId: string, claimSecret: string): Promise<PollPairingResponse> {
    return this.post(DEVICE_PAIRING_PATHS.poll, { claimId, claimSecret }, pollResponseSchema)
  }

  pendingClaims(): Promise<PendingPairingResponse> {
    return this.post(DEVICE_PAIRING_PATHS.pending, {}, pendingResponseSchema)
  }

  async approveClaim(claimId: string, verificationCode: string): Promise<void> {
    await this.post(DEVICE_PAIRING_PATHS.approve, { claimId, verificationCode }, approveResponseSchema)
  }

  async devices(): Promise<readonly TrustedDeviceResponse[]> {
    return (await this.post(DEVICE_PAIRING_PATHS.devices, {}, devicesResponseSchema)).devices
  }

  async currentDevice(): Promise<Pick<TrustedDeviceResponse, 'deviceId' | 'label' | 'scopes'>> {
    return (await this.post(DEVICE_PAIRING_PATHS.current, {}, currentDeviceResponseSchema)).device
  }

  async updateScopes(deviceId: string, scopes: TrustedDeviceResponse['scopes']): Promise<void> {
    await this.post(DEVICE_PAIRING_PATHS.scopes, { deviceId, scopes }, scopesResponseSchema)
  }

  async revoke(deviceId: string): Promise<void> {
    await this.post(DEVICE_PAIRING_PATHS.revoke, { deviceId }, revokeResponseSchema)
  }

  /** Abort and await all requests owned by this client. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const controller of this.controllers) controller.abort()
    await Promise.allSettled(this.inFlight)
  }

  private post<T>(path: string, payload: unknown, parser: ResponseParser<T>): Promise<T> {
    if (this.closed) return Promise.reject(new DeviceTrustClientError('closed', '设备信任客户端已关闭'))
    const controller = new AbortController()
    this.controllers.add(controller)
    const operation = this.request(path, payload, parser, controller.signal)
    this.inFlight.add(operation)
    return operation.finally(() => {
      this.controllers.delete(controller)
      this.inFlight.delete(operation)
    })
  }

  private async request<T>(
    path: string,
    payload: unknown,
    parser: ResponseParser<T>,
    signal: AbortSignal,
  ): Promise<T> {
    let response: Response
    try {
      response = await this.fetchRequest(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw new DeviceTrustClientError('closed', '设备信任请求已取消')
      throw new DeviceTrustClientError(
        'network',
        error instanceof Error ? error.message : '无法连接 Harness',
      )
    }

    let body: unknown
    try {
      body = await response.json() as unknown
    } catch {
      throw new DeviceTrustClientError('invalid-response', 'Harness 返回了无法解析的响应', response.status)
    }
    if (!response.ok) {
      const parsed = devicePairingErrorSchema.safeParse(body)
      if (parsed.success) {
        throw new DeviceTrustClientError('http', parsed.data.error.message, response.status, parsed.data.error.code)
      }
      throw new DeviceTrustClientError('http', `Harness 拒绝了请求（${response.status}）`, response.status)
    }
    const parsed = parser.safeParse(body)
    if (!parsed.success) {
      throw new DeviceTrustClientError('invalid-response', 'Harness 返回了不兼容的设备信任响应', response.status)
    }
    return parsed.data
  }
}

/** Plugin-scoped device trust client and the current browser authority. */
export class CompanionDeviceTrustService extends Service {
  static inject = ['connection']

  readonly client = new DeviceTrustHttpClient()
  readonly fixture = new URLSearchParams(window.location.search).has('fixture')
  readonly isLocal: boolean
  private currentDevice: Pick<TrustedDeviceResponse, 'deviceId' | 'label' | 'scopes'> | undefined
  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context) {
    super(ctx, 'companionDeviceTrust')
    this.isLocal = (ctx.get('connection') as ConnectionHandle).isLoopback
  }

  /** Local pages retain full interaction UI; paired devices require the explicit answer grant. */
  canAnswerInteractions(): boolean {
    return this.isLocal || this.currentDevice?.scopes.includes('interaction:answer') === true
  }

  /**
   * Classify the browser authority after service initialization.
   * @returns `local` for loopback, `paired` for a valid device Cookie, or `unpaired` for an explicit authentication rejection.
   */
  getTrustState(): CompanionTrustState {
    if (this.isLocal) return 'local'
    return this.currentDevice === undefined ? 'unpaired' : 'paired'
  }

  /** Current authenticated device state for reactive UI consumers. */
  getSnapshot = (): Pick<TrustedDeviceResponse, 'deviceId' | 'label' | 'scopes'> | undefined =>
    this.currentDevice

  /** Subscribe to current-device grant replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private async refreshCurrentDevice(): Promise<void> {
    if (this.isLocal) return
    let next: Pick<TrustedDeviceResponse, 'deviceId' | 'label' | 'scopes'> | undefined
    try {
      next = await this.client.currentDevice()
    } catch (error) {
      if (!(error instanceof DeviceTrustClientError
        && error.kind === 'http'
        && error.status === 401
        && error.code === 'device-unauthorized')) throw error
      next = undefined
    }
    if (JSON.stringify(next) === JSON.stringify(this.currentDevice)) return
    this.currentDevice = next
    for (const listener of this.listeners) listener()
  }

  protected async* [Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    const connection = this.ctx.get('connection') as ConnectionHandle
    await this.refreshCurrentDevice()
    let refreshing = false
    const refresh = (): void => {
      if (this.isLocal || refreshing) return
      refreshing = true
      void this.refreshCurrentDevice().catch(() => {
        // Connection owns reconnect diagnostics; retain the last authenticated grant until its next generation.
      }).finally(() => { refreshing = false })
    }
    const unsubscribe = connection.hostDescription.subscribe(() => {
      if (connection.hostDescription.getSnapshot() !== undefined) refresh()
    })
    refresh()
    yield async () => {
      unsubscribe()
      this.listeners.clear()
      await this.client.close()
    }
  }
}

export default CompanionDeviceTrustService
