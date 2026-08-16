import { Context, Service } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import {
  DEVICE_PAIRING_PATHS,
  approveResponseSchema,
  claimResponseSchema,
  createResponseSchema,
  devicePairingErrorSchema,
  devicesResponseSchema,
  pendingResponseSchema,
  pollResponseSchema,
  revokeResponseSchema,
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

  constructor(ctx: Context) {
    super(ctx, 'companionDeviceTrust')
    this.isLocal = (ctx.get('connection') as ConnectionHandle).isLoopback
  }

  /** Local pages retain full interaction UI; paired PWA devices are read-only. */
  canAnswerInteractions(): boolean {
    return this.isLocal
  }

  protected async* [Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    yield async () => { await this.client.close() }
  }
}

export default CompanionDeviceTrustService
