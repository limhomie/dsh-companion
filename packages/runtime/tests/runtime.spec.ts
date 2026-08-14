import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import ConnectionService, { interactionId } from '@dsh-companion/connection'
import * as FixtureConnection from '@dsh-companion/connection-fixture'
import CompanionRuntimeService from '../src/index.ts'

async function boot() {
  const ctx = new Context()
  const connection = ctx.plugin(ConnectionService)
  await connection.await()
  const fixture = ctx.plugin(FixtureConnection, {
    initialConnectDelayMs: 0,
    resolveDelayMs: 1,
    reconnectDelayMs: 1,
    resyncDelayMs: 1,
  })
  await fixture.await()
  const runtime = ctx.plugin(CompanionRuntimeService)
  await runtime.await()
  return { ctx, fibers: [connection, fixture, runtime] }
}

async function dispose(fibers: Awaited<ReturnType<typeof boot>>['fibers']): Promise<void> {
  for (const fiber of fibers.reverse()) await fiber.dispose()
}

describe('Companion Runtime', () => {
  it('derives the attention inbox from one Host baseline', async () => {
    const { ctx, fibers } = await boot()

    expect(ctx.companionRuntime.getSnapshot().phase).toBe('connected')
    expect(ctx.companionRuntime.getSnapshot().attention.map(item => item.kind)).toEqual([
      'question', 'approval', 'completed', 'failed',
    ])

    await dispose(fibers)
  })

  it('keeps an interaction pending until the authoritative resolved frame arrives', async () => {
    const { ctx, fibers } = await boot()
    const id = interactionId('interaction-test-scope')
    const resolving = ctx.companionRuntime.resolveInteraction(id, '核心流程与手机视口')
    const duplicate = ctx.companionRuntime.resolveInteraction(id, '核心流程与手机视口')

    expect(duplicate).toBe(resolving)
    expect(ctx.companionRuntime.getSnapshot().operations[id]?.kind).toBe('submitting')
    expect(ctx.companionRuntime.getInteraction(id)?.status).toBe('pending')

    await resolving

    expect(ctx.companionRuntime.getSnapshot().operations[id]).toBeUndefined()
    expect(ctx.companionRuntime.getInteraction(id)).toMatchObject({
      status: 'resolved',
      resolution: '核心流程与手机视口',
    })
    expect(ctx.companionRuntime.getSnapshot().attention.some(item => item.interactionId === id)).toBe(false)

    await dispose(fibers)
  })

  it('disables mutations while a reconnect is converging', async () => {
    const { ctx, fibers } = await boot()
    ctx.companionRuntime.reconnect()

    expect(ctx.companionRuntime.getSnapshot().phase).toBe('reconnecting')
    await expect(ctx.companionRuntime.resolveInteraction(
      interactionId('interaction-test-scope'),
      '同时覆盖断线恢复',
    )).rejects.toMatchObject({ code: 'NOT_CONNECTED' })

    await new Promise(resolve => setTimeout(resolve, 8))
    expect(ctx.companionRuntime.getSnapshot().phase).toBe('connected')

    await dispose(fibers)
  })
})
