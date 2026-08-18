import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-connection/client', () => ({
  WebApiClient: class {},
  createConnectionHandle: vi.fn(),
  createWebConnectionRpc: vi.fn(),
}))
vi.mock('@deepseek-ai/dsh-device-trust', () => ({
  DeviceId: (value: string) => value,
  NativeChallengeId: (value: string) => value,
  nativeChallengeMessage: (deviceId: string, challengeId: string, challenge: string) => (
    `dsh-native-auth-v1\n${deviceId}\n${challengeId}\n${challenge}`
  ),
}))
vi.mock('@dsh-companion/device-trust-web', () => ({
  DeviceTrustClientError: class extends Error {},
}))

import {
  NativeConnectionClient,
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
})
