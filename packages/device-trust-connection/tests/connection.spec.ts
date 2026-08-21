import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  DeviceId,
  NativeChallengeId,
  PairingClaimId,
  PairingOfferId,
  type DeviceTrustProvider,
} from '@dsh-companion/device-trust'
import type {
  ConnectionAccessGuard,
  HostConnectionHandle,
} from '@deepseek-ai/dsh-client-connection'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply, DEVICE_COOKIE_NAME, inject } from '../src/index.ts'

interface ResponseState {
  status?: number
  body?: string
  headers: Record<string, string | number | string[]>
}

function responseRecorder(): { response: ServerResponse; state: ResponseState } {
  const state: ResponseState = { headers: {} }
  const response = Object.assign(new EventEmitter(), {
    setHeader(name: string, value: string | number | readonly string[]) {
      state.headers[name.toLowerCase()] = typeof value === 'string' || typeof value === 'number'
        ? value
        : Array.from(value)
      return this
    },
    writeHead(status: number, headers?: Record<string, string | number>) {
      state.status = status
      for (const [name, value] of Object.entries(headers ?? {})) state.headers[name.toLowerCase()] = value
      return this
    },
    end(value?: string) {
      if (value !== undefined) state.body = value
      return this
    },
  }) as unknown as ServerResponse
  return { response, state }
}

function post(
  path: string,
  body: unknown,
  host: string,
  cookie?: string,
  extraHeaders: Record<string, string> = {},
): IncomingMessage {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
  Object.assign(request, {
    method: 'POST',
    url: path,
    headers: {
      host,
      origin: host === 'phone.example' ? 'https://phone.example' : `http://${host}`,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...(cookie === undefined ? {} : { cookie }),
      ...extraHeaders,
    },
  })
  return request
}

interface TestDeviceTrustProvider extends DeviceTrustProvider {
  readonly updateAccessMock: ReturnType<typeof vi.fn>
}

function provider(): TestDeviceTrustProvider {
  const deviceId = DeviceId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  const updateAccessMock = vi.fn()
  return {
    createOffer: vi.fn(() => Promise.resolve({
      offerId: PairingOfferId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      expiresAt: '2030-01-01T00:00:00.000Z',
    })),
    claimOffer: vi.fn(),
    pendingClaims: vi.fn(() => Promise.resolve([])),
    approveClaim: vi.fn(),
    pollClaim: vi.fn(() => Promise.resolve({
      status: 'approved',
      credential: `${deviceId}.raw-secret`,
      device: {
        deviceId,
        label: 'Phone',
        access: 'viewer',
        createdAt: '2029-01-01T00:00:00.000Z',
        expiresAt: '2030-01-01T00:00:00.000Z',
      },
    })),
    authenticate: vi.fn((credential: string) => Promise.resolve(
      credential === 'valid'
        ? { deviceId, label: 'Phone', access: 'viewer' as const }
        : credential === 'owner'
          ? { deviceId, label: 'Phone', access: 'owner' as const }
          : undefined,
    )),
    createNativeChallenge: vi.fn(() => Promise.resolve({
      challengeId: NativeChallengeId('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
      challenge: 'challenge-material-that-is-at-least-thirty-two-bytes',
      expiresAt: '2030-01-01T00:00:00.000Z',
    })),
    exchangeNativeChallenge: vi.fn(() => Promise.resolve({
      credential: 'owner',
      expiresAt: '2030-01-01T00:00:00.000Z',
      device: { deviceId, label: 'Phone', access: 'owner' as const },
    })),
    listDevices: vi.fn(() => Promise.resolve([])),
    updateAccess: updateAccessMock,
    updateAccessMock,
    revoke: vi.fn(),
  } as unknown as TestDeviceTrustProvider
}

async function mounted(): Promise<{
  ctx: Context
  routes: WebRoute[]
  guard: ConnectionAccessGuard
  disconnect: ReturnType<typeof vi.fn>
  deviceTrust: TestDeviceTrustProvider
  close(): Promise<void>
}> {
  const ctx = new Context()
  const routes: WebRoute[] = []
  let guard: ConnectionAccessGuard | undefined
  const disconnect = vi.fn()
  const connection: HostConnectionHandle = {
    rpc: {} as HostConnectionHandle['rpc'],
    access: {
      register(value) {
        if (guard !== undefined) throw new Error('duplicate guard')
        guard = value
        return () => { guard = undefined }
      },
      disconnect,
    },
    allows(headers, authority) {
      const host = headers instanceof Headers ? headers.get('host') : headers.host
      return typeof host === 'string'
        && (host.startsWith('127.0.0.1') || (authority === 'trusted-host' && host === 'phone.example'))
    },
  }
  const webServer = {
    register(route: WebRoute) {
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
  } as WebServer
  ctx.provide('connection', connection)
  const deviceTrust = provider()
  ctx.provide('deviceTrust', deviceTrust)
  ctx.provide('webServer', webServer)
  const fiber = ctx.plugin({ inject: [...inject], apply }, {
    publicOrigin: 'https://phone.example',
    maxRequestBodyBytes: 16_384,
    nativeWebSocketTicketTtlMs: 30_000,
    maxPendingNativeWebSocketTickets: 8,
  })
  await fiber.await()
  if (guard === undefined) throw new Error('guard was not registered')
  return { ctx, routes, guard, disconnect, deviceTrust, close: () => fiber.dispose() }
}

describe('device trust Connection consumer', () => {
  it('authenticates the Cookie and enforces viewer, owner, and local-only targets', async () => {
    const host = await mounted()
    try {
      await expect(host.guard.authorize({}, {
        kind: 'http', method: 'POST', path: '/api/session.list', remoteAccess: 'viewer',
      })).resolves.toEqual({ allowed: false, status: 401 })
      await expect(host.guard.authorize({ cookie: `${DEVICE_COOKIE_NAME}=invalid` }, {
        kind: 'http', method: 'POST', path: '/api/session.list', remoteAccess: 'viewer',
      })).resolves.toEqual({ allowed: false, status: 401 })
      await expect(host.guard.authorize({ cookie: `other=x; ${DEVICE_COOKIE_NAME}=valid` }, {
        kind: 'http', method: 'POST', path: '/api/session.history', remoteAccess: 'viewer',
      })).resolves.toMatchObject({ allowed: true })
      await expect(host.guard.authorize({ cookie: `${DEVICE_COOKIE_NAME}=valid` }, {
        kind: 'http', method: 'POST', path: '/api/session.prompt', remoteAccess: 'owner',
      })).resolves.toEqual({ allowed: false, status: 403 })
      const prompt = await host.guard.authorize({ cookie: `${DEVICE_COOKIE_NAME}=owner` }, {
        kind: 'http', method: 'POST', path: '/api/session.prompt', remoteAccess: 'owner',
      })
      expect(prompt).toMatchObject({ allowed: true })
      if (!prompt.allowed) throw new Error('prompt authorization expected')
      expect(prompt.apiContext.allows('session:prompt')).toBe(true)
      expect(prompt.apiContext.allows('session:prompt:unrestricted')).toBe(true)
      expect(prompt.apiContext.allows('interaction:answer')).toBe(true)
      await expect(host.guard.authorize({ cookie: `${DEVICE_COOKIE_NAME}=valid` }, {
        kind: 'http', method: 'POST', path: '/api/respond', remoteAccess: 'owner',
      })).resolves.toEqual({ allowed: false, status: 403 })
      const answer = await host.guard.authorize({ cookie: `${DEVICE_COOKIE_NAME}=owner` }, {
        kind: 'http', method: 'POST', path: '/api/respond', remoteAccess: 'owner',
      })
      expect(answer).toMatchObject({
        allowed: true,
        apiContext: { source: { kind: 'paired-device', deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } },
      })
      if (!answer.allowed) throw new Error('answer authorization expected')
      expect(answer.apiContext.allows('interaction:answer')).toBe(true)
      expect(answer.apiContext.signal.aborted).toBe(false)
      await expect(host.guard.authorize({ cookie: `${DEVICE_COOKIE_NAME}=valid` }, {
        kind: 'websocket', path: '/api/events.mux', remoteAccess: 'viewer',
      })).resolves.toMatchObject({ allowed: true })
      const hostStream = await host.guard.authorize({ cookie: `${DEVICE_COOKIE_NAME}=valid` }, {
        kind: 'websocket', path: '/api/events.host', remoteAccess: 'viewer',
      })
      expect(hostStream).toMatchObject({ allowed: true })
      if (!hostStream.allowed || hostStream.downlinkFilter === undefined) {
        throw new Error('host downlink filter expected')
      }
      expect(hostStream.downlinkFilter({
        rpcId: 'private' as never,
        payload: { type: 'host/remote-event', event: 'credentials/updated', args: [] },
      })).toBe(false)
      expect(hostStream.downlinkFilter({
        rpcId: 'session' as never,
        payload: { type: 'host/session-status', sessionId: 'session-1' as never, running: true },
      })).toBe(true)
      const ownerHostStream = await host.guard.authorize({ cookie: `${DEVICE_COOKIE_NAME}=owner` }, {
        kind: 'websocket', path: '/api/events.host', remoteAccess: 'viewer',
      })
      expect(ownerHostStream).toMatchObject({ allowed: true })
      if (!ownerHostStream.allowed) throw new Error('owner host stream authorization expected')
      expect(ownerHostStream.downlinkFilter).toBeUndefined()

      const id = DeviceId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
      await expect(host.guard.authorize({ cookie: `${DEVICE_COOKIE_NAME}=owner` }, {
        kind: 'http', method: 'POST', path: '/api/host.openPath', remoteAccess: 'local-only',
      })).resolves.toEqual({ allowed: false, status: 403 })

      host.ctx.emit('device-trust/access-updated', id, 'viewer')
      expect(answer.apiContext.signal.aborted).toBe(true)
      expect(host.disconnect).toHaveBeenCalledWith(id)
      host.disconnect.mockClear()
      host.ctx.emit('device-trust/revoked', id)
      expect(host.disconnect).toHaveBeenCalledWith(id)
    } finally {
      await host.close()
    }
  })

  it('returns a QR target locally and delivers approval only through an HttpOnly Cookie', async () => {
    const host = await mounted()
    try {
      const createRoute = host.routes.find(route => route.path === '/api/device-pairing.create')!
      const created = responseRecorder()
      await createRoute.handler(post(createRoute.path, {}, '127.0.0.1:3080'), created.response)
      expect(created.state.status).toBe(200)
      expect(JSON.parse(created.state.body ?? '{}')).toMatchObject({
        pairingUrl: 'https://phone.example/companion/?pair=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      })

      const pollRoute = host.routes.find(route => route.path === '/api/device-pairing.poll')!
      const polled = responseRecorder()
      await pollRoute.handler(post(pollRoute.path, {
        claimId: PairingClaimId('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
        claimSecret: 'x'.repeat(32),
      }, 'phone.example'), polled.response)
      expect(polled.state.status).toBe(200)
      expect(polled.state.headers['set-cookie']).toEqual(expect.stringContaining(
        `${DEVICE_COOKIE_NAME}=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.raw-secret; Path=/;`,
      ))
      expect(polled.state.headers['set-cookie']).toEqual(expect.stringContaining('Secure; HttpOnly; SameSite=Strict'))
      expect(polled.state.body).not.toContain('raw-secret')
    } finally {
      await host.close()
    }
  })

  it('lets a paired device read only its own access and keeps replacement local', async () => {
    const host = await mounted()
    try {
      const currentRoute = host.routes.find(route => route.path === '/api/device-pairing.current')!
      const current = responseRecorder()
      await currentRoute.handler(post(
        currentRoute.path,
        {},
        'phone.example',
        `${DEVICE_COOKIE_NAME}=owner`,
      ), current.response)
      expect(current.state.status).toBe(200)
      expect(JSON.parse(current.state.body ?? '{}')).toEqual({
        device: {
          deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          label: 'Phone',
          access: 'owner',
        },
      })

      const unauthenticated = responseRecorder()
      await currentRoute.handler(post(currentRoute.path, {}, 'phone.example'), unauthenticated.response)
      expect(unauthenticated.state.status).toBe(401)

      const accessRoute = host.routes.find(route => route.path === '/api/device-pairing.access')!
      const remoteUpdate = responseRecorder()
      await accessRoute.handler(post(accessRoute.path, {
        deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        access: 'owner',
      }, 'phone.example', `${DEVICE_COOKIE_NAME}=owner`), remoteUpdate.response)
      expect(remoteUpdate.state.status).toBe(403)

      const localUpdate = responseRecorder()
      await accessRoute.handler(post(accessRoute.path, {
        deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        access: 'owner',
      }, '127.0.0.1:3080'), localUpdate.response)
      expect(localUpdate.state.status).toBe(200)
      expect(host.deviceTrust.updateAccessMock).toHaveBeenCalledWith(
        DeviceId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        'owner',
      )
    } finally {
      await host.close()
    }
  })

  it('exchanges native proof for a short session and consumes each WebSocket ticket once', async () => {
    const host = await mounted()
    try {
      const challengeRoute = host.routes.find(route => route.path === '/api/device-auth.challenge')!
      const challenged = responseRecorder()
      await challengeRoute.handler(post(challengeRoute.path, {
        deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }, 'phone.example'), challenged.response)
      expect(challenged.state.status).toBe(200)
      expect(JSON.parse(challenged.state.body ?? '{}')).toMatchObject({
        challengeId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      })

      const exchangeRoute = host.routes.find(route => route.path === '/api/device-auth.exchange')!
      const exchanged = responseRecorder()
      await exchangeRoute.handler(post(exchangeRoute.path, {
        deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        challengeId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        signature: 's'.repeat(72),
      }, 'phone.example'), exchanged.response)
      expect(exchanged.state.status).toBe(200)
      expect(exchanged.state.headers['set-cookie']).toBeUndefined()
      expect(JSON.parse(exchanged.state.body ?? '{}')).toMatchObject({
        credential: 'owner',
        device: { access: 'owner' },
      })

      const nativeHttp = await host.guard.authorize({ authorization: 'DSH-Native owner' }, {
        kind: 'http', method: 'POST', path: '/api/session.prompt', remoteAccess: 'owner',
      })
      expect(nativeHttp).toMatchObject({ allowed: true })

      const ticketRoute = host.routes.find(route => route.path === '/api/device-auth.websocket-ticket')!
      const ticketed = responseRecorder()
      await ticketRoute.handler(post(ticketRoute.path, {}, 'phone.example', undefined, {
        authorization: 'DSH-Native owner',
      }), ticketed.response)
      expect(ticketed.state.status).toBe(200)
      const { ticket } = JSON.parse(ticketed.state.body ?? '{}') as { ticket: string }
      const websocketHeaders = { 'sec-websocket-protocol': `dsh-native, dsh-ticket.${ticket}` }
      await expect(host.guard.authorize(websocketHeaders, {
        kind: 'websocket', path: '/api/events.mux', remoteAccess: 'viewer',
      })).resolves.toMatchObject({ allowed: true })
      await expect(host.guard.authorize(websocketHeaders, {
        kind: 'websocket', path: '/api/events.mux', remoteAccess: 'viewer',
      })).resolves.toEqual({ allowed: false, status: 401 })
    } finally {
      await host.close()
    }
  })

  it('fails load when the pairing origin is not a trusted Connection authority', async () => {
    const ctx = new Context()
    ctx.provide('connection', {
      rpc: {}, access: { register: () => () => {}, disconnect: () => {} }, allows: () => false,
    } as unknown as HostConnectionHandle)
    ctx.provide('deviceTrust', provider())
    ctx.provide('webServer', { register: () => () => {} } as unknown as WebServer)
    const fiber = ctx.plugin({ inject: [...inject], apply }, {
      publicOrigin: 'https://untrusted.example',
      maxRequestBodyBytes: 1024,
      nativeWebSocketTicketTtlMs: 30_000,
      maxPendingNativeWebSocketTickets: 8,
    })
    await expect(fiber).rejects.toThrow('absent from Connection trustedHosts')
  })
})
