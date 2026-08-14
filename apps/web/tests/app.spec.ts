import { expect, test } from '@playwright/test'

test('completes one attention workflow through the real app entry', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '收件箱', exact: true })).toBeVisible()
  await expect(page.getByTestId('attention-interaction:interaction-test-scope')).toBeVisible()

  await page.getByTestId('attention-interaction:interaction-test-scope').click()
  await expect(page.getByRole('heading', { name: '移动端控制界面', exact: true })).toBeVisible()
  await page.getByLabel('同时覆盖断线恢复', { exact: true }).check()
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  await expect(page.getByTestId('interaction-state')).toHaveAttribute('data-state', 'submitting')
  await expect(page.getByTestId('interaction-state')).toHaveAttribute('data-state', 'resolved')
  await expect(page.getByText('同时覆盖断线恢复', { exact: true })).toBeVisible()

  const navLabel = test.info().project.name === 'desktop' ? '桌面主导航' : '移动主导航'
  await page.getByRole('navigation', { name: navLabel }).getByRole('button', { name: /收件箱/ }).click()
  await expect(page.getByTestId('attention-interaction:interaction-test-scope')).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('shows reconnect and resync as explicit read-only states', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /重新连接/ }).click()
  await expect(page.getByTestId('connection-banner')).toContainText('正在重连')
  await expect(page.getByTestId('connection-banner')).toContainText('正在同步')
  await expect(page.getByTestId('connection-banner')).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
