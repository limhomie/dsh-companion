import { Context } from '@deepseek-ai/cordis'
import { Inbox } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import UiRegistryService from '../src/index.tsx'

const route = {
  id: 'test-inbox',
  path: '/test-inbox',
  label: '测试收件箱',
  order: 10,
  icon: Inbox,
  match: (path: string) => path === '/test-inbox',
  component: () => null,
}

describe('UI route lifecycle', () => {
  it('removes a route when its contributing plugin unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(UiRegistryService).await()
    const contributor = ctx.plugin({
      inject: ['companionUi'],
      apply(pluginContext: Context) {
        pluginContext.companionUi.registerRoute(route)
      },
    })
    await contributor.await()

    expect(ctx.companionUi.getSnapshot()).toHaveLength(1)
    await contributor.dispose()
    expect(ctx.companionUi.getSnapshot()).toHaveLength(0)
  })

  it('rejects a duplicate active path', async () => {
    const ctx = new Context()
    await ctx.plugin(UiRegistryService).await()
    ctx.companionUi.registerRoute(route)

    expect(() => ctx.companionUi.registerRoute({ ...route, id: 'other' })).toThrowError(/conflicts/)
  })
})
