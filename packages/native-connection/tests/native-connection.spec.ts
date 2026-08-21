import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-connection/client', () => ({
  WebApiClient: class {},
  createConnectionHandle: vi.fn(),
  createWebConnectionRpc: vi.fn(),
}))
vi.mock('@dsh-companion/device-trust', () => ({
  DeviceId: (value: string) => value,
  NativeChallengeId: (value: string) => value,
  nativeChallengeMessage: (deviceId: string, challengeId: string, challenge: string) => (
    `dsh-native-auth-v1\n${deviceId}\n${challengeId}\n${challenge}`
  ),
}))
vi.mock('@dsh-companion/device-trust-web', () => ({
  DeviceTrustClientError: class extends Error {
    constructor(
      readonly kind: string,
      message: string,
      readonly status?: number,
      readonly code?: string,
    ) {
      super(message)
    }
  },
}))

import {
  NativeConnectionClient,
  NativePairingUrlError,
  parseNativePairingUrl,
  type NativeIdentityPlugin,
} from '../src/index.ts'

const DEVICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CHALLENGE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function identity(): NativeIdentityPlugin {
  return {
    getIdentity: vi.fn(() => Promise.resolve({ publicKey: 'public-key', label: 'Phone' })),
    sign: vi.fn(() => Promise.resolve({ signature: 's'.repeat(72) })),
    loadConnection: vi.fn(() => Promise.resolve({
      configured: true,
      origin: 'https://host.example',
      deviceId: DEVICE_ID,
      label: 'Phone',
    })),
    saveConnection: vi.fn(),
    reset: vi.fn(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NativeConnectionClient', () => {
  it('accepts only an HTTPS pairing URL with an offer UUID', () => {
    expect(parseNativePairingUrl(`https://host.example/companion/?pair=${DEVICE_ID}`)).toEqual({
      origin: 'https://host.example',
      offerId: DEVICE_ID,
    })
    expect(() => parseNativePairingUrl(`http://host.example/companion/?pair=${DEVICE_ID}`))
      .toThrow(NativePairingUrlError)
    expect(() => parseNativePairingUrl('https://host.example/companion/'))
      .toThrow('二维码不包含安全配对信息')
  })

  it.each([
    {
      name: 'a plain Harness route',
      response: () => new Response('not found', {
        status: 404,
        headers: { 'content-type': 'text/plain' },
      }),
      expected: {
        kind: 'invalid-response',
        status: 404,
        message: '当前地址没有返回 DSH Companion 认证响应，请在电脑启动 Companion Host，而不是普通 Harness 服务',
      },
    },
    {
      name: 'an unavailable reverse proxy',
      response: () => new Response('bad gateway', {
        status: 503,
        headers: { 'content-type': 'text/plain' },
      }),
      expected: {
        kind: 'network',
        status: 503,
        message: '电脑端 Companion Host 暂时不可达，请确认服务和 Tailscale 后重试',
      },
    },
  ])('keeps the saved identity when authentication reaches $name', async ({ response, expected }) => {
    const platform = identity()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response())))

    const client = new NativeConnectionClient(platform)
    await client.loadBinding()

    await expect(client.authenticate()).rejects.toMatchObject(expected)
    expect(platform.reset).not.toHaveBeenCalled()
    expect(platform.saveConnection).not.toHaveBeenCalled()
  })

  it('renews an expired memory session and retries the rejected request once', async () => {
    const platform = identity()
    const credentials = ['first-session-credential-that-is-long-enough', 'second-session-credential-that-is-long-enough']
    let exchanges = 0
    const currentCredentials: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/device-auth.challenge') {
        return Response.json({
          challengeId: CHALLENGE_ID,
          challenge: 'challenge-material-that-is-at-least-thirty-two-bytes',
          expiresAt: '2030-01-01T00:00:00.000Z',
        })
      }
      if (path === '/api/device-auth.exchange') {
        const credential = credentials[exchanges++]
        return Response.json({
          credential,
          expiresAt: '2030-01-01T00:00:00.000Z',
          device: { deviceId: DEVICE_ID, label: 'Phone', access: 'owner' },
        })
      }
      if (path === '/api/device-pairing.current') {
        const credential = new Headers(init?.headers).get('authorization') ?? ''
        currentCredentials.push(credential)
        if (currentCredentials.length === 1) return new Response('unauthorized', { status: 401 })
        return Response.json({ device: { deviceId: DEVICE_ID, label: 'Phone', access: 'owner' } })
      }
      throw new Error(`unexpected request ${path}`)
    }))

    const client = new NativeConnectionClient(platform)
    await client.loadBinding()
    await client.authenticate()

    await expect(client.currentDevice()).resolves.toEqual({
      deviceId: DEVICE_ID,
      label: 'Phone',
      access: 'owner',
    })
    expect(platform.sign).toHaveBeenCalledTimes(2)
    expect(currentCredentials).toEqual([
      `DSH-Native ${credentials[0]}`,
      `DSH-Native ${credentials[1]}`,
    ])
  })

  it('aborts a native authentication request at the bounded timeout', async () => {
    const platform = identity()
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    )))

    const client = new NativeConnectionClient(platform, 5)
    await client.loadBinding()

    await expect(client.authenticate()).rejects.toMatchObject({
      kind: 'network',
      code: 'request-timeout',
      message: '连接电脑超时，请检查 Companion Host 和 Tailscale 后重试',
    })
    expect(platform.reset).not.toHaveBeenCalled()
  })

  it('waits for an aborted request when the client closes', async () => {
    const platform = identity()
    let aborted = false
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    )))
    const client = new NativeConnectionClient(platform)
    await client.loadBinding()
    const authentication = client.authenticate()
    const rejected = expect(authentication).rejects.toMatchObject({ kind: 'closed' })
    await vi.waitFor(() => { expect(globalThis.fetch).toHaveBeenCalledTimes(1) })

    await client.close()
    await rejected

    expect(aborted).toBe(true)
    expect(platform.reset).not.toHaveBeenCalled()
  })
})
