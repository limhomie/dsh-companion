/**
 * Connection consumer for paired-device trust. Owns pairing HTTP routes,
 * the HttpOnly device Cookie, viewer/owner target authorization, and active
 * transport termination after durable access replacement or revocation.
 * @module @dsh-companion/device-trust-connection
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import {
  DeviceId,
  DeviceTrustError,
  NativeChallengeId,
  PairingClaimId,
  PairingOfferId,
  type DevicePrincipal,
} from '@dsh-companion/device-trust'
import {
  ConnectionPrincipalId,
  ApiPrincipalId,
  HOST_EVENTS_PATH,
  type ConnectionAccessGuard,
  type ConnectionAccessTarget,
  type ConnectionDownlinkFrame,
  type ConnectionRequestHeaders,
} from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  DEVICE_PAIRING_PATHS,
  approveRequestSchema,
  claimRequestSchema,
  emptyRequestSchema,
  pollRequestSchema,
  nativeChallengeRequestSchema,
  nativeExchangeRequestSchema,
  revokeRequestSchema,
  accessRequestSchema,
} from './protocol.ts'

export * from './protocol.ts'

/** Stable device credential Cookie name. `__Host-` forbids Domain and requires Secure + Path=/. */
export const DEVICE_COOKIE_NAME = '__Host-dsh-device'

/** Pairing route limits and externally reachable Host origin. */
export interface Config {
  /** HTTPS origin encoded in pairing URLs; absent disables offer creation. */
  publicOrigin?: string
  /** Maximum JSON body accepted by a pairing endpoint. */
  maxRequestBodyBytes: number
  /** Lifetime of a one-time native WebSocket ticket in milliseconds. */
  nativeWebSocketTicketTtlMs: number
  /** Maximum live one-time native WebSocket tickets. */
  maxPendingNativeWebSocketTickets: number
}
export const Config: s<Config> = s.object({
  publicOrigin: s.string(),
  maxRequestBodyBytes: s.natural().min(1).required(),
  nativeWebSocketTicketTtlMs: s.natural().min(1).required(),
  maxPendingNativeWebSocketTickets: s.natural().min(1).required(),
})

interface PairingRoute {
  readonly path: string
  readonly authority: 'loopback' | 'trusted-host'
  readonly schema: { safeParse(value: unknown): { success: true; data: Record<string, unknown> } | { success: false } }
  readonly invoke: (
    payload: Record<string, unknown>,
    response: ServerResponse,
    request: IncomingMessage,
  ) => Promise<unknown>
}

function header(headers: ConnectionRequestHeaders, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const direct = headers[name] ?? headers[name.toLowerCase()]
  return typeof direct === 'string' ? direct : undefined
}

function cookieCredential(headers: ConnectionRequestHeaders): string | undefined {
  const cookie = header(headers, 'cookie')
  if (cookie === undefined) return undefined
  for (const field of cookie.split(';')) {
    const separator = field.indexOf('=')
    if (separator === -1 || field.slice(0, separator).trim() !== DEVICE_COOKIE_NAME) continue
    const value = field.slice(separator + 1).trim()
    return value === '' ? undefined : value
  }
  return undefined
}

function nativeSessionCredential(headers: ConnectionRequestHeaders): string | undefined {
  const authorization = header(headers, 'authorization')
  const match = authorization?.match(/^DSH-Native ([A-Za-z0-9._~-]+)$/)
  return match?.[1]
}

function nativeWebSocketTicket(headers: ConnectionRequestHeaders): string | undefined {
  const protocols = header(headers, 'sec-websocket-protocol')
  if (protocols === undefined) return undefined
  for (const field of protocols.split(',')) {
    const value = field.trim()
    if (value.startsWith('dsh-ticket.')) return value.slice('dsh-ticket.'.length) || undefined
  }
  return undefined
}

function secretDigest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url')
}

function allowsTarget(principal: DevicePrincipal, target: ConnectionAccessTarget): boolean {
  if (target.remoteAccess === 'local-only') return false
  return principal.access === 'owner' || target.remoteAccess === 'viewer'
}

function sessionReadHostFrame(frame: ConnectionDownlinkFrame): boolean {
  return frame.payload.type !== 'host/remote-event'
}

function publicOrigin(value: string | undefined): URL | undefined {
  if (value === undefined) return undefined
  const parsed = new URL(value)
  if (parsed.origin !== value || parsed.protocol !== 'https:') {
    throw new Error('device-trust-connection publicOrigin must be one canonical HTTPS origin')
  }
  return parsed
}

async function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const mediaType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') throw new HttpError(415, 'content-type', 'content type must be application/json')
  const declared = request.headers['content-length']
  if (declared !== undefined && Number(declared) > maxBytes) {
    throw new HttpError(413, 'body-too-large', 'pairing request body is too large')
  }
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    bytes += buffer.byteLength
    if (bytes > maxBytes) throw new HttpError(413, 'body-too-large', 'pairing request body is too large')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new HttpError(400, 'invalid-json', 'pairing request body is not JSON')
  }
}
function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/* v8 ignore start -- closed-union backstop is unreachable without violating the TypeScript contract */
function assertNever(value: never): never {
  throw new TypeError(`unknown device trust error code: ${String(value)}`)
}
/* v8 ignore stop */

function deviceTrustStatus(error: DeviceTrustError): number {
  switch (error.code) {
    case 'offer-not-found':
    case 'claim-not-found':
    case 'device-not-found': return 404
    case 'offer-expired':
    case 'claim-expired': return 410
    case 'claim-secret-invalid': return 401
    case 'offer-capacity': return 429
    case 'verification-code-invalid':
    case 'claim-not-pending':
    case 'native-key-invalid':
    case 'native-signature-invalid':
    case 'device-revoked': return 409
    case 'native-challenge-not-found': return 404
    case 'native-challenge-expired': return 410
    /* v8 ignore next 2 -- DeviceTrustErrorCode is closed and every member is handled above */
    default: return assertNever(error.code)
  }
}

function pairingUrl(origin: URL, offerId: string): string {
  const url = new URL('/companion/', origin)
  url.searchParams.set('pair', offerId)
  return url.toString()
}

/** Services needed for transport guarding, pairing routes, and device state. */
export const inject = ['connection', 'deviceTrust', 'webServer']
/** Stable Cordis plugin name. */
export const name = 'device-trust-connection'

/** Register device authentication, pairing routes, and revocation handling. */
export function apply(ctx: Context, config: Config): void {
  const origin = publicOrigin(config.publicOrigin)
  if (origin !== undefined && !ctx.connection.allows({ host: origin.host }, 'trusted-host')) {
    throw new Error(`device-trust-connection publicOrigin authority "${origin.host}" is absent from Connection trustedHosts`)
  }

  const principalLifetimes = new Map<DeviceId, AbortController>()
  const webSocketTickets = new Map<string, { readonly credential: string; readonly expiresAtMs: number }>()
  const pruneWebSocketTickets = (now: number): void => {
    for (const [digest, ticket] of webSocketTickets) {
      if (ticket.expiresAtMs <= now) webSocketTickets.delete(digest)
    }
  }
  const lifetimeFor = (deviceId: DeviceId): AbortController => {
    let lifetime = principalLifetimes.get(deviceId)
    if (lifetime === undefined) {
      lifetime = new AbortController()
      principalLifetimes.set(deviceId, lifetime)
    }
    return lifetime
  }
  const expirePrincipal = (deviceId: DeviceId): void => {
    principalLifetimes.get(deviceId)?.abort()
    principalLifetimes.delete(deviceId)
    ctx.connection.access.disconnect(ConnectionPrincipalId(deviceId))
  }
  ctx.effect(() => () => {
    for (const lifetime of principalLifetimes.values()) lifetime.abort()
    principalLifetimes.clear()
    webSocketTickets.clear()
  }, `${name}: authenticated principal lifetimes`)

  const guard: ConnectionAccessGuard = {
    async authorize(headers, target) {
      let credential = cookieCredential(headers) ?? nativeSessionCredential(headers)
      if (credential === undefined && target.kind === 'websocket') {
        const ticketValue = nativeWebSocketTicket(headers)
        if (ticketValue !== undefined) {
          const now = Date.now()
          pruneWebSocketTickets(now)
          const digest = secretDigest(ticketValue)
          const ticket = webSocketTickets.get(digest)
          webSocketTickets.delete(digest)
          if (ticket !== undefined && ticket.expiresAtMs > now) credential = ticket.credential
        }
      }
      if (credential === undefined) return { allowed: false, status: 401 }
      const principal = await ctx.deviceTrust.authenticate(credential)
      if (principal === undefined) return { allowed: false, status: 401 }
      if (!allowsTarget(principal, target)) return { allowed: false, status: 403 }
      const lifetime = lifetimeFor(principal.deviceId)
      return {
        allowed: true,
        principalId: ConnectionPrincipalId(principal.deviceId),
        apiContext: {
          principalId: ApiPrincipalId(principal.deviceId),
          source: { kind: 'paired-device', deviceId: principal.deviceId },
          signal: lifetime.signal,
          allows: (capability) => {
            switch (capability) {
              case 'interaction:answer':
              case 'session:prompt':
              case 'session:prompt:unrestricted': return principal.access === 'owner'
              default: return false
            }
          },
        },
        ...(principal.access === 'viewer'
          && target.kind === 'websocket'
          && target.path === HOST_EVENTS_PATH
          ? { downlinkFilter: sessionReadHostFrame }
          : {}),
      }
    },
  }
  ctx.effect(() => ctx.connection.access.register(guard), `${name}: Connection access guard`)
  ctx.on('device-trust/revoked', (deviceId) => {
    expirePrincipal(deviceId)
  })
  ctx.on('device-trust/access-updated', (deviceId) => {
    expirePrincipal(deviceId)
  })

  const authenticateRequest = async (request: IncomingMessage): Promise<DevicePrincipal> => {
    const credential = cookieCredential(request.headers) ?? nativeSessionCredential(request.headers)
    if (credential === undefined) throw new HttpError(401, 'device-unauthorized', 'paired-device credential is missing')
    const principal = await ctx.deviceTrust.authenticate(credential)
    if (principal === undefined) throw new HttpError(401, 'device-unauthorized', 'paired-device credential is invalid')
    return principal
  }

  const routes: PairingRoute[] = [
    {
      path: DEVICE_PAIRING_PATHS.create, authority: 'loopback', schema: emptyRequestSchema,
      invoke: async () => {
        if (origin === undefined) throw new HttpError(409, 'pairing-unavailable', 'no public pairing origin is configured')
        const offer = await ctx.deviceTrust.createOffer()
        return { ...offer, pairingUrl: pairingUrl(origin, offer.offerId) }
      },
    },
    {
      path: DEVICE_PAIRING_PATHS.claim, authority: 'trusted-host', schema: claimRequestSchema,
      invoke: async payload => await ctx.deviceTrust.claimOffer(
        PairingOfferId(payload.offerId as string),
        payload.label as string,
        payload.binding as import('@dsh-companion/device-trust').DeviceCredentialBinding | undefined,
      ),
    },
    {
      path: DEVICE_PAIRING_PATHS.poll, authority: 'trusted-host', schema: pollRequestSchema,
      invoke: async (payload, response) => {
        const poll = await ctx.deviceTrust.pollClaim(
          PairingClaimId(payload.claimId as string),
          payload.claimSecret as string,
        )
        if (poll.status !== 'approved') return poll
        if (poll.credential !== undefined) {
          const maxAge = Math.max(0, Math.floor((Date.parse(poll.device.expiresAt) - Date.now()) / 1000))
          response.setHeader(
            'set-cookie',
            `${DEVICE_COOKIE_NAME}=${poll.credential}; Path=/; Max-Age=${String(maxAge)}; Secure; HttpOnly; SameSite=Strict`,
          )
        }
        return { status: poll.status, device: poll.device }
      },
    },
    {
      path: DEVICE_PAIRING_PATHS.pending, authority: 'loopback', schema: emptyRequestSchema,
      invoke: async () => ({ claims: await ctx.deviceTrust.pendingClaims() }),
    },
    {
      path: DEVICE_PAIRING_PATHS.approve, authority: 'loopback', schema: approveRequestSchema,
      invoke: async (payload) => {
        await ctx.deviceTrust.approveClaim(
          PairingClaimId(payload.claimId as string),
          payload.verificationCode as string,
          'viewer',
        )
        return { approved: true }
      },
    },
    {
      path: DEVICE_PAIRING_PATHS.devices, authority: 'loopback', schema: emptyRequestSchema,
      invoke: async () => ({ devices: await ctx.deviceTrust.listDevices() }),
    },
    {
      path: DEVICE_PAIRING_PATHS.current, authority: 'trusted-host', schema: emptyRequestSchema,
      invoke: async (_payload, _response, request) => ({ device: await authenticateRequest(request) }),
    },
    {
      path: DEVICE_PAIRING_PATHS.access, authority: 'loopback', schema: accessRequestSchema,
      invoke: async (payload) => {
        await ctx.deviceTrust.updateAccess(
          DeviceId(payload.deviceId as string),
          payload.access as import('@dsh-companion/device-trust').DeviceAccess,
        )
        return { updated: true }
      },
    },
    {
      path: DEVICE_PAIRING_PATHS.revoke, authority: 'loopback', schema: revokeRequestSchema,
      invoke: async (payload) => {
        await ctx.deviceTrust.revoke(DeviceId(payload.deviceId as string))
        return { revoked: true }
      },
    },
    {
      path: DEVICE_PAIRING_PATHS.nativeChallenge,
      authority: 'trusted-host',
      schema: nativeChallengeRequestSchema,
      invoke: async payload => await ctx.deviceTrust.createNativeChallenge(DeviceId(payload.deviceId as string)),
    },
    {
      path: DEVICE_PAIRING_PATHS.nativeExchange,
      authority: 'trusted-host',
      schema: nativeExchangeRequestSchema,
      invoke: async payload => await ctx.deviceTrust.exchangeNativeChallenge(
        DeviceId(payload.deviceId as string),
        NativeChallengeId(payload.challengeId as string),
        payload.signature as string,
      ),
    },
    {
      path: DEVICE_PAIRING_PATHS.nativeWebSocketTicket,
      authority: 'trusted-host',
      schema: emptyRequestSchema,
      invoke: async (_payload, _response, request) => {
        const credential = nativeSessionCredential(request.headers)
        if (credential === undefined || await ctx.deviceTrust.authenticate(credential) === undefined) {
          throw new HttpError(401, 'device-unauthorized', 'native device session is invalid')
        }
        const now = Date.now()
        pruneWebSocketTickets(now)
        if (webSocketTickets.size >= config.maxPendingNativeWebSocketTickets) {
          throw new HttpError(429, 'ticket-capacity', 'too many native WebSocket tickets are pending')
        }
        const ticket = randomBytes(32).toString('base64url')
        const expiresAtMs = now + config.nativeWebSocketTicketTtlMs
        webSocketTickets.set(secretDigest(ticket), { credential, expiresAtMs })
        return { ticket, expiresAt: new Date(expiresAtMs).toISOString() }
      },
    },
  ]

  for (const route of routes) {
    const webRoute: WebRoute = {
      kind: 'exact',
      path: route.path,
      handler: async (request, response) => {
        if (!ctx.connection.allows(request.headers, route.authority)) {
          response.writeHead(403)
          response.end('forbidden')
          return
        }
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'POST' })
          response.end()
          return
        }
        try {
          const parsed = route.schema.safeParse(await readJson(request, config.maxRequestBodyBytes))
          if (!parsed.success) throw new HttpError(400, 'invalid-request', 'pairing request fields are invalid')
          json(response, 200, await route.invoke(parsed.data, response, request))
        } catch (error) {
          if (error instanceof HttpError) {
            json(response, error.status, { error: { code: error.code, message: error.message } })
            return
          }
          if (error instanceof DeviceTrustError) {
            json(response, deviceTrustStatus(error), { error: { code: error.code, message: error.message } })
            return
          }
          throw error
        }
      },
    }
    ctx.effect(() => ctx.webServer.register(webRoute), `${name}: ${route.path}`)
  }
}
