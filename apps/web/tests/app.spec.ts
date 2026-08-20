import { expect, test, type Page } from '@playwright/test'

function mobileProject(): boolean {
  return test.info().project.name !== 'desktop'
}

async function visibleSessionNavigation(page: Page) {
  if (mobileProject()) await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  const navigation = page.locator(mobileProject() ? '.mobile-session-navigation' : '.desktop-session-navigation')
  await expect(navigation).toBeVisible()
  return navigation
}

test('publishes an installable manifest and a Companion-scoped static cache', async ({ page, request }) => {
  const response = await request.get('/companion/manifest.webmanifest')
  expect(response.ok()).toBe(true)
  const manifest = await response.json() as {
    id: string
    start_url: string
    scope: string
    display: string
    related_applications: Array<{ platform: string; url: string; id: string }>
    icons: Array<{ src: string; sizes: string; purpose?: string }>
  }
  expect(manifest).toMatchObject({
    id: '/companion/',
    start_url: '/companion/',
    scope: '/',
    display: 'standalone',
    related_applications: [
      { platform: 'webapp', url: '/companion/manifest.webmanifest', id: '/companion/' },
    ],
  })
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: '192x192' }),
    expect.objectContaining({ sizes: '512x512' }),
    expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
  ]))
  const iconResponse = await request.get('/companion/pwa-512x512.png')
  expect(iconResponse.ok()).toBe(true)
  expect(iconResponse.headers()['content-type']).toBe('image/png')

  await page.goto('/companion/?fixture')
  const cacheUrls = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    if (!registration.scope.endsWith('/companion/')) throw new Error(`unexpected service worker scope ${registration.scope}`)
    const urls: string[] = []
    for (const name of await caches.keys()) {
      for (const entry of await caches.open(name).then(cache => cache.keys())) urls.push(entry.url)
    }
    return urls
  })
  expect(cacheUrls.length).toBeGreaterThan(0)
  expect(cacheUrls.every(url => new URL(url).pathname.startsWith('/companion/'))).toBe(true)
  expect(cacheUrls.some(url => new URL(url).pathname.startsWith('/api/'))).toBe(false)
})

test('offers installation before device trust or owner redirection starts', async ({ page }) => {
  const harnessRequests: string[] = []
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'getInstalledRelatedApps', {
      configurable: true,
      value: async () => [],
    })
  })
  page.on('request', request => {
    if (request.url().includes('/api/') || request.url().includes('/cordis')) harnessRequests.push(request.url())
  })

  await page.goto('/companion/?install=1')
  await expect(page.getByRole('heading', { name: '安装 DSH Companion', exact: true })).toBeVisible()

  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & { installPromptCalls?: number }
    state.installPromptCalls = 0
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.defineProperties(event, {
      prompt: {
        value: async () => { state.installPromptCalls = (state.installPromptCalls ?? 0) + 1 },
      },
      userChoice: {
        value: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      },
    })
    window.dispatchEvent(event)
  })

  await page.getByRole('button', { name: '安装应用', exact: true }).click()
  await expect(page.getByText('Chrome 已接收安装请求；请从手机桌面打开一次 DSH Companion 完成确认', { exact: true })).toBeVisible()
  await page.evaluate(() => { window.dispatchEvent(new Event('appinstalled')) })
  await expect(page.getByRole('button', { name: '重新检测', exact: true })).toBeEnabled()
  await expect(page.getByText('已检测到 DSH Companion，可以从桌面打开', { exact: true })).toHaveCount(0)
  await page.evaluate(() => {
    window.localStorage.setItem('dsh-companion:pwa-standalone-launched-at', Date.now().toString())
  })
  await expect(page.getByText('已检测到 DSH Companion，可以从桌面打开', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { installPromptCalls?: number }).installPromptCalls)).toBe(1)
  expect(harnessRequests).toEqual([])

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('records a standalone launch as installation confirmation', async ({ page }) => {
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window)
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => {
        const result = matchMedia(query)
        if (query === '(display-mode: standalone)') Object.defineProperty(result, 'matches', { value: true })
        return result
      },
    })
  })

  await page.goto('/companion/?install=1')
  await expect(page.getByText('已检测到 DSH Companion，可以从桌面打开', { exact: true })).toBeVisible()
  const launchedAt = await page.evaluate(() => window.localStorage.getItem('dsh-companion:pwa-standalone-launched-at'))
  expect(Number(launchedAt)).toBeGreaterThan(0)
})

test('refuses installation while the Tailscale origin is available only from cache', async ({ page }) => {
  await page.route('**/manifest.webmanifest?online=*', route => route.abort('internetdisconnected'))
  await page.goto('/companion/?install=1')

  await expect(page.getByText('当前页面来自离线缓存，请先连接 Tailscale', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '重新检查', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '安装应用', exact: true })).toHaveCount(0)
})

test('keeps a retry action after Chrome dismisses the install prompt', async ({ page }) => {
  await page.goto('/companion/?install=1')
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.defineProperties(event, {
      prompt: { value: async () => undefined },
      userChoice: { value: Promise.resolve({ outcome: 'dismissed', platform: 'web' }) },
    })
    window.dispatchEvent(event)
  })

  await page.getByRole('button', { name: '安装应用', exact: true }).click()
  await expect(page.getByText('Chrome 已关闭本次安装窗口', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '重新尝试', exact: true })).toBeEnabled()
})

test('opens the Session workspace from the Companion root', async ({ page }) => {
  await page.goto('/companion/?fixture')

  await expect(page).toHaveURL(/\/companion\/sessions\/[^/?]+\?fixture$/)
  await expect(page.getByTestId('prompt-card')).toBeVisible()
  const navigation = await visibleSessionNavigation(page)
  const routeId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '')
  await expect(navigation.locator(`[data-session-id="${routeId}"]`)).toHaveAttribute('aria-current', 'page')
})

test('moves both mobile surfaces with slow drags and commits short flicks', async ({ page }) => {
  test.skip(!mobileProject(), 'mobile drawer behavior')
  await page.goto('/companion/sessions/fx-alpha?fixture')

  const drawer = page.locator('#mobile-session-drawer')
  const content = page.locator('.app-column')
  await expect(drawer).toHaveAttribute('data-open', 'false')
  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('.app-column')
    if (target === null) throw new Error('missing app column')
    const start = new Touch({ identifier: 1, target, clientX: 180, clientY: 260 })
    const move = new Touch({ identifier: 1, target, clientX: 260, clientY: 262 })
    target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }))
    target.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [move] }))
  })
  await expect(drawer).toHaveAttribute('data-dragging', 'true')
  await expect(drawer).toHaveAttribute('data-open', 'false')
  const partialOpening = await drawer.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return { right: bounds.right, width: bounds.width }
  })
  expect(partialOpening.right).toBeGreaterThan(40)
  expect(partialOpening.right).toBeLessThan(partialOpening.width / 2)
  const partialContentLeft = await content.evaluate(element => element.getBoundingClientRect().left)
  expect(Math.abs(partialContentLeft - partialOpening.right)).toBeLessThan(2)
  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('.app-column')
    if (target === null) throw new Error('missing app column')
    const move = new Touch({ identifier: 1, target, clientX: 220, clientY: 262 })
    target.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [move] }))
  })
  const restoredOpening = await drawer.evaluate(element => element.getBoundingClientRect().right)
  const restoredContentLeft = await content.evaluate(element => element.getBoundingClientRect().left)
  expect(restoredOpening).toBeLessThan(partialOpening.right)
  expect(Math.abs(restoredContentLeft - restoredOpening)).toBeLessThan(2)
  await page.waitForTimeout(320)
  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('.app-column')
    if (target === null) throw new Error('missing app column')
    const end = new Touch({ identifier: 1, target, clientX: 220, clientY: 262 })
    target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }))
  })
  await expect(drawer).toHaveAttribute('data-dragging', 'false')
  await expect(drawer).toHaveAttribute('data-open', 'false')

  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('.app-column')
    if (target === null) throw new Error('missing app column')
    const start = new Touch({ identifier: 2, target, clientX: 160, clientY: 260 })
    const move = new Touch({ identifier: 2, target, clientX: 370, clientY: 262 })
    target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }))
    target.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [move] }))
  })
  await expect(drawer).toHaveAttribute('data-dragging', 'true')
  await expect(drawer).toHaveAttribute('data-open', 'false')
  const committedOpening = await drawer.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return { right: bounds.right, width: bounds.width }
  })
  expect(committedOpening.right).toBeGreaterThan(committedOpening.width / 2)
  expect(committedOpening.right).toBeLessThan(committedOpening.width)
  const committedContentLeft = await content.evaluate(element => element.getBoundingClientRect().left)
  expect(Math.abs(committedContentLeft - committedOpening.right)).toBeLessThan(2)
  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('.app-column')
    if (target === null) throw new Error('missing app column')
    const end = new Touch({ identifier: 2, target, clientX: 370, clientY: 262 })
    target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }))
  })
  await expect(drawer).toHaveAttribute('data-dragging', 'false')
  await expect(drawer).toHaveAttribute('data-open', 'true')
  await expect(drawer.getByLabel('Session 侧边栏列表')).toBeVisible()
  await expect(drawer.getByLabel('Session 侧边栏列表').getByLabel('运行中')).toBeVisible()

  await expect(drawer.getByRole('button', { name: '设置', exact: true })).toBeVisible()
  const positions = await drawer.evaluate(element => {
    const list = element.querySelector('.session-navigation-list')
    const settingsButton = element.querySelector('[data-route-id="settings"]')
    if (list === null || settingsButton === null) return undefined
    return { listBottom: list.getBoundingClientRect().bottom, settingsTop: settingsButton.getBoundingClientRect().top }
  })
  expect(positions).toBeDefined()
  expect(positions?.settingsTop).toBeGreaterThanOrEqual(positions?.listBottom ?? Number.POSITIVE_INFINITY)

  await drawer.evaluate(element => {
    const start = new Touch({ identifier: 3, target: element, clientX: 250, clientY: 280 })
    const move = new Touch({ identifier: 3, target: element, clientX: 170, clientY: 282 })
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }))
    element.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [move] }))
  })
  await expect(drawer).toHaveAttribute('data-dragging', 'true')
  const partialClosing = await drawer.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return { right: bounds.right, width: bounds.width }
  })
  expect(partialClosing.right).toBeGreaterThan(partialClosing.width / 2)
  expect(partialClosing.right).toBeLessThan(partialClosing.width)
  const partialClosingContentLeft = await content.evaluate(element => element.getBoundingClientRect().left)
  expect(Math.abs(partialClosingContentLeft - partialClosing.right)).toBeLessThan(2)
  await drawer.evaluate(element => {
    const move = new Touch({ identifier: 3, target: element, clientX: 220, clientY: 282 })
    element.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [move] }))
  })
  const restoredClosing = await drawer.evaluate(element => element.getBoundingClientRect().right)
  const restoredClosingContentLeft = await content.evaluate(element => element.getBoundingClientRect().left)
  expect(restoredClosing).toBeGreaterThan(partialClosing.right)
  expect(Math.abs(restoredClosingContentLeft - restoredClosing)).toBeLessThan(2)
  await page.waitForTimeout(320)
  await drawer.evaluate(element => {
    const end = new Touch({ identifier: 3, target: element, clientX: 220, clientY: 282 })
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }))
  })
  await expect(drawer).toHaveAttribute('data-dragging', 'false')
  await expect(drawer).toHaveAttribute('data-open', 'true')

  await drawer.evaluate(element => {
    const start = new Touch({ identifier: 4, target: element, clientX: 300, clientY: 280 })
    const move = new Touch({ identifier: 4, target: element, clientX: 80, clientY: 282 })
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }))
    element.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [move] }))
  })
  await expect(drawer).toHaveAttribute('data-dragging', 'true')
  const committedClosing = await drawer.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return { right: bounds.right, width: bounds.width }
  })
  expect(committedClosing.right).toBeGreaterThan(0)
  expect(committedClosing.right).toBeLessThan(committedClosing.width / 2)
  const committedClosingContentLeft = await content.evaluate(element => element.getBoundingClientRect().left)
  expect(Math.abs(committedClosingContentLeft - committedClosing.right)).toBeLessThan(2)
  await drawer.evaluate(element => {
    const end = new Touch({ identifier: 4, target: element, clientX: 80, clientY: 282 })
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }))
  })
  await expect(drawer).toHaveAttribute('data-dragging', 'false')
  await expect(drawer).toHaveAttribute('data-open', 'false')

  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('.app-column')
    if (target === null) throw new Error('missing app column')
    const start = new Touch({ identifier: 5, target, clientX: 180, clientY: 260 })
    const end = new Touch({ identifier: 5, target, clientX: 220, clientY: 261 })
    target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }))
    target.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [end] }))
    target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }))
  })
  await expect(drawer).toHaveAttribute('data-open', 'true')

  await drawer.evaluate(element => {
    const start = new Touch({ identifier: 6, target: element, clientX: 260, clientY: 280 })
    const end = new Touch({ identifier: 6, target: element, clientX: 220, clientY: 281 })
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }))
    element.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [end] }))
    element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }))
  })
  await expect(drawer).toHaveAttribute('data-open', 'false')

  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('.app-column')
    if (target === null) throw new Error('missing app column')
    const start = new Touch({ identifier: 7, target, clientX: 190, clientY: 240 })
    const move = new Touch({ identifier: 7, target, clientX: 205, clientY: 320 })
    target.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }))
    target.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [move] }))
    target.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [move] }))
  })
  await expect(drawer).toHaveAttribute('data-open', 'false')

  await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  await page.locator('.mobile-drawer-backdrop').click({ position: { x: 385, y: 420 } })
  await expect(drawer).toHaveAttribute('data-open', 'false')
})

test('shows a completed Session reminder until that Session is opened', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile-390', 'one runtime lifecycle sample is sufficient')
  await page.goto('/companion/sessions/fx-alpha?fixture')
  const navigation = await visibleSessionNavigation(page)
  const gamma = navigation.locator('[data-session-id="fx-gamma"]')

  await expect(gamma.locator('.session-completed-dot')).toBeVisible({ timeout: 12_000 })
  await gamma.click()
  await expect(page).toHaveURL(/\/companion\/sessions\/fx-gamma\?fixture$/)
  const reopened = await visibleSessionNavigation(page)
  await expect(reopened.locator('[data-session-id="fx-gamma"] .session-completed-dot')).toHaveCount(0)
})

test('handles Harness Fixture questions and approval through the real client runtime', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', error => { pageErrors.push(error) })
  await page.goto('/companion/inbox?fixture')
  await expect(page.getByRole('heading', { name: '收件箱', exact: true })).toBeVisible()
  await expect(page.getByTestId('attention-pending:fx-alpha')).toBeVisible()

  await page.getByTestId('attention-pending:fx-alpha').click()
  await expect(page.getByTestId('conversation-history')).toBeVisible()
  const allowButton = page.getByRole('button', { name: '允许一次', exact: true })
  if (test.info().project.name !== 'desktop') await expect(allowButton).toBeInViewport()
  const interactionFollowsHistoryAndPrecedesComposer = await allowButton.evaluate((button, ids) => {
    const interaction = button.closest('[data-testid^="interaction-"]')
    const history = document.querySelector(`[data-testid="${ids.history}"]`)
    const composer = document.querySelector(`[data-testid="${ids.composer}"]`)
    return interaction !== null
      && history !== null
      && composer !== null
      && (history.compareDocumentPosition(interaction) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      && (interaction.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  }, { history: 'conversation-history', composer: 'prompt-composer' })
  expect(interactionFollowsHistoryAndPrecedesComposer).toBe(true)
  await expect(page.getByText('问题 72：请完整列出全部一百条条目。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '加载更早的对话', exact: true }).click()
  await expect(page.getByText('问题 29：fixture 历史消息，用于翻页与渲染验收。', { exact: true })).toHaveCount(1)
  await expect.poll(() => page.getByTestId('conversation-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(page.getByRole('heading', { name: 'Markdown fixture', level: 1 })).toBeVisible()
  const literalUserMarkdown = page.getByText('用户字面量：# 不渲染 `code` [link](https://example.com)', { exact: true })
  await expect(literalUserMarkdown).toBeVisible()
  await expect(literalUserMarkdown.locator('code')).toHaveCount(0)
  await expect(page.locator('[data-call-id="fx-call-69"]')).toHaveCount(1)
  await expect(page.locator('[data-call-id="fx-call-69"]')).toHaveAttribute('data-state', 'completed')
  await expect(page.locator('[data-testid="conversation-row"][aria-label="Agent"] > .message-body:empty')).toHaveCount(0)
  await expect(page.getByText('dangerous_tool', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('你现在更想招哪类 Agent/Harness 候选人？', { exact: true })).toBeVisible()
  if (test.info().project.name !== 'desktop') {
    const mobileLayout = await page.evaluate(() => {
      const conversation = document.querySelector<HTMLElement>('[data-testid="conversation-scroll"]')
      const composer = document.querySelector<HTMLElement>('[data-testid="prompt-composer"]')
      const drawer = document.querySelector<HTMLElement>('#mobile-session-drawer')
      if (conversation === null || composer === null || drawer === null) return undefined
      const conversationBounds = conversation.getBoundingClientRect()
      const composerBounds = composer.getBoundingClientRect()
      return {
        composerBottom: composerBounds.bottom,
        composerTop: composerBounds.top,
        conversationBottom: conversationBounds.bottom,
        conversationScrollable: conversation.scrollHeight > conversation.clientHeight,
        drawerClosed: drawer.dataset.open === 'false' && getComputedStyle(drawer).visibility === 'hidden',
        viewportHeight: window.innerHeight,
      }
    })
    expect(mobileLayout).toBeDefined()
    expect(mobileLayout?.conversationScrollable).toBe(true)
    expect(mobileLayout?.conversationBottom).toBeLessThanOrEqual(mobileLayout?.composerTop ?? 0)
    expect(mobileLayout?.composerBottom).toBeLessThanOrEqual((mobileLayout?.viewportHeight ?? 0) + 1)
    expect(mobileLayout?.drawerClosed).toBe(true)
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

  if (mobileProject()) await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  const navLabel = mobileProject() ? '移动主导航' : '桌面主导航'
  await page.getByRole('navigation', { name: navLabel }).getByRole('button', { name: /收件箱/ }).click()
  await expect(page.getByTestId('attention-pending:fx-alpha')).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  expect(pageErrors).toEqual([])
})

test('starts a Workspace session, sends its first message, and stops the running turn', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', error => { pageErrors.push(error) })
  await page.goto('/companion/sessions/fx-alpha?fixture')
  const sessionNavigation = await visibleSessionNavigation(page)
  await sessionNavigation.getByRole('button', { name: '新建 Session', exact: true }).click()
  await expect(page).toHaveURL(/\/companion\/sessions\/new\?fixture$/)
  await expect(page.getByRole('heading', { name: '选择工作区', exact: true })).toBeVisible()
  const preset = page.getByRole('button', { name: 'Agent 模式，当前 标准模式', exact: true })
  await expect(preset).toBeEnabled()
  await preset.click()
  await page.getByRole('menuitemradio', { name: /极简模式/ }).click()
  await expect(page.getByRole('button', { name: 'Agent 模式，当前 极简模式', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /fixture.*\/tmp\/fixture/ }).click()

  await expect(page).toHaveURL(/\/companion\/sessions\/fx-1\?fixture$/)
  await expect(page.getByRole('heading', { name: 'fixture', exact: true })).toBeVisible()
  await expect(page.getByTestId('prompt-card')).toBeVisible()
  await expect(page.locator('.session-context')).toHaveCount(0)

  const permission = page.getByRole('button', { name: '权限，当前 Workspace Write', exact: true })
  await expect(permission).toBeVisible()
  await permission.click()
  await page.getByRole('heading', { name: 'fixture', exact: true }).click()
  await expect(page.getByRole('menu', { name: '权限模式', exact: true })).toHaveCount(0)
  await permission.click()
  await page.getByRole('menuitemradio', { name: /Full access/ }).click()
  await expect(page.getByText('启用 Full access？', { exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: '我了解这会授予电脑上的完整访问权限', exact: true }).check()
  await page.getByRole('button', { name: '启用', exact: true }).click()
  await expect(page.getByRole('button', { name: '权限，当前 Full access', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '打开命令', exact: true }).click()
  await page.getByRole('textbox', { name: '排队消息' }).click()
  await expect(page.getByRole('menu', { name: '命令', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '打开命令', exact: true }).click()
  const commandOverflow = await page.getByRole('menu', { name: '命令', exact: true })
    .evaluate(element => element.scrollWidth - element.clientWidth)
  expect(commandOverflow).toBeLessThanOrEqual(0)
  await page.getByRole('menuitem', { name: /model选择本会话使用的模型/ }).click()
  await page.getByRole('menuitem', { name: /模型.*DeepSeek-V4-Flash/ }).click()
  await page.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro.*复杂任务/ }).click()
  await expect(page.getByRole('button', { name: '模型，当前 DeepSeek-V4-Pro，推理等级 High', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '模型，当前 DeepSeek-V4-Pro，推理等级 High', exact: true }).click()
  await page.getByRole('heading', { name: 'fixture', exact: true }).click()
  await expect(page.getByRole('menu', { name: '模型与推理等级', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '模型，当前 DeepSeek-V4-Pro，推理等级 High', exact: true }).click()
  await page.getByRole('menuitem', { name: /推理等级.*High/ }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Off', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: 'High', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: 'Max', exact: true })).toBeVisible()
  await page.getByRole('menuitemradio', { name: 'Off', exact: true }).click()
  await expect(page.getByRole('button', { name: '模型，当前 DeepSeek-V4-Pro，推理等级 Off', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '模型，当前 DeepSeek-V4-Pro，推理等级 Off', exact: true }).click()
  await page.getByRole('menuitem', { name: /推理等级.*Off/ }).click()
  await page.getByRole('menuitemradio', { name: 'Max', exact: true }).click()
  await expect(page.getByRole('button', { name: '模型，当前 DeepSeek-V4-Pro，推理等级 Max', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '打开命令', exact: true }).click()
  await page.getByRole('menuitem', { name: /compactfixture：压缩当前会话上下文/ }).click()
  await expect(page.getByRole('status')).toContainText('fixture：已压缩（假动作）')

  await page.getByRole('button', { name: '打开命令', exact: true }).click()
  await page.getByRole('menuitem', { name: /goalset or view the goal/ }).click()
  await expect(page.getByRole('textbox', { name: '排队消息' })).toHaveValue('/goal ')
  if (test.info().project.name !== 'desktop') {
    await expect(page.getByTestId('session-chat-header')).toBeVisible()
    await expect(page.locator('#mobile-session-drawer')).toHaveAttribute('data-open', 'false')
    await expect(page.locator('.mobile-topbar')).toBeHidden()
    const mobileLayout = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>('[data-testid="session-chat-header"]')
      const conversation = document.querySelector<HTMLElement>('[data-testid="conversation-scroll"]')
      const composer = document.querySelector<HTMLElement>('[data-testid="prompt-composer"]')
      if (header === null || conversation === null || composer === null) return undefined
      const headerBounds = header.getBoundingClientRect()
      const conversationBounds = conversation.getBoundingClientRect()
      const composerBounds = composer.getBoundingClientRect()
      return {
        headerBottom: headerBounds.bottom,
        conversationTop: conversationBounds.top,
        conversationBottom: conversationBounds.bottom,
        composerTop: composerBounds.top,
        composerBottom: composerBounds.bottom,
        viewportHeight: window.innerHeight,
      }
    })
    expect(mobileLayout).toBeDefined()
    expect(mobileLayout?.conversationTop).toBeGreaterThanOrEqual(mobileLayout?.headerBottom ?? Number.POSITIVE_INFINITY)
    expect(mobileLayout?.conversationBottom).toBeLessThanOrEqual(mobileLayout?.composerTop ?? 0)
    expect(mobileLayout?.composerBottom).toBeLessThanOrEqual((mobileLayout?.viewportHeight ?? 0) + 1)
  }
  const prompt = '从手机开始的第一条任务'
  await page.getByRole('textbox', { name: '排队消息' }).fill(prompt)
  await page.getByRole('button', { name: '排队发送', exact: true }).click()
  await expect(page.getByText(prompt, { exact: true })).toBeVisible()

  const stop = page.getByRole('button', { name: '停止生成', exact: true })
  await expect(stop).toBeVisible()
  await stop.click()
  await expect(stop).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  expect(pageErrors).toEqual([])
})

test('explains that an empty Host needs a registered Workspace before a conversation can start', async ({ page }) => {
  await page.goto('/companion/sessions?fixture=empty')

  await expect(page.getByRole('heading', { name: 'Session', exact: true })).toBeVisible()
  const emptyList = page.getByLabel('Session 列表')
  await expect(emptyList.getByText('还没有 Session', { exact: true })).toBeVisible()
  await expect(emptyList.getByText('请先在电脑 Harness 中注册 Workspace', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始对话', exact: true })).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('keeps the Workspace picker open when the Host rejects Session attachment', async ({ page }) => {
  await page.goto('/companion/sessions/fx-alpha?fixture&fixtureAttach=fail')

  const sessionNavigation = await visibleSessionNavigation(page)
  await sessionNavigation.getByRole('button', { name: '新建 Session', exact: true }).click()
  await page.getByRole('button', { name: /fixture.*\/tmp\/fixture/ }).click()
  await expect(page.getByText('Session 已创建，但未能加入这个 Workspace', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '选择工作区', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /fixture.*\/tmp\/fixture/ })).toBeEnabled()
  await expect(page).toHaveURL(/\/companion\/sessions\/new\?fixture&fixtureAttach=fail$/)
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
  await expect(page).toHaveURL(/\/companion\/sessions\/[^/?]+\?fixture$/)
  await expect(page.getByTestId('prompt-card')).toBeVisible()
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
