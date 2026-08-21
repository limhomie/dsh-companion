/**
 * Service Definition for paired-device trust. Providers own pairing state,
 * durable device access, credential verification, and revocation; Connection
 * consumers translate an authenticated principal into transport access.
 * @module @dsh-companion/device-trust
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-action-source'

/** Durable paired-device id. */
export type DeviceId = Branded<'device-id'>
/** Process-local pairing offer id. */
export type PairingOfferId = Branded<'pairing-offer-id'>
/** Process-local pairing claim id. */
export type PairingClaimId = Branded<'pairing-claim-id'>
/** Process-local native authentication challenge id. */
export type NativeChallengeId = Branded<'native-challenge-id'>

/**
 * Brand a durable device id after generation or wire validation.
 * @param value - validated device id.
 * @returns branded durable device id.
 */
export function DeviceId(value: string): DeviceId {
  return value as DeviceId
}

/**
 * Brand a pairing offer id after generation or wire validation.
 * @param value - validated offer id.
 * @returns branded process-local offer id.
 */
export function PairingOfferId(value: string): PairingOfferId {
  return value as PairingOfferId
}

/**
 * Brand a pairing claim id after generation or wire validation.
 * @param value - validated claim id.
 * @returns branded process-local claim id.
 */
export function PairingClaimId(value: string): PairingClaimId {
  return value as PairingClaimId
}

/**
 * Brand a native authentication challenge id after generation or wire validation.
 * @param value - validated process-local challenge id.
 * @returns branded challenge id.
 */
export function NativeChallengeId(value: string): NativeChallengeId {
  return value as NativeChallengeId
}

/**
 * Build the byte-exact message signed for native proof of possession.
 * @param deviceId - durable native device id.
 * @param challengeId - process-local challenge id.
 * @param challenge - random challenge value returned by the Host.
 * @returns domain-separated UTF-8 message.
 */
export function nativeChallengeMessage(
  deviceId: DeviceId,
  challengeId: NativeChallengeId,
  challenge: string,
): string {
  return `dsh-native-auth-v1\n${deviceId}\n${challengeId}\n${challenge}`
}

/** Complete remote authority granted to one paired device. */
export type DeviceAccess = 'viewer' | 'owner'

/** Stable failure vocabulary for pairing and device administration. */
export type DeviceTrustErrorCode =
  | 'offer-not-found'
  | 'offer-expired'
  | 'offer-capacity'
  | 'claim-not-found'
  | 'claim-expired'
  | 'claim-secret-invalid'
  | 'verification-code-invalid'
  | 'claim-not-pending'
  | 'native-key-invalid'
  | 'native-challenge-not-found'
  | 'native-challenge-expired'
  | 'native-signature-invalid'
  | 'device-not-found'
  | 'device-revoked'

/** Pairing or device-administration failure safe for transport mapping. */
export class DeviceTrustError extends Error {
  override readonly name = 'DeviceTrustError'

  /**
   * @param code - stable failure discriminant.
   * @param message - diagnostic without credential material.
   */
  constructor(readonly code: DeviceTrustErrorCode, message: string) {
    super(message)
  }
}

/** Authenticated paired-device principal safe to expose to authorization consumers. */
export interface DevicePrincipal {
  /** Stable durable device id. */
  readonly deviceId: DeviceId
  /** User-visible device label. */
  readonly label: string
  /** Current Host-owned remote access level. */
  readonly access: DeviceAccess
}

/** UI-safe durable device record; never includes a credential or its digest. */
export interface TrustedDevice extends DevicePrincipal {
  /** ISO timestamp at which pairing committed. */
  readonly createdAt: string
  /** ISO timestamp after which authentication fails. */
  readonly expiresAt: string
  /** ISO timestamp at which trust was revoked, when revoked. */
  readonly revokedAt?: string
}

/** Newly created process-local pairing offer. */
export interface PairingOffer {
  /** Opaque offer id safe to place in the pairing URL. */
  readonly offerId: PairingOfferId
  /** ISO timestamp after which claims fail. */
  readonly expiresAt: string
}

/** Claim data returned only to the claiming device. */
export interface PairingClaim {
  /** Opaque claim id. */
  readonly claimId: PairingClaimId
  /** Secret required to poll this claim; callers must not log or persist it. */
  readonly claimSecret: string
  /** Short code displayed on both devices before approval. */
  readonly verificationCode: string
  /** ISO timestamp after which the claim fails. */
  readonly expiresAt: string
}

/** Credential binding requested by a claiming client. */
export type DeviceCredentialBinding =
  | { readonly kind: 'browser-cookie' }
  | {
    readonly kind: 'native-p256'
    /** Base64url-encoded X.509 SubjectPublicKeyInfo for a P-256 Android Keystore key. */
    readonly publicKey: string
  }

/** UI-safe pending claim shown only to the local approving operator. */
export interface PendingPairingClaim {
  /** Parent offer. */
  readonly offerId: PairingOfferId
  /** Claim selected by the approval request. */
  readonly claimId: PairingClaimId
  /** Phone-supplied device label. */
  readonly label: string
  /** Code that must match the claiming device. */
  readonly verificationCode: string
  /** ISO timestamp after which approval fails. */
  readonly expiresAt: string
}

/** Result of polling a claim with its secret. */
export type PairingPoll =
  | { readonly status: 'pending' }
  | { readonly status: 'rejected' }
  | {
    readonly status: 'approved'
    /** Browser Cookie credential; absent for a key-bound native device. */
    readonly credential?: string
    readonly device: TrustedDevice
  }

/** One process-local challenge issued to a durable native device. */
export interface NativeDeviceChallenge {
  /** Opaque challenge id consumed exactly once. */
  readonly challengeId: NativeChallengeId
  /** Random base64url challenge signed by the device key. */
  readonly challenge: string
  /** ISO timestamp after which exchange fails. */
  readonly expiresAt: string
}

/** Short-lived native transport session held only in application memory. */
export interface NativeDeviceSession {
  /** Opaque bearer used only after key possession has been proven. */
  readonly credential: string
  /** ISO timestamp after which the session fails authentication. */
  readonly expiresAt: string
  /** Current authoritative device principal. */
  readonly device: DevicePrincipal
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    deviceTrust: DeviceTrustProvider
  }

  interface Events {
    /**
     * A durable device revocation committed.
     * @mode emit
     * @param deviceId - Revoked device whose active transports must close.
     */
    'device-trust/revoked'(deviceId: DeviceId): void

    /**
     * A durable device access replacement committed.
     * @mode emit
     * @param deviceId - Device whose active requests and downlinks must reauthorize.
     * @param access - Complete current access after the replacement.
     */
    'device-trust/access-updated'(deviceId: DeviceId, access: DeviceAccess): void
  }
}

declare module '@deepseek-ai/dsh-action-source' {
  interface ActionSourceMap {
    /** A person acting through one authenticated paired device. */
    'paired-device': { readonly kind: 'paired-device'; readonly deviceId: DeviceId }
  }
}

/** Paired-device trust provider. */
export abstract class DeviceTrustProvider extends Service {
  constructor(ctx: Context) {
    super(ctx, 'deviceTrust')
  }

  /**
   * Create one bounded process-local pairing offer.
   * @returns new offer safe to encode in a pairing URL.
   */
  abstract createOffer(): Promise<PairingOffer>

  /**
   * Claim one live offer from the device being paired.
   * @param offerId - scanned offer id.
   * @param label - bounded user-visible device label.
   * @param binding - browser bearer or native public-key credential binding.
   * @returns private claim data for the requesting device.
   */
  abstract claimOffer(
    offerId: PairingOfferId,
    label: string,
    binding?: DeviceCredentialBinding,
  ): Promise<PairingClaim>

  /**
   * Return UI-safe claims awaiting local approval.
   * @returns current pending claims without claim secrets.
   */
  abstract pendingClaims(): Promise<readonly PendingPairingClaim[]>

  /**
   * Approve one claim when the locally displayed code matches.
   * @param claimId - selected pending claim.
   * @param verificationCode - code confirmed by the operator.
   * @param access - explicit initial access level.
   */
  abstract approveClaim(
    claimId: PairingClaimId,
    verificationCode: string,
    access: DeviceAccess,
  ): Promise<void>

  /**
   * Poll one claim using the secret returned to its claimant.
   * @param claimId - claim to inspect.
   * @param claimSecret - secret proving ownership of the claim.
   * @returns current claim status and approved credential when available.
   */
  abstract pollClaim(claimId: PairingClaimId, claimSecret: string): Promise<PairingPoll>

  /**
   * Authenticate one raw transport credential against current durable access.
   * @param credential - provider-issued browser or short-lived native transport value.
   * @returns the current principal, or `undefined` when invalid, expired, or revoked.
   */
  abstract authenticate(credential: string): Promise<DevicePrincipal | undefined>

  /**
   * Issue a bounded, process-local proof-of-possession challenge for a native device.
   * @param deviceId - durable device whose registered public key will verify the response.
   * @returns challenge material safe to return to that unauthenticated caller.
   */
  abstract createNativeChallenge(deviceId: DeviceId): Promise<NativeDeviceChallenge>

  /**
   * Consume one challenge and create a short-lived native transport session.
   * @param deviceId - durable device named by the challenge.
   * @param challengeId - process-local challenge to consume.
   * @param signature - base64url DER ECDSA signature over the protocol challenge message.
   * @returns in-memory transport credential and current principal.
   */
  abstract exchangeNativeChallenge(
    deviceId: DeviceId,
    challengeId: NativeChallengeId,
    signature: string,
  ): Promise<NativeDeviceSession>

  /**
   * Return all durable paired-device records without credential material.
   * @returns current durable device records safe for local UI.
   */
  abstract listDevices(): Promise<readonly TrustedDevice[]>

  /**
   * Replace one live device's complete remote access level.
   * @param deviceId - device whose access changes.
   * @param access - complete replacement access level.
   */
  abstract updateAccess(deviceId: DeviceId, access: DeviceAccess): Promise<void>

  /**
   * Revoke a durable device; revoking an unknown id fails loud.
   * @param deviceId - device to revoke.
   */
  abstract revoke(deviceId: DeviceId): Promise<void>

  /** Emit revocation only after the durable record committed. */
  protected notifyRevoked(deviceId: DeviceId): void {
    this.ctx.emit('device-trust/revoked', deviceId)
  }

  /** Emit an access replacement only after the durable record committed. */
  protected notifyAccessUpdated(deviceId: DeviceId, access: DeviceAccess): void {
    this.ctx.emit('device-trust/access-updated', deviceId, access)
  }
}

export default DeviceTrustProvider
