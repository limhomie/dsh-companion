import { expect, test } from '@playwright/test'

test('keeps the Android shell outside Harness until native device trust exists', async ({ page }) => {
  const harnessRequests: string[] = []
  page.on('request', request => {
    if (request.url().includes('/api/') || request.url().includes('/cordis')) harnessRequests.push(request.url())
  })
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'androidBridge', {
      configurable: true,
      value: {},
    })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '安全连接尚未启用', exact: true })).toBeVisible()
  await expect(page.getByText('此版本不会连接 Harness，也不会读取或保存 Harness、模型或设备凭据。当前请使用电脑提供的 PWA 完成配对。', { exact: true })).toBeVisible()
  expect(harnessRequests).toEqual([])

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
