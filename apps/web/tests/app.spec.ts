import { expect, test } from '@playwright/test'

test('handles Harness Fixture questions and approval through the real client runtime', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', error => { pageErrors.push(error) })
  await page.goto('/companion/?fixture')
  await expect(page.getByRole('heading', { name: '收件箱', exact: true })).toBeVisible()
  await expect(page.getByTestId('attention-pending:fx-alpha')).toBeVisible()

  await page.getByTestId('attention-pending:fx-alpha').click()
  await expect(page.getByTestId('conversation-history')).toBeVisible()
  const allowButton = page.getByRole('button', { name: '允许一次', exact: true })
  await expect(allowButton).toBeInViewport()
  const interactionPrecedesHistory = await allowButton.evaluate((button, historyTestId) => {
    const interaction = button.closest('[data-testid^="interaction-"]')
    const history = document.querySelector(`[data-testid="${historyTestId}"]`)
    return interaction !== null
      && history !== null
      && (interaction.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  }, 'conversation-history')
  expect(interactionPrecedesHistory).toBe(true)
  await expect(page.getByText('问题 72：请完整列出全部一百条条目。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '加载更早的对话', exact: true }).click()
  await expect(page.getByText('问题 29：fixture 历史消息，用于翻页与渲染验收。', { exact: true })).toHaveCount(1)
  await expect.poll(() => page.getByTestId('conversation-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(page.getByText('dangerous_tool', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('你现在更想招哪类 Agent/Harness 候选人？', { exact: true })).toBeVisible()
  if (test.info().project.name !== 'desktop') {
    const mobileLayout = await page.evaluate(() => {
      const conversation = document.querySelector<HTMLElement>('[data-testid="conversation-scroll"]')
      const composer = document.querySelector<HTMLElement>('[data-testid="prompt-composer"]')
      const navigation = document.querySelector<HTMLElement>('[aria-label="移动主导航"]')
      if (conversation === null || composer === null || navigation === null) return undefined
      const conversationBounds = conversation.getBoundingClientRect()
      const composerBounds = composer.getBoundingClientRect()
      const navigationBounds = navigation.getBoundingClientRect()
      return {
        composerBottom: composerBounds.bottom,
        composerTop: composerBounds.top,
        conversationBottom: conversationBounds.bottom,
        conversationScrollable: conversation.scrollHeight > conversation.clientHeight,
        navigationTop: navigationBounds.top,
      }
    })
    expect(mobileLayout).toBeDefined()
    expect(mobileLayout?.conversationScrollable).toBe(true)
    expect(mobileLayout?.conversationBottom).toBeLessThanOrEqual(mobileLayout?.composerTop ?? 0)
    expect(mobileLayout?.composerBottom).toBeLessThanOrEqual(mobileLayout?.navigationTop ?? 0)
  }
  await page.getByRole('radio', { name: /均衡型/ }).check()
  await page.getByRole('radio', { name: /先写完整设计/ }).check()
  await page.getByRole('checkbox', { name: '系统设计' }).check()
  await page.getByRole('button', { name: '提交回答', exact: true }).click()
  await expect(page.getByText('你现在更想招哪类 Agent/Harness 候选人？', { exact: true })).toHaveCount(0)
  await allowButton.click()
  await expect(page.getByText('dangerous_tool', { exact: true })).toHaveCount(0)

  const remotePrompt = '手机排队的下一项工作'
  await page.getByRole('textbox', { name: '排队消息' }).fill(remotePrompt)
  await page.getByRole('button', { name: '排队发送', exact: true }).click()
  await expect(page.getByText(remotePrompt, { exact: true })).toBeVisible()

  const navLabel = test.info().project.name === 'desktop' ? '桌面主导航' : '移动主导航'
  await page.getByRole('navigation', { name: navLabel }).getByRole('button', { name: /收件箱/ }).click()
  await expect(page.getByTestId('attention-pending:fx-alpha')).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  expect(pageErrors).toEqual([])
})

test('shows the exact Host and local-only trust context', async ({ page }) => {
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
          access: 'viewer',
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

test('guides an unpaired remote browser without starting the client runtime', async ({ page }) => {
  await page.route('**/api/device-pairing.current', async route => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'device-unauthorized', message: 'paired-device credential is missing' },
      }),
    })
  })

  await page.goto('http://companion.test:4173/companion/')
  await expect(page.getByRole('heading', { name: '这台手机还没有配对', exact: true })).toBeVisible()
  await expect(page.getByText('请在电脑端打开 Companion 设置，选择“配对新手机”，再用这台手机扫描二维码。', { exact: true })).toBeVisible()
  await expect(page.getByText('DSH Companion 启动失败', { exact: true })).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('keeps viewer input read-only and sends an owner to the official client', async ({ page }) => {
  let access: 'viewer' | 'owner' = 'viewer'
  await page.route('http://companion.test:4173/', async route => {
    await route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="zh-CN"><body><h1>DeepSeek Harness</h1></body></html>',
    })
  })
  await page.route('**/api/device-pairing.current', async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        device: {
          deviceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          label: '测试手机',
          access,
        },
      }),
    })
  })

  await page.goto('http://companion.test:4173/companion/sessions/fx-alpha?fixture')
  await expect(page.getByText('此设备只有查看权限，请在电脑端授予“完整控制”', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '排队消息' })).toHaveCount(0)

  access = 'owner'
  await page.reload()
  await expect(page).toHaveURL('http://companion.test:4173/')
  await expect(page.getByRole('heading', { name: 'DeepSeek Harness', exact: true })).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
