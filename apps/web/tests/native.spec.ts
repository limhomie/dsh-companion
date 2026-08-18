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

test('keeps saved Android pairing while the Host is unreachable', async ({ page }) => {
  const challengeRequests: string[] = []
  await page.route('https://host.example/**', async route => {
    challengeRequests.push(route.request().url())
    await route.abort('internetdisconnected')
  })
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'nativeTestCalls', {
      configurable: true,
      value: [] as string[],
    })
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
          const calls = (globalThis as typeof globalThis & { nativeTestCalls: string[] }).nativeTestCalls
          calls.push(methodName)
          if (methodName === 'loadConnection') {
            return {
              configured: true,
              origin: 'https://host.example',
              deviceId: 'device-00000000-0000-4000-8000-000000000001',
              label: 'Saved Android',
            }
          }
          if (methodName === 'reset') return {}
          throw new Error(`unexpected native method ${methodName}`)
        },
      },
    })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '无法连接电脑，请检查 Tailscale', exact: true })).toBeVisible()
  await expect(page.getByText('原配对仍保存在这台手机上', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试连接', exact: true })).toBeVisible()
  await expect(page.getByLabel('配对链接')).toHaveCount(0)
  await expect.poll(() => challengeRequests.length).toBe(1)

  await page.getByRole('button', { name: '重试连接', exact: true }).click()
  await expect.poll(() => challengeRequests.length).toBe(2)
  await expect(page.getByRole('heading', { name: '无法连接电脑，请检查 Tailscale', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { nativeTestCalls: string[] }).nativeTestCalls)).not.toContain('reset')

  await page.getByRole('button', { name: '删除配对', exact: true }).click()
  await expect(page.getByText('删除后必须在电脑上重新创建并批准配对。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('button', { name: '删除配对', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { nativeTestCalls: string[] }).nativeTestCalls)).not.toContain('reset')

  await page.getByRole('button', { name: '删除配对', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('heading', { name: '连接这台电脑', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { nativeTestCalls: string[] }).nativeTestCalls)).toContain('reset')

  await page.setViewportSize({ width: 430, height: 932 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
