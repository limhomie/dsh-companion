import { expect, test } from '@playwright/test'

test('handles Harness Fixture questions and approval through the real client runtime', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', error => { pageErrors.push(error) })
  await page.goto('/companion/?fixture')
  await expect(page.getByRole('heading', { name: '收件箱', exact: true })).toBeVisible()
  await expect(page.getByTestId('attention-pending:fx-alpha')).toBeVisible()

  await page.getByTestId('attention-pending:fx-alpha').click()
  await expect(page.getByTestId('conversation-history')).toBeVisible()
  await expect(page.getByText('问题 72：请完整列出全部一百条条目。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '加载更早的对话', exact: true }).click()
  await expect(page.getByText('问题 29：fixture 历史消息，用于翻页与渲染验收。', { exact: true })).toHaveCount(1)
  await expect.poll(() => page.getByTestId('conversation-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(page.getByText('dangerous_tool', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('你现在更想招哪类 Agent/Harness 候选人？', { exact: true })).toBeVisible()
  await page.getByRole('radio', { name: /均衡型/ }).check()
  await page.getByRole('radio', { name: /先写完整设计/ }).check()
  await page.getByRole('checkbox', { name: '系统设计' }).check()
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  await expect(page.getByText('你现在更想招哪类 Agent/Harness 候选人？', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '允许一次', exact: true }).click()
  await expect(page.getByText('dangerous_tool', { exact: true })).toHaveCount(0)

  const navLabel = test.info().project.name === 'desktop' ? '桌面主导航' : '移动主导航'
  await page.getByRole('navigation', { name: navLabel }).getByRole('button', { name: /收件箱/ }).click()
  await expect(page.getByTestId('attention-pending:fx-alpha')).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  expect(pageErrors).toEqual([])
})

test('shows the exact Host and local-only trust scope', async ({ page }) => {
  await page.goto('/companion/settings?fixture')
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
  await expect(page.getByText('演示数据', { exact: true })).toBeVisible()
  await expect(page.getByText('演示模式', { exact: true })).toBeVisible()
  await expect(page.getByText('不会创建真实配对', { exact: true })).toBeVisible()
  await expect(page.getByTestId('connection-banner')).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('claims a QR offer before runtime boot and enters the fixture app after approval', async ({ page }) => {
  const offerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const claimId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  let polls = 0
  await page.route('**/api/device-pairing.claim', async route => {
    expect(route.request().postDataJSON()).toEqual({ offerId, label: '测试手机' })
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
  await page.route('**/api/device-pairing.poll', async route => {
    polls += 1
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(polls === 1 ? { status: 'pending' } : {
        status: 'approved',
        device: {
          deviceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          label: '测试手机',
          scopes: ['session:read'],
          createdAt: '2029-01-01T00:00:00.000Z',
          expiresAt: '2030-01-01T00:00:00.000Z',
        },
      }),
    })
  })

  await page.goto(`/companion/?pair=${offerId}&fixture`)
  await expect(page.getByRole('heading', { name: '确认手机名称', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '设备名称' }).fill('测试手机')
  await page.getByRole('button', { name: '请求配对', exact: true }).click()
  await expect(page.getByLabel('配对核对码')).toHaveText('482913')

  const waitingOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(waitingOverflow).toBeLessThanOrEqual(0)
  await expect(page).toHaveURL(/\/companion\/\?fixture$/)
  await expect(page.getByRole('heading', { name: '收件箱', exact: true })).toBeVisible()
})
