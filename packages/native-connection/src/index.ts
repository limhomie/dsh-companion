import { registerPlugin } from '@capacitor/core'
import {
  WebApiClient,
  createConnectionHandle,
  createWebConnectionRpc,
  type ConnectionHandle,
} from '@deepseek-ai/dsh-client-connection/client'
import {
  DeviceId,
  NativeChallengeId,
  nativeChallengeMessage,
} from '@deepseek-ai/dsh-device-trust'
import {
  DEVICE_PAIRING_PATHS,
  accessResponseSchema,
  approveResponseSchema,
  claimResponseSchema,
  createResponseSchema,
  currentDeviceResponseSchema,
  devicePairingErrorSchema,
  devicesResponseSchema,
  nativeChallengeResponseSchema,
  nativeExchangeResponseSchema,
  nativeWebSocketTicketResponseSchema,
  pendingResponseSchema,
  pollResponseSchema,
  revokeResponseSchema,
  type ClaimPairingResponse,
  type PollPairingResponse,
  type TrustedDeviceResponse,
} from '@deepseek-ai/dsh-device-trust-connection'
import {
  DeviceTrustClientError,
  type CompanionDeviceTrust,
  type CompanionDeviceTrustClient,
} from '@dsh-companion/device-trust-web'

/** Native secure-key and non-secret connection metadata operations. */
export interface NativeIdentityPlugin {
  getIdentity(): Promise<{ publicKey: string; label: string }>
  sign(options: { message: string }): Promise<{ signature: string }>
  loadConnection(): Promise<{
    configured: boolean
    origin?: string
    deviceId?: string
    label?: string
  }>
  saveConnection(options: { origin: string; deviceId: string; label: string }): Promise<void>
  reset(): Promise<void>
}

const NativeIdentity = registerPlugin<NativeIdentityPlugin>('DshDeviceIdentity')

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false }
}

/** Validated durable connection facts that contain no reusable credential. */
export interface NativeConnectionBinding {
  readonly origin: string
  readonly deviceId: string
  readonly label: string
}

/** Current trusted-device fields returned after native proof succeeds. */
export type NativeDevicePrincipal = Pick<TrustedDeviceResponse, 'deviceId' | 'label' | 'access'>

function canonicalOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.origin !== value) throw new Error('Host 地址必须是完整的 HTTPS Origin')
  return url.origin
}

function pairingTarget(value: string): { origin: string; offerId: string } {
  const url = new URL(value.trim())
  const offerId = url.searchParams.get('pair')
  if (url.protocol !== 'https:' || offerId === null || !/^[0-9a-f-]{36}$/i.test(offerId)) {
    throw new Error('请输入电脑端生成的完整配对链接')
  }
  return { origin: url.origin, offerId }
}

async function parseJson<T>(response: Response, parser: Parser<T>): Promise<T> {
  let body: unknown
  try {
    body = await response.json() as unknown
  } catch {
    throw new DeviceTrustClientError('invalid-response', 'Harness 返回了无法解析的响应', response.status)
  }
  if (!response.ok) {
    const error = devicePairingErrorSchema.safeParse(body)
    if (error.success) {
      throw new DeviceTrustClientError('http', error.data.error.message, response.status, error.data.error.code)
    }
    throw new DeviceTrustClientError('http', `Harness 拒绝了请求（${response.status}）`, response.status)
  }
  const parsed = parser.safeParse(body)
  if (!parsed.success) throw new DeviceTrustClientError('invalid-response', 'Harness 返回了不兼容的响应', response.status)
  return parsed.data
}

/** Android key-bound pairing and short-lived transport owner. */
export class NativeConnectionClient implements CompanionDeviceTrustClient {
  private sessionCredential: string | undefined
  private authentication: Promise<NativeDevicePrincipal> | undefined
  private binding: NativeConnectionBinding | undefined
  private closed = false

  constructor(private readonly identity: NativeIdentityPlugin = NativeIdentity) {}

  /** Load non-secret connection metadata previously saved by the platform plugin. */
  async loadBinding(): Promise<NativeConnectionBinding | undefined> {
    const stored = await this.identity.loadConnection()
    if (!stored.configured) return undefined
    if (stored.origin === undefined || stored.deviceId === undefined || stored.label === undefined) {
      throw new Error('Android 保存的连接信息不完整')
    }
    this.binding = {
      origin: canonicalOrigin(stored.origin),
      deviceId: stored.deviceId,
      label: stored.label,
    }
    return this.binding
  }

  /** Claim a browser-generated offer with the Android Keystore public key. */
  async claimPairingUrl(pairingUrl: string, requestedLabel?: string): Promise<ClaimPairingResponse> {
    const target = pairingTarget(pairingUrl)
    const identity = await this.identity.getIdentity()
    const label = requestedLabel?.trim() || identity.label
    const claim = await this.post(target.origin, DEVICE_PAIRING_PATHS.claim, {
      offerId: target.offerId,
      label,
      binding: { kind: 'native-p256', publicKey: identity.publicKey },
    }, claimResponseSchema)
    this.binding = { origin: target.origin, deviceId: '', label }
    return claim
  }

  /** Poll an in-memory claim and persist only non-secret connection metadata after approval. */
  async finishPairing(claimId: string, claimSecret: string): Promise<PollPairingResponse> {
    const pending = this.binding
    if (pending === undefined) throw new Error('没有正在进行的 Android 配对')
    const result = await this.post(pending.origin, DEVICE_PAIRING_PATHS.poll, {
      claimId,
      claimSecret,
    }, pollResponseSchema)
    if (result.status === 'approved') {
      const binding = { origin: pending.origin, deviceId: result.device.deviceId, label: result.device.label }
      await this.identity.saveConnection(binding)
      this.binding = binding
    }
    return result
  }

  /** Prove possession of the Keystore key and create a memory-only transport session. */
  async authenticate(): Promise<NativeDevicePrincipal> {
    if (this.authentication !== undefined) return await this.authentication
    const authentication = this.performAuthentication()
    this.authentication = authentication
    try {
      return await authentication
    } finally {
      if (this.authentication === authentication) this.authentication = undefined
    }
  }

  private async performAuthentication(): Promise<NativeDevicePrincipal> {
    const binding = this.binding ?? await this.loadBinding()
    if (binding === undefined || binding.deviceId === '') throw new Error('Android 设备尚未配对')
    const challenge = await this.post(binding.origin, DEVICE_PAIRING_PATHS.nativeChallenge, {
      deviceId: binding.deviceId,
    }, nativeChallengeResponseSchema)
    const message = nativeChallengeMessage(
      DeviceId(binding.deviceId),
      NativeChallengeId(challenge.challengeId),
      challenge.challenge,
    )
    const { signature } = await this.identity.sign({ message })
    const session = await this.post(binding.origin, DEVICE_PAIRING_PATHS.nativeExchange, {
      deviceId: binding.deviceId,
      challengeId: challenge.challengeId,
      signature,
    }, nativeExchangeResponseSchema)
    if (this.closed) throw new DeviceTrustClientError('closed', 'Android 连接已经关闭')
    this.sessionCredential = session.credential
    return session.device
  }

  /** Build the Harness Connection transport after native authentication succeeds. */
  connection(): ConnectionHandle {
    const binding = this.requireBinding()
    const authenticatedFetch: typeof globalThis.fetch = async (input, init) => await this.fetchAuthenticated(input, init)
    const api = new WebApiClient({
      baseUrl: binding.origin,
      fetch: authenticatedFetch,
      openWebSocket: async (url) => {
        const response = await authenticatedFetch(
          new URL(DEVICE_PAIRING_PATHS.nativeWebSocketTicket, binding.origin),
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
        )
        const { ticket } = await parseJson(response, nativeWebSocketTicketResponseSchema)
        return new WebSocket(url, ['dsh-native', `dsh-ticket.${ticket}`])
      },
    })
    return createConnectionHandle({
      api,
      rpc: createWebConnectionRpc({ baseUrl: binding.origin, fetch: authenticatedFetch }),
      isLoopback: false,
    })
  }

  createOffer() { return this.authenticatedPost(DEVICE_PAIRING_PATHS.create, {}, createResponseSchema) }
  claimOffer(offerId: string, label: string) {
    return this.authenticatedPost(DEVICE_PAIRING_PATHS.claim, { offerId, label }, claimResponseSchema)
  }
  pollClaim(claimId: string, claimSecret: string) {
    return this.authenticatedPost(DEVICE_PAIRING_PATHS.poll, { claimId, claimSecret }, pollResponseSchema)
  }
  pendingClaims() { return this.authenticatedPost(DEVICE_PAIRING_PATHS.pending, {}, pendingResponseSchema) }
  async approveClaim(claimId: string, verificationCode: string): Promise<void> {
    await this.authenticatedPost(DEVICE_PAIRING_PATHS.approve, { claimId, verificationCode }, approveResponseSchema)
  }
  async devices(): Promise<readonly TrustedDeviceResponse[]> {
    return (await this.authenticatedPost(DEVICE_PAIRING_PATHS.devices, {}, devicesResponseSchema)).devices
  }
  async currentDevice(): Promise<Pick<TrustedDeviceResponse, 'deviceId' | 'label' | 'access'>> {
    return (await this.authenticatedPost(DEVICE_PAIRING_PATHS.current, {}, currentDeviceResponseSchema)).device
  }
  async updateAccess(deviceId: string, access: TrustedDeviceResponse['access']): Promise<void> {
    await this.authenticatedPost(DEVICE_PAIRING_PATHS.access, { deviceId, access }, accessResponseSchema)
  }
  async revoke(deviceId: string): Promise<void> {
    await this.authenticatedPost(DEVICE_PAIRING_PATHS.revoke, { deviceId }, revokeResponseSchema)
  }

  /** Remove all native connection state and the Keystore identity. */
  async reset(): Promise<void> {
    this.sessionCredential = undefined
    this.authentication = undefined
    this.binding = undefined
    await this.identity.reset()
    this.closed = false
  }

  /** Clear process credentials without deleting the paired Keystore identity. */
  close(): void {
    this.closed = true
    this.sessionCredential = undefined
    this.authentication = undefined
  }

  private async authenticatedPost<T>(path: string, payload: unknown, parser: Parser<T>): Promise<T> {
    const response = await this.fetchAuthenticated(new URL(path, this.requireBinding().origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return await parseJson(response, parser)
  }

  private async fetchAuthenticated(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const send = async (credential: string): Promise<Response> => {
      const headers = new Headers(init?.headers)
      headers.set('authorization', `DSH-Native ${credential}`)
      return await globalThis.fetch(input, { ...init, headers })
    }
    if (this.sessionCredential === undefined) await this.authenticate()
    let credential = this.requireSession()
    let response = await send(credential)
    if (response.status !== 401) return response
    if (this.sessionCredential === credential) this.sessionCredential = undefined
    if (this.sessionCredential === undefined) await this.authenticate()
    credential = this.requireSession()
    response = await send(credential)
    return response
  }

  private async post<T>(
    origin: string,
    path: string,
    payload: unknown,
    parser: Parser<T>,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    if (this.closed) throw new DeviceTrustClientError('closed', 'Android 连接已经关闭')
    let response: Response
    try {
      response = await globalThis.fetch(new URL(path, origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...extraHeaders },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      throw new DeviceTrustClientError('network', error instanceof Error ? error.message : '无法连接 Harness')
    }
    return await parseJson(response, parser)
  }

  private requireBinding(): NativeConnectionBinding {
    if (this.binding === undefined || this.binding.deviceId === '') throw new Error('Android 设备尚未配对')
    return this.binding
  }

  private requireSession(): string {
    if (this.sessionCredential === undefined) throw new Error('Android 设备会话尚未认证')
    return this.sessionCredential
  }
}

/** Native device authority facade consumed by the platform-neutral UI. */
export class NativeCompanionDeviceTrust implements CompanionDeviceTrust {
  readonly fixture = false
  readonly isLocal = false
  readonly client: CompanionDeviceTrustClient
  private current: NativeDevicePrincipal
  private readonly listeners = new Set<() => void>()
  private unsubscribeConnection: (() => void) | undefined

  constructor(client: NativeConnectionClient, device: NativeDevicePrincipal) {
    this.client = client
    this.current = device
  }

  canAnswerInteractions(): boolean { return this.current.access === 'owner' }
  canPrompt(): boolean { return this.current.access === 'owner' }
  getTrustState(): 'paired' { return 'paired' }
  getSnapshot = () => this.current
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Refresh authoritative access after each completed Connection generation. */
  attach(connection: ConnectionHandle): void {
    this.unsubscribeConnection = connection.hostDescription.subscribe(() => {
      if (connection.hostDescription.getSnapshot() === undefined) return
      void this.client.currentDevice().then((device) => {
        if (JSON.stringify(device) === JSON.stringify(this.current)) return
        this.current = device
        for (const listener of this.listeners) listener()
      }).catch(() => {
        // Connection owns reconnect diagnostics and will establish another generation.
      })
    })
  }

  dispose(): void {
    this.unsubscribeConnection?.()
    this.unsubscribeConnection = undefined
    this.listeners.clear()
  }
}
