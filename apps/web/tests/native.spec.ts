import { expect, test, type Page } from '@playwright/test'

async function installSavedAndroidConnection(page: Page): Promise<void> {
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
}

test('offers native QR scanning first and keeps paste as a fallback', async ({ page }) => {
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
  await expect(page.getByRole('button', { name: '扫描电脑二维码', exact: true })).toBeVisible()
  await expect(page.getByLabel('配对链接')).toHaveCount(0)
  await page.getByRole('button', { name: '改用粘贴配对链接', exact: true }).click()
  await expect(page.getByLabel('配对链接')).toBeVisible()
  await expect(page.getByRole('button', { name: '验证并配对', exact: true })).toBeDisabled()
  expect(harnessRequests).toEqual([])

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('claims the scanned pairing URL through the existing key-bound flow', async ({ page }) => {
  const offerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const claimId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  await page.route('https://host.example/api/device-pairing.claim', async route => {
    expect(route.request().postDataJSON()).toMatchObject({
      offerId,
      binding: { kind: 'native-p256', publicKey: 'test-public-key' },
    })
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        claimId,
        claimSecret: 's'.repeat(32),
        verificationCode: '482913',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
    })
  })
  await page.route('https://host.example/api/device-pairing.poll', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'pending' }) })
  })
  await page.addInitScript(({ pairingUrl }) => {
    Object.defineProperty(globalThis, 'nativeTestCalls', {
      configurable: true,
      value: [] as string[],
    })
    Object.defineProperty(globalThis, 'androidBridge', { configurable: true, value: {} })
    Object.defineProperty(globalThis, 'Capacitor', {
      configurable: true,
      writable: true,
      value: {
        Plugins: {},
        PluginHeaders: [
          {
            name: 'DshDeviceIdentity',
            methods: ['getIdentity', 'sign', 'loadConnection', 'saveConnection', 'reset']
              .map(name => ({ name, rtype: 'promise' })),
          },
          {
            name: 'CapacitorBarcodeScanner',
            methods: [{ name: 'scanBarcode', rtype: 'promise' }],
          },
        ],
        nativePromise: async (pluginName: string, methodName: string) => {
          const calls = (globalThis as typeof globalThis & { nativeTestCalls: string[] }).nativeTestCalls
          calls.push(`${pluginName}.${methodName}`)
          if (pluginName === 'CapacitorBarcodeScanner' && methodName === 'scanBarcode') {
            return { ScanResult: pairingUrl, format: 0 }
          }
          if (methodName === 'loadConnection') return { configured: false }
          if (methodName === 'getIdentity') return { publicKey: 'test-public-key', label: 'Android test' }
          throw new Error(`unexpected native method ${pluginName}.${methodName}`)
        },
      },
    })
  }, { pairingUrl: `https://host.example/companion/?pair=${offerId}` })

  await page.goto('/')
  await page.getByRole('button', { name: '扫描电脑二维码', exact: true }).click()
  await expect(page.getByLabel('配对核对码')).toHaveText('482913')
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { nativeTestCalls: string[] }).nativeTestCalls))
    .toContain('CapacitorBarcodeScanner.scanBarcode')
})

test('rejects an unsafe scanned value before contacting a Host', async ({ page }) => {
  const harnessRequests: string[] = []
  page.on('request', request => {
    if (request.url().includes('/api/')) harnessRequests.push(request.url())
  })
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'androidBridge', { configurable: true, value: {} })
    Object.defineProperty(globalThis, 'Capacitor', {
      configurable: true,
      writable: true,
      value: {
        Plugins: {},
        PluginHeaders: [
          {
            name: 'DshDeviceIdentity',
            methods: ['getIdentity', 'sign', 'loadConnection', 'saveConnection', 'reset']
              .map(name => ({ name, rtype: 'promise' })),
          },
          { name: 'CapacitorBarcodeScanner', methods: [{ name: 'scanBarcode', rtype: 'promise' }] },
        ],
        nativePromise: async (pluginName: string, methodName: string) => {
          if (pluginName === 'CapacitorBarcodeScanner') return { ScanResult: 'http://unsafe.example/?pair=bad', format: 0 }
          if (methodName === 'loadConnection') return { configured: false }
          throw new Error(`unexpected native method ${pluginName}.${methodName}`)
        },
      },
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '扫描电脑二维码', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('二维码不包含安全配对信息')
  expect(harnessRequests).toEqual([])
})

test('keeps saved Android pairing while the Host is unreachable', async ({ page }) => {
  const challengeRequests: string[] = []
  await page.route('https://host.example/**', async route => {
    challengeRequests.push(route.request().url())
    await route.abort('internetdisconnected')
  })
  await installSavedAndroidConnection(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '无法到达电脑', exact: true })).toBeVisible()
  await expect(page.getByText('确认手机已连接 Tailscale，且电脑上的 Companion Host 可以访问。', { exact: true })).toBeVisible()
  await expect(page.getByText('原配对仍保存在这台手机上', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试连接', exact: true })).toBeVisible()
  await expect(page.getByLabel('配对链接')).toHaveCount(0)
  await expect.poll(() => challengeRequests.length).toBe(1)

  await page.getByRole('button', { name: '重试连接', exact: true }).click()
  await expect.poll(() => challengeRequests.length).toBe(2)
  await expect(page.getByRole('heading', { name: '无法到达电脑', exact: true })).toBeVisible()
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

test('explains when the saved Origin serves plain Harness without deleting pairing', async ({ page }) => {
  const challengeRequests: string[] = []
  await page.route('https://host.example/**', async route => {
    challengeRequests.push(route.request().url())
    await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' })
  })
  await installSavedAndroidConnection(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '当前地址不是 Companion Host', exact: true })).toBeVisible()
  await expect(page.getByText('这个 Origin 返回了其他服务，请在该地址启动 Companion Host。', { exact: true })).toBeVisible()
  await expect(page.getByText('原配对仍保存在这台手机上', { exact: true })).toBeVisible()
  await expect(page.getByLabel('配对链接')).toHaveCount(0)
  await expect.poll(() => challengeRequests.length).toBe(1)

  await page.getByRole('button', { name: '重试连接', exact: true }).click()
  await expect.poll(() => challengeRequests.length).toBe(2)
  expect(await page.evaluate(() => (
    globalThis as typeof globalThis & { nativeTestCalls: string[] }
  ).nativeTestCalls)).not.toContain('reset')

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('distinguishes an incompatible Companion response from the wrong service', async ({ page }) => {
  await page.route('https://host.example/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'future' }) })
  })
  await installSavedAndroidConnection(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Host 响应不兼容', exact: true })).toBeVisible()
  await expect(page.getByText('电脑端版本与这台 App 不兼容，请更新后重试。', { exact: true })).toBeVisible()
  await expect(page.getByText('原配对仍保存在这台手机上', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (
    globalThis as typeof globalThis & { nativeTestCalls: string[] }
  ).nativeTestCalls)).not.toContain('reset')
})

test('requires a new pairing only after the Host reports device revocation', async ({ page }) => {
  await page.route('https://host.example/**', async route => {
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'device-revoked', message: 'device revoked' } }),
    })
  })
  await installSavedAndroidConnection(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '这台手机的授权已失效', exact: true })).toBeVisible()
  await expect(page.getByText('电脑已撤销或清理了该设备，需要删除本机配对后重新扫码。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试连接', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '删除配对', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { nativeTestCalls: string[] }).nativeTestCalls)).not.toContain('reset')
})
