import { expect, test } from '@playwright/test'

test('shows native key-bound pairing before Android has a saved connection', async ({ page }) => {
  const harnessRequests: string[] = []
  page.on('request', request => {
    if (request.url().includes('/api/') || request.url().includes('/cordis')) harnessRequests.push(request.url())
  })
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'androidBridge', {
      configurable: true,
      value: {},
    })
    Object.defineProperty(globalThis, 'Capacitor', {
      configurable: true,
      writable: true,
      value: {
        Plugins: {},
        PluginHeaders: [{
          name: 'DshDeviceIdentity',
          methods: ['getIdentity', 'sign', 'loadConnection', 'saveConnection', 'reset']
            .map(name => ({ name, rtype: 'promise' })),
        }],
        nativePromise: async (_pluginName: string, methodName: string) => {
          if (methodName === 'loadConnection') return { configured: false }
          throw new Error(`unexpected native method ${methodName}`)
        },
      },
    })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '连接这台电脑', exact: true })).toBeVisible()
  await expect(page.getByLabel('配对链接')).toBeVisible()
  await expect(page.getByRole('button', { name: '开始配对', exact: true })).toBeDisabled()
  expect(harnessRequests).toEqual([])

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
