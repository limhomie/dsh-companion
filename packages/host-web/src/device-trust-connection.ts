import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'

export interface Config {
  publicOrigin?: string
  maxRequestBodyBytes: number
  nativeWebSocketTicketTtlMs: number
  maxPendingNativeWebSocketTickets: number
}

export const Config: s<Config> = s.object({
  publicOrigin: s.string(),
  maxRequestBodyBytes: s.natural().min(1).required(),
  nativeWebSocketTicketTtlMs: s.natural().min(1).required(),
  maxPendingNativeWebSocketTickets: s.natural().min(1).required(),
})

export const name = 'dsh-companion-device-trust-connection'
export const inject = ['companionCompatibility', 'connection', 'deviceTrust', 'webServer']

/** Import the capability-sensitive Consumer only after the compatibility barrier is live. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const consumer = await import('@dsh-companion/device-trust-connection/host')
  consumer.apply(ctx, config)
}
