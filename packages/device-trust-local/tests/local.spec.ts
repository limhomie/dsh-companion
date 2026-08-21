import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { generateKeyPairSync, sign } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import {
  nativeChallengeMessage,
  type DeviceId,
} from '@dsh-companion/device-trust'
import LocalDeviceTrustProvider, { type Config } from '../src/index.ts'

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-companion-device-trust-'))
  roots.push(root)
  return root
}

const CONFIG: Config = {
  offerTtlMs: 60_000,
  credentialTtlMs: 3_600_000,
  maxPendingOffers: 2,
  maxClaimsPerOffer: 2,
  nativeChallengeTtlMs: 120_000,
  nativeSessionTtlMs: 900_000,
  maxPendingNativeChallenges: 4,
}

async function harness(root: string): Promise<{
  ctx: Context
  provider: LocalDeviceTrustProvider
  close(): Promise<void>
}> {
  const ctx = new Context()
  const fibers = [
    ctx.plugin(Storage),
    ctx.plugin(JsonStorage, { root }),
    ctx.plugin(StorageDomain, { backend: 'json' }),
    ctx.plugin(LocalDeviceTrustProvider, CONFIG),
  ]
  for (const fiber of fibers) await fiber.await()
  return {
    ctx,
    provider: ctx.deviceTrust as LocalDeviceTrustProvider,
    close: async () => {
      for (const fiber of fibers.reverse()) await fiber.dispose()
    },
  }
}

afterEach(async () => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
describe('local device trust provider', () => {
  it('pairs, authenticates, lists, and revokes one device', async () => {
    const host = await harness(await temporaryRoot())
    try {
      const offer = await host.provider.createOffer()
      const claim = await host.provider.claimOffer(offer.offerId, 'Alice Phone')
      await expect(host.provider.approveClaim(claim.claimId, '000000', 'viewer'))
        .rejects.toMatchObject({ code: 'verification-code-invalid' })
      expect(await host.provider.pendingClaims()).toEqual([{
        offerId: offer.offerId,
        claimId: claim.claimId,
        label: 'Alice Phone',
        verificationCode: claim.verificationCode,
        expiresAt: claim.expiresAt,
      }])

      await host.provider.approveClaim(claim.claimId, claim.verificationCode, 'viewer')
      await expect(host.provider.pollClaim(claim.claimId, 'not-the-claim-secret'))
        .rejects.toMatchObject({ code: 'claim-secret-invalid' })
      const poll = await host.provider.pollClaim(claim.claimId, claim.claimSecret)
      expect(poll.status).toBe('approved')
      if (poll.status !== 'approved') throw new Error('approved poll expected')
      if (poll.credential === undefined) throw new Error('browser credential expected')
      expect(await host.provider.authenticate(poll.credential)).toEqual({
        deviceId: poll.device.deviceId,
        label: 'Alice Phone',
        access: 'viewer',
      })
      expect(await host.provider.listDevices()).toEqual([poll.device])

      const updates: Array<{ deviceId: DeviceId; access: string }> = []
      host.ctx.on('device-trust/access-updated', (deviceId, access) => { updates.push({ deviceId, access }) })
      await host.provider.updateAccess(poll.device.deviceId, 'owner')
      expect(updates).toEqual([{
        deviceId: poll.device.deviceId,
        access: 'owner',
      }])
      expect(await host.provider.authenticate(poll.credential)).toMatchObject({
        access: 'owner',
      })

      const revoked: DeviceId[] = []
      host.ctx.on('device-trust/revoked', (deviceId) => { revoked.push(deviceId) })
      await host.provider.revoke(poll.device.deviceId)
      expect(revoked).toEqual([poll.device.deviceId])
      expect(await host.provider.authenticate(poll.credential)).toBeUndefined()
      expect((await host.provider.listDevices())[0]?.revokedAt).toBeDefined()
      await expect(host.provider.revoke(poll.device.deviceId))
        .rejects.toMatchObject({ code: 'device-revoked' })
      await expect(host.provider.updateAccess(poll.device.deviceId, 'viewer'))
        .rejects.toMatchObject({ code: 'device-revoked' })
    } finally {
      await host.close()
    }
  })

  it('persists only a digest and reauthenticates after reopening', async () => {
    const root = await temporaryRoot()
    const first = await harness(root)
    const offer = await first.provider.createOffer()
    const claim = await first.provider.claimOffer(offer.offerId, 'Persistent Phone')
    await first.provider.approveClaim(claim.claimId, claim.verificationCode, 'viewer')
    const poll = await first.provider.pollClaim(claim.claimId, claim.claimSecret)
    if (poll.status !== 'approved') throw new Error('approved poll expected')
    if (poll.credential === undefined) throw new Error('browser credential expected')
    await first.close()

    const stored = await readFile(join(root, 'device_trust.json'), 'utf8')
    expect(stored).not.toContain(poll.credential)
    expect(stored).not.toContain(claim.claimSecret)

    const second = await harness(root)
    try {
      expect(await second.provider.authenticate(poll.credential)).toMatchObject({
        deviceId: poll.device.deviceId,
        label: 'Persistent Phone',
      })
      await expect(second.provider.pollClaim(claim.claimId, claim.claimSecret))
        .rejects.toMatchObject({ code: 'claim-not-found' })
    } finally {
      await second.close()
    }
  })

  it('binds a native device to P-256 proof and issues only short-lived sessions', async () => {
    const host = await harness(await temporaryRoot())
    try {
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      const encodedPublicKey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
      const offer = await host.provider.createOffer()
      const claim = await host.provider.claimOffer(offer.offerId, 'Native Phone', {
        kind: 'native-p256',
        publicKey: encodedPublicKey,
      })
      await host.provider.approveClaim(claim.claimId, claim.verificationCode, 'viewer')
      const poll = await host.provider.pollClaim(claim.claimId, claim.claimSecret)
      if (poll.status !== 'approved') throw new Error('approved poll expected')
      expect(poll.credential).toBeUndefined()

      const challenge = await host.provider.createNativeChallenge(poll.device.deviceId)
      const message = nativeChallengeMessage(
        poll.device.deviceId,
        challenge.challengeId,
        challenge.challenge,
      )
      const signature = sign('sha256', Buffer.from(message, 'utf8'), privateKey).toString('base64url')
      const session = await host.provider.exchangeNativeChallenge(
        poll.device.deviceId,
        challenge.challengeId,
        signature,
      )
      expect(session.device).toEqual({
        deviceId: poll.device.deviceId,
        label: 'Native Phone',
        access: 'viewer',
      })
      expect(await host.provider.authenticate(session.credential)).toEqual(session.device)
      await expect(host.provider.exchangeNativeChallenge(
        poll.device.deviceId,
        challenge.challengeId,
        signature,
      )).rejects.toMatchObject({ code: 'native-challenge-not-found' })
    } finally {
      await host.close()
    }
  })

  it('rejects prerelease scope records instead of guessing an access level', async () => {
    const root = await temporaryRoot()
    await writeFile(join(root, 'device_trust.json'), `${JSON.stringify({
      unit: { name: 'device_trust', version: 1 },
      global: null,
      tables: { devices: {} },
    }, null, 2)}\n`)
    const ctx = new Context()
    const fibers = [
      ctx.plugin(Storage),
      ctx.plugin(JsonStorage, { root }),
      ctx.plugin(StorageDomain, { backend: 'json' }),
    ]
    for (const fiber of fibers) await fiber.await()
    const providerFiber = ctx.plugin(LocalDeviceTrustProvider, CONFIG)
    try {
      await expect(providerFiber).rejects.toMatchObject({ code: 'version-mismatch' })
    } finally {
      await providerFiber.dispose()
      for (const fiber of fibers.reverse()) await fiber.dispose()
    }
  })

  it('bounds offers and claims before creating more state', async () => {
    const host = await harness(await temporaryRoot())
    try {
      const first = await host.provider.createOffer()
      await host.provider.createOffer()
      await expect(host.provider.createOffer()).rejects.toMatchObject({ code: 'offer-capacity' })
      const accepted = await host.provider.claimOffer(first.offerId, 'Phone One')
      await host.provider.claimOffer(first.offerId, 'Phone Two')
      await expect(host.provider.claimOffer(first.offerId, 'Phone Three'))
        .rejects.toMatchObject({ code: 'offer-capacity' })
      await host.provider.approveClaim(accepted.claimId, accepted.verificationCode, 'viewer')
      await expect(host.provider.createOffer()).rejects.toMatchObject({ code: 'offer-capacity' })
    } finally {
      await host.close()
    }
  })

  it('expires offers and credentials while consuming one offer exactly once', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2029-01-01T00:00:00.000Z'))
    const host = await harness(await temporaryRoot())
    try {
      const expired = await host.provider.createOffer()
      vi.advanceTimersByTime(CONFIG.offerTtlMs)
      await expect(host.provider.claimOffer(expired.offerId, 'Late Phone'))
        .rejects.toMatchObject({ code: 'offer-expired' })

      const offer = await host.provider.createOffer()
      const accepted = await host.provider.claimOffer(offer.offerId, 'Accepted Phone')
      const rejected = await host.provider.claimOffer(offer.offerId, 'Other Phone')
      await host.provider.approveClaim(accepted.claimId, accepted.verificationCode, 'viewer')
      await expect(host.provider.claimOffer(offer.offerId, 'Reused Phone'))
        .rejects.toMatchObject({ code: 'offer-not-found' })
      await expect(host.provider.pollClaim(rejected.claimId, rejected.claimSecret))
        .resolves.toEqual({ status: 'rejected' })

      const poll = await host.provider.pollClaim(accepted.claimId, accepted.claimSecret)
      if (poll.status !== 'approved') throw new Error('approved poll expected')
      if (poll.credential === undefined) throw new Error('browser credential expected')
      expect(await host.provider.authenticate(poll.credential)).toBeDefined()
      vi.advanceTimersByTime(CONFIG.credentialTtlMs)
      expect(await host.provider.authenticate(poll.credential)).toBeUndefined()
    } finally {
      await host.close()
    }
  })
})
