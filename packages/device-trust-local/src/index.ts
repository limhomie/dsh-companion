/**
 * Local paired-device provider. Durable device access lives in one
 * storage-domain table; pairing offers and raw credentials remain bounded,
 * process-local state and disappear on restart.
 * @module @dsh-companion/device-trust-local
 */

import {
  createHash,
  createPublicKey,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
  verify,
} from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { z } from 'zod'
import {
  DeviceId,
  DeviceTrustError,
  DeviceTrustProvider,
  NativeChallengeId,
  PairingClaimId,
  PairingOfferId,
  nativeChallengeMessage,
  type DeviceCredentialBinding,
  type DevicePrincipal,
  type DeviceAccess,
  type NativeDeviceChallenge,
  type NativeDeviceSession,
  type PairingClaim,
  type PairingOffer,
  type PairingPoll,
  type PendingPairingClaim,
  type TrustedDevice,
} from '@dsh-companion/device-trust'
import {
  defineDomain,
  domainTable,
  type Domain,
  type KvTable,
} from '@deepseek-ai/dsh-storage-domain'

/** Provider limits and credential lifetime. */
export interface Config {
  /** Pairing offer and claim lifetime in milliseconds. */
  offerTtlMs: number
  /** Approved device credential lifetime in milliseconds. */
  credentialTtlMs: number
  /** Maximum simultaneously live offers. */
  maxPendingOffers: number
  /** Maximum phone claims retained under one offer. */
  maxClaimsPerOffer: number
  /** Native proof-of-possession challenge lifetime in milliseconds. */
  nativeChallengeTtlMs: number
  /** Native in-memory transport session lifetime in milliseconds. */
  nativeSessionTtlMs: number
  /** Maximum live native challenges across all devices. */
  maxPendingNativeChallenges: number
}

const deviceRecordSchema = z.object({
  label: z.string().min(1).max(128),
  access: z.union([z.literal('viewer'), z.literal('owner')]),
  credential: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('browser-cookie'), digest: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('native-p256'), publicKey: z.string().min(1) }).strict(),
  ]),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  revokedAt: z.string().min(1).optional(),
})

type DeviceRecord = z.infer<typeof deviceRecordSchema>

const deviceTrustDomainSpec = defineDomain({
  name: 'device_trust',
  version: 3,
  tables: {
    devices: domainTable<DeviceId, DeviceRecord>(deviceRecordSchema),
  },
})

interface ClaimState {
  readonly claimId: PairingClaimId
  readonly label: string
  readonly secretDigest: Buffer
  readonly verificationCode: string
  readonly expiresAtMs: number
  readonly binding: DeviceCredentialBinding
  status: 'pending' | 'rejected' | 'approved'
  credential?: string
  device?: TrustedDevice
}

interface NativeChallengeState {
  readonly deviceId: DeviceId
  readonly challenge: string
  readonly expiresAtMs: number
}

interface NativeSessionState {
  readonly deviceId: DeviceId
  readonly expiresAtMs: number
}

interface OfferState {
  readonly offerId: PairingOfferId
  readonly expiresAtMs: number
  readonly claims: Map<PairingClaimId, ClaimState>
  consumed: boolean
}

/** Convert one durable record into the credential-free public view. */
function trustedDevice(deviceId: DeviceId, record: DeviceRecord): TrustedDevice {
  return {
    deviceId,
    label: record.label,
    access: record.access,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    ...(record.revokedAt === undefined ? {} : { revokedAt: record.revokedAt }),
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

function matchesDigest(value: string, expected: Buffer): boolean {
  const actual = digest(value)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function randomSecret(): string {
  return randomBytes(32).toString('base64url')
}

function verificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function validateNativePublicKey(encoded: string): void {
  try {
    const key = createPublicKey({ key: Buffer.from(encoded, 'base64url'), format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('unexpected key type')
    }
  } catch {
    throw new DeviceTrustError('native-key-invalid', 'native public key must be a P-256 SPKI key')
  }
}

/** Storage-domain-backed paired-device provider. */
export class LocalDeviceTrustProvider extends DeviceTrustProvider {
  static inject = ['storageDomain']

  static Config: s<Config> = s.object({
    offerTtlMs: s.natural().min(1).required(),
    credentialTtlMs: s.natural().min(1).required(),
    maxPendingOffers: s.natural().min(1).required(),
    maxClaimsPerOffer: s.natural().min(1).required(),
    nativeChallengeTtlMs: s.natural().min(1).required(),
    nativeSessionTtlMs: s.natural().min(1).required(),
    maxPendingNativeChallenges: s.natural().min(1).required(),
  })

  private domain: Domain<typeof deviceTrustDomainSpec> | undefined
  private devices: KvTable<DeviceId, DeviceRecord> | undefined
  private readonly offers = new Map<PairingOfferId, OfferState>()
  private readonly nativeChallenges = new Map<NativeChallengeId, NativeChallengeState>()
  private readonly nativeSessions = new Map<string, NativeSessionState>()
  private operationTail: Promise<void> = Promise.resolve()
  private closed = false

  constructor(ctx: Context, readonly config: Config) {
    super(ctx)
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void>, void, void> {
    this.domain = await this.ctx.storageDomain.open(deviceTrustDomainSpec)
    this.devices = this.domain.table('devices')
    yield async () => {
      this.closed = true
      await this.operationTail
      this.offers.clear()
      this.nativeChallenges.clear()
      this.nativeSessions.clear()
      await this.domain?.close()
    }
  }

  override createOffer(): Promise<PairingOffer> {
    return this.enqueue(() => {
      const now = Date.now()
      this.prune(now)
      if (this.offers.size >= this.config.maxPendingOffers) {
        throw new DeviceTrustError('offer-capacity', 'too many pairing offers are already pending')
      }
      const offerId = PairingOfferId(randomUUID())
      const expiresAtMs = now + this.config.offerTtlMs
      this.offers.set(offerId, { offerId, expiresAtMs, claims: new Map(), consumed: false })
      return Promise.resolve({ offerId, expiresAt: new Date(expiresAtMs).toISOString() })
    })
  }

  override claimOffer(
    offerId: PairingOfferId,
    label: string,
    binding: DeviceCredentialBinding = { kind: 'browser-cookie' },
  ): Promise<PairingClaim> {
    return this.enqueue(() => {
      const now = Date.now()
      const offer = this.requireOffer(offerId, now)
      if (offer.consumed) {
        throw new DeviceTrustError('offer-not-found', 'pairing offer is no longer available')
      }
      if (offer.claims.size >= this.config.maxClaimsPerOffer) {
        throw new DeviceTrustError('offer-capacity', 'pairing offer has reached its claim limit')
      }
      if (binding.kind === 'native-p256') validateNativePublicKey(binding.publicKey)
      const claimId = PairingClaimId(randomUUID())
      const claimSecret = randomSecret()
      const code = verificationCode()
      offer.claims.set(claimId, {
        claimId,
        label,
        secretDigest: digest(claimSecret),
        verificationCode: code,
        expiresAtMs: offer.expiresAtMs,
        binding,
        status: 'pending',
      })
      return Promise.resolve({
        claimId,
        claimSecret,
        verificationCode: code,
        expiresAt: new Date(offer.expiresAtMs).toISOString(),
      })
    })
  }

  override pendingClaims(): Promise<readonly PendingPairingClaim[]> {
    return this.enqueue(() => {
      const now = Date.now()
      this.prune(now)
      const pending: PendingPairingClaim[] = []
      for (const offer of this.offers.values()) {
        if (offer.consumed) continue
        for (const claim of offer.claims.values()) {
          if (claim.status !== 'pending') continue
          pending.push({
            offerId: offer.offerId,
            claimId: claim.claimId,
            label: claim.label,
            verificationCode: claim.verificationCode,
            expiresAt: new Date(claim.expiresAtMs).toISOString(),
          })
        }
      }
      return Promise.resolve(pending)
    })
  }

  override approveClaim(
    claimId: PairingClaimId,
    verificationCode: string,
    access: DeviceAccess,
  ): Promise<void> {
    return this.enqueue(async () => {
      const now = Date.now()
      const { offer, claim } = this.requireClaim(claimId, now)
      if (offer.consumed || claim.status !== 'pending') {
        throw new DeviceTrustError('claim-not-pending', 'pairing claim is no longer pending')
      }
      if (claim.verificationCode !== verificationCode) {
        throw new DeviceTrustError('verification-code-invalid', 'pairing verification code does not match')
      }
      const deviceId = DeviceId(randomUUID())
      const credential = claim.binding.kind === 'browser-cookie'
        ? `${deviceId}.${randomSecret()}`
        : undefined
      const createdAt = new Date(now).toISOString()
      const expiresAt = new Date(now + this.config.credentialTtlMs).toISOString()
      const record: DeviceRecord = {
        label: claim.label,
        access,
        credential: claim.binding.kind === 'browser-cookie'
          ? { kind: 'browser-cookie', digest: digest(credential as string).toString('base64url') }
          : { kind: 'native-p256', publicKey: claim.binding.publicKey },
        createdAt,
        expiresAt,
      }
      await this.requireDevices().put(deviceId, record)
      offer.consumed = true
      for (const candidate of offer.claims.values()) {
        if (candidate !== claim && candidate.status === 'pending') candidate.status = 'rejected'
      }
      claim.status = 'approved'
      if (credential !== undefined) claim.credential = credential
      claim.device = trustedDevice(deviceId, record)
    })
  }

  override pollClaim(claimId: PairingClaimId, claimSecret: string): Promise<PairingPoll> {
    return this.enqueue<PairingPoll>(() => {
      const now = Date.now()
      const { claim } = this.requireClaim(claimId, now)
      if (!matchesDigest(claimSecret, claim.secretDigest)) {
        throw new DeviceTrustError('claim-secret-invalid', 'pairing claim secret does not match')
      }
      if (claim.status === 'pending') return { status: 'pending' }
      if (claim.status === 'rejected') return { status: 'rejected' }
      if (claim.device === undefined) throw new Error(`approved pairing claim "${claimId}" has no device result`)
      return {
        status: 'approved',
        ...(claim.credential === undefined ? {} : { credential: claim.credential }),
        device: claim.device,
      }
    })
  }

  override authenticate(credential: string): Promise<DevicePrincipal | undefined> {
    const separator = credential.indexOf('.')
    if (separator <= 0) return Promise.resolve(undefined)
    const deviceId = DeviceId(credential.slice(0, separator))
    const record = this.requireDevices().get(deviceId)
    if (record === undefined || record.revokedAt !== undefined || Date.parse(record.expiresAt) <= Date.now()) {
      return Promise.resolve(undefined)
    }
    if (record.credential.kind === 'browser-cookie') {
      const expected = Buffer.from(record.credential.digest, 'base64url')
      if (!matchesDigest(credential, expected)) return Promise.resolve(undefined)
    } else {
      this.pruneNativeState(Date.now())
      const session = this.nativeSessions.get(digest(credential).toString('base64url'))
      if (session === undefined || session.deviceId !== deviceId) return Promise.resolve(undefined)
    }
    return Promise.resolve({ deviceId, label: record.label, access: record.access })
  }

  override createNativeChallenge(deviceId: DeviceId): Promise<NativeDeviceChallenge> {
    return this.enqueue(() => {
      const now = Date.now()
      this.pruneNativeState(now)
      const record = this.requireLiveDevice(deviceId, now)
      if (record.credential.kind !== 'native-p256') {
        throw new DeviceTrustError('native-key-invalid', 'paired device has no native public key')
      }
      if (this.nativeChallenges.size >= this.config.maxPendingNativeChallenges) {
        throw new DeviceTrustError('offer-capacity', 'too many native authentication challenges are pending')
      }
      const challengeId = NativeChallengeId(randomUUID())
      const challenge = randomSecret()
      const expiresAtMs = now + this.config.nativeChallengeTtlMs
      this.nativeChallenges.set(challengeId, { deviceId, challenge, expiresAtMs })
      return Promise.resolve({
        challengeId,
        challenge,
        expiresAt: new Date(expiresAtMs).toISOString(),
      })
    })
  }

  override exchangeNativeChallenge(
    deviceId: DeviceId,
    challengeId: NativeChallengeId,
    signature: string,
  ): Promise<NativeDeviceSession> {
    return this.enqueue(() => {
      const now = Date.now()
      const challenge = this.nativeChallenges.get(challengeId)
      if (challenge === undefined || challenge.deviceId !== deviceId) {
        throw new DeviceTrustError('native-challenge-not-found', 'native authentication challenge does not exist')
      }
      this.nativeChallenges.delete(challengeId)
      if (challenge.expiresAtMs <= now) {
        throw new DeviceTrustError('native-challenge-expired', 'native authentication challenge expired')
      }
      const record = this.requireLiveDevice(deviceId, now)
      if (record.credential.kind !== 'native-p256') {
        throw new DeviceTrustError('native-key-invalid', 'paired device has no native public key')
      }
      let valid = false
      try {
        valid = verify(
          'sha256',
          Buffer.from(nativeChallengeMessage(deviceId, challengeId, challenge.challenge), 'utf8'),
          createPublicKey({
            key: Buffer.from(record.credential.publicKey, 'base64url'),
            format: 'der',
            type: 'spki',
          }),
          Buffer.from(signature, 'base64url'),
        )
      } catch {
        valid = false
      }
      if (!valid) {
        throw new DeviceTrustError('native-signature-invalid', 'native authentication signature is invalid')
      }
      const credential = `${deviceId}.${randomSecret()}`
      const expiresAtMs = now + this.config.nativeSessionTtlMs
      this.nativeSessions.set(digest(credential).toString('base64url'), { deviceId, expiresAtMs })
      return Promise.resolve({
        credential,
        expiresAt: new Date(expiresAtMs).toISOString(),
        device: { deviceId, label: record.label, access: record.access },
      })
    })
  }

  override listDevices(): Promise<readonly TrustedDevice[]> {
    return Promise.resolve([...this.requireDevices().entries()]
      .map(([deviceId, record]) => trustedDevice(deviceId, record))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)))
  }

  override updateAccess(deviceId: DeviceId, access: DeviceAccess): Promise<void> {
    return this.enqueue(async () => {
      const record = this.requireDevices().get(deviceId)
      if (record === undefined) {
        throw new DeviceTrustError('device-not-found', `paired device "${deviceId}" does not exist`)
      }
      if (record.revokedAt !== undefined) {
        throw new DeviceTrustError('device-revoked', `paired device "${deviceId}" is revoked`)
      }
      await this.requireDevices().put(deviceId, { ...record, access })
      this.notifyAccessUpdated(deviceId, access)
    })
  }

  override revoke(deviceId: DeviceId): Promise<void> {
    return this.enqueue(async () => {
      const record = this.requireDevices().get(deviceId)
      if (record === undefined) {
        throw new DeviceTrustError('device-not-found', `paired device "${deviceId}" does not exist`)
      }
      if (record.revokedAt !== undefined) {
        throw new DeviceTrustError('device-revoked', `paired device "${deviceId}" is already revoked`)
      }
      await this.requireDevices().put(deviceId, { ...record, revokedAt: new Date().toISOString() })
      this.notifyRevoked(deviceId)
    })
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('device-trust-local is disposed'))
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }

  private prune(now: number): void {
    for (const [offerId, offer] of this.offers) {
      if (offer.expiresAtMs <= now) this.offers.delete(offerId)
    }
  }

  private pruneNativeState(now: number): void {
    for (const [challengeId, challenge] of this.nativeChallenges) {
      if (challenge.expiresAtMs <= now) this.nativeChallenges.delete(challengeId)
    }
    for (const [credentialDigest, session] of this.nativeSessions) {
      if (session.expiresAtMs <= now) this.nativeSessions.delete(credentialDigest)
    }
  }

  private requireLiveDevice(deviceId: DeviceId, now: number): DeviceRecord {
    const record = this.requireDevices().get(deviceId)
    if (record === undefined) throw new DeviceTrustError('device-not-found', `paired device "${deviceId}" does not exist`)
    if (record.revokedAt !== undefined) throw new DeviceTrustError('device-revoked', `paired device "${deviceId}" is revoked`)
    if (Date.parse(record.expiresAt) <= now) throw new DeviceTrustError('device-revoked', `paired device "${deviceId}" expired`)
    return record
  }

  private requireOffer(offerId: PairingOfferId, now: number): OfferState {
    const offer = this.offers.get(offerId)
    if (offer === undefined) throw new DeviceTrustError('offer-not-found', 'pairing offer does not exist')
    if (offer.expiresAtMs <= now) {
      this.offers.delete(offerId)
      throw new DeviceTrustError('offer-expired', 'pairing offer has expired')
    }
    return offer
  }

  private requireClaim(claimId: PairingClaimId, now: number): { offer: OfferState; claim: ClaimState } {
    for (const offer of this.offers.values()) {
      const claim = offer.claims.get(claimId)
      if (claim === undefined) continue
      if (claim.expiresAtMs <= now) {
        throw new DeviceTrustError('claim-expired', 'pairing claim has expired')
      }
      return { offer, claim }
    }
    throw new DeviceTrustError('claim-not-found', 'pairing claim does not exist')
  }

  private requireDevices(): KvTable<DeviceId, DeviceRecord> {
    if (this.devices === undefined) throw new Error('device-trust-local is not initialized')
    return this.devices
  }
}

export default LocalDeviceTrustProvider
