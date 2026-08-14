import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import ConnectionService, { type ConnectionProvider } from '../src/index.ts'

function provider(): ConnectionProvider {
  return {
    getStatus: () => ({ phase: 'offline' }),
    subscribeStatus: () => () => undefined,
    subscribeFrames: () => () => undefined,
    start: async () => undefined,
    reconnect: () => undefined,
    resolveInteraction: vi.fn(),
    dispose: async () => undefined,
  }
}

describe('Connection Service provider lifecycle', () => {
  it('removes a provider when its registration is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(ConnectionService).await()
    const dispose = ctx.companionConnection.registerProvider(provider())

    expect(ctx.companionConnection.getStatus()).toEqual({ phase: 'offline' })
    dispose()

    expect(() => ctx.companionConnection.getStatus()).toThrowError(/no Companion Connection Provider/)
  })

  it('rejects a second active provider', async () => {
    const ctx = new Context()
    await ctx.plugin(ConnectionService).await()
    ctx.companionConnection.registerProvider(provider())

    expect(() => ctx.companionConnection.registerProvider(provider())).toThrowError(/already registered/)
  })
})
