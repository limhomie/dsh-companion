import { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { describe, expect, it, vi } from 'vitest'
import {
  CompanionDeviceTrustService,
  DeviceTrustClientError,
  DeviceTrustHttpClient,
} from '../src/index.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('browser device trust client', () => {
  it('claims an offer through a same-origin credentialed request', async () => {
    const request = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() => Promise.resolve(jsonResponse({
      claimId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      claimSecret: 's'.repeat(32),
      verificationCode: '482913',
      expiresAt: '2030-01-01T00:00:00.000Z',
    })))
    const client = new DeviceTrustHttpClient(request)
    try {
      await expect(client.claimOffer('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '我的手机'))
        .resolves.toMatchObject({ verificationCode: '482913' })
      expect(request).toHaveBeenCalledWith('/api/device-pairing.claim', expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
      }))
      expect(JSON.parse(String(request.mock.calls[0]?.[1].body))).toEqual({
        offerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        label: '我的手机',
      })
    } finally {
      await client.close()
    }
  })

  it('separates stable Host errors from incompatible success responses', async () => {
    const denied = new DeviceTrustHttpClient(() => Promise.resolve(jsonResponse({
      error: { code: 'offer-expired', message: 'expired' },
    }, 410)))
    await expect(denied.createOffer()).rejects.toMatchObject({
      kind: 'http', status: 410, code: 'offer-expired', message: 'expired',
    } satisfies Partial<DeviceTrustClientError>)
    await denied.close()

    const malformed = new DeviceTrustHttpClient(() => Promise.resolve(jsonResponse({ offerId: 'not-a-uuid' })))
    await expect(malformed.createOffer()).rejects.toMatchObject({ kind: 'invalid-response' })
    await malformed.close()
  })

  it('reads the authenticated grant and replaces a device grant through exact endpoints', async () => {
    const request = vi.fn<(input: string, init: RequestInit) => Promise<Response>>((input) => Promise.resolve(
      input === '/api/device-pairing.current'
        ? jsonResponse({
            device: {
              deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              label: '我的手机',
              scopes: ['session:read', 'interaction:answer'],
            },
          })
        : jsonResponse({ updated: true }),
    ))
    const client = new DeviceTrustHttpClient(request)
    try {
      await expect(client.currentDevice()).resolves.toMatchObject({
        label: '我的手机',
        scopes: ['session:read', 'interaction:answer'],
      })
      await client.updateScopes(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ['session:read'],
      )
      expect(request.mock.calls.map(call => call[0])).toEqual([
        '/api/device-pairing.current',
        '/api/device-pairing.scopes',
      ])
      expect(JSON.parse(String(request.mock.calls[1]?.[1].body))).toEqual({
        deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        scopes: ['session:read'],
      })
    } finally {
      await client.close()
    }
  })

  it('aborts and awaits an in-flight request when closed', async () => {
    const request = vi.fn((_input: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'))
      }, { once: true })
    }))
    const client = new DeviceTrustHttpClient(request)
    const pending = client.createOffer()
    const rejected = expect(pending).rejects.toMatchObject({ kind: 'closed' })
    await client.close()
    await rejected
    await expect(client.createOffer()).rejects.toMatchObject({ kind: 'closed' })
  })
})

describe('Companion device trust service', () => {
  it('publishes an unpaired state when the Host explicitly rejects the device credential', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({
      error: { code: 'device-unauthorized', message: 'paired-device credential is missing' },
    }, 401))))
    const ctx = new Context()
    ctx.provide('connection', {
      isLoopback: false,
      hostDescription: {
        getSnapshot: () => undefined,
        subscribe: () => () => {},
      },
    } as unknown as ConnectionHandle)
    const fiber = ctx.plugin(CompanionDeviceTrustService)

    try {
      await fiber.await()
      expect(ctx.companionDeviceTrust.getTrustState()).toBe('unpaired')
    } finally {
      await fiber.dispose()
      vi.unstubAllGlobals()
    }
  })
})
