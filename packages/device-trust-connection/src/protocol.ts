/**
 * Browser-safe HTTP protocol for paired-device enrollment and local device
 * administration. The Host and clients share these parsers at the network
 * boundary.
 * @module @dsh-companion/device-trust-connection/protocol
 */

import { z } from 'zod'

/** Exact same-origin endpoints owned by the device-trust Connection consumer. */
export const DEVICE_PAIRING_PATHS = {
  create: '/api/device-pairing.create',
  claim: '/api/device-pairing.claim',
  poll: '/api/device-pairing.poll',
  pending: '/api/device-pairing.pending',
  approve: '/api/device-pairing.approve',
  devices: '/api/device-pairing.devices',
  current: '/api/device-pairing.current',
  access: '/api/device-pairing.access',
  revoke: '/api/device-pairing.revoke',
  nativeChallenge: '/api/device-auth.challenge',
  nativeExchange: '/api/device-auth.exchange',
  nativeWebSocketTicket: '/api/device-auth.websocket-ticket',
} as const

/** Empty JSON request accepted by local administrative reads. */
export const emptyRequestSchema = z.object({}).strict()
/** Request from a phone claiming one scanned offer. */
export const claimRequestSchema = z.object({
  offerId: z.uuid(),
  label: z.string().trim().min(1).max(128),
  binding: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('browser-cookie') }).strict(),
    z.object({
      kind: z.literal('native-p256'),
      publicKey: z.string().min(64).max(1024),
    }).strict(),
  ]).optional(),
}).strict()
/** Secret-bearing request from the claiming page polling for approval. */
export const pollRequestSchema = z.object({
  claimId: z.uuid(),
  claimSecret: z.string().min(32).max(128),
}).strict()
/** Local confirmation of a pending phone claim. */
export const approveRequestSchema = z.object({
  claimId: z.uuid(),
  verificationCode: z.string().regex(/^\d{6}$/),
}).strict()
/** Local request to revoke one durable device. */
export const revokeRequestSchema = z.object({ deviceId: z.uuid() }).strict()
/** Paired-device access level accepted at the network boundary. */
export const deviceAccessSchema = z.union([z.literal('viewer'), z.literal('owner')])
/** Local replacement of one paired device's complete access level. */
export const accessRequestSchema = z.object({
  deviceId: z.uuid(),
  access: deviceAccessSchema,
}).strict()
/** Request for a proof-of-possession challenge. */
export const nativeChallengeRequestSchema = z.object({ deviceId: z.uuid() }).strict()
/** Signed challenge exchange from a native client. */
export const nativeExchangeRequestSchema = z.object({
  deviceId: z.uuid(),
  challengeId: z.uuid(),
  signature: z.string().min(64).max(256),
}).strict()

/** Credential-free paired-device record returned to trusted UI. */
export const trustedDeviceResponseSchema = z.object({
  deviceId: z.uuid(),
  label: z.string().min(1).max(128),
  access: deviceAccessSchema,
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  revokedAt: z.string().min(1).optional(),
}).strict()

/** Response to local pairing-offer creation. */
export const createResponseSchema = z.object({
  offerId: z.uuid(),
  expiresAt: z.string().min(1),
  pairingUrl: z.url(),
}).strict()
/** Claim material held only in the claiming page's memory. */
export const claimResponseSchema = z.object({
  claimId: z.uuid(),
  claimSecret: z.string().min(32).max(128),
  verificationCode: z.string().regex(/^\d{6}$/),
  expiresAt: z.string().min(1),
}).strict()
/** Approval state returned to the claiming page. */
export const pollResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }).strict(),
  z.object({ status: z.literal('rejected') }).strict(),
  z.object({
    status: z.literal('approved'),
    device: trustedDeviceResponseSchema,
  }).strict(),
])
/** Pending claims visible only to the local operator. */
export const pendingResponseSchema = z.object({
  claims: z.array(z.object({
    offerId: z.uuid(),
    claimId: z.uuid(),
    label: z.string().min(1).max(128),
    verificationCode: z.string().regex(/^\d{6}$/),
    expiresAt: z.string().min(1),
  }).strict()),
}).strict()
/** Successful local claim approval. */
export const approveResponseSchema = z.object({ approved: z.literal(true) }).strict()
/** Local durable-device listing. */
export const devicesResponseSchema = z.object({
  devices: z.array(trustedDeviceResponseSchema),
}).strict()
/** Authenticated device principal returned to its own page. */
export const currentDeviceResponseSchema = z.object({
  device: z.object({
    deviceId: z.uuid(),
    label: z.string().min(1).max(128),
    access: deviceAccessSchema,
  }).strict(),
}).strict()
/** Successful local access replacement. */
export const accessResponseSchema = z.object({ updated: z.literal(true) }).strict()
/** Successful local device revocation. */
export const revokeResponseSchema = z.object({ revoked: z.literal(true) }).strict()
/** Native proof-of-possession challenge response. */
export const nativeChallengeResponseSchema = z.object({
  challengeId: z.uuid(),
  challenge: z.string().min(32).max(128),
  expiresAt: z.string().min(1),
}).strict()
/** Short-lived native transport session response. */
export const nativeExchangeResponseSchema = z.object({
  credential: z.string().min(32).max(256),
  expiresAt: z.string().min(1),
  device: z.object({
    deviceId: z.uuid(),
    label: z.string().min(1).max(128),
    access: deviceAccessSchema,
  }).strict(),
}).strict()
/** One-time native WebSocket ticket response. */
export const nativeWebSocketTicketResponseSchema = z.object({
  ticket: z.string().min(32).max(128),
  expiresAt: z.string().min(1),
}).strict()
/** Stable error envelope returned by every pairing endpoint. */
export const devicePairingErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }).strict(),
}).strict()

/** Response from creating a pairing offer. */
export type CreatePairingResponse = z.infer<typeof createResponseSchema>
/** Response from claiming an offer. */
export type ClaimPairingResponse = z.infer<typeof claimResponseSchema>
/** Response while a claiming page waits for local approval. */
export type PollPairingResponse = z.infer<typeof pollResponseSchema>
/** Response containing pending claims. */
export type PendingPairingResponse = z.infer<typeof pendingResponseSchema>
/** Credential-free paired-device record. */
export type TrustedDeviceResponse = z.infer<typeof trustedDeviceResponseSchema>
/** Stable pairing endpoint error body. */
export type DevicePairingErrorResponse = z.infer<typeof devicePairingErrorSchema>
/** Native challenge response. */
export type NativeChallengeResponse = z.infer<typeof nativeChallengeResponseSchema>
/** Native session exchange response. */
export type NativeExchangeResponse = z.infer<typeof nativeExchangeResponseSchema>
/** Native WebSocket ticket response. */
export type NativeWebSocketTicketResponse = z.infer<typeof nativeWebSocketTicketResponseSchema>
