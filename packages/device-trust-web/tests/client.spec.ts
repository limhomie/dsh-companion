import { describe, expect, it, vi } from 'vitest'
import {
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
