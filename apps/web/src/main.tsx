import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import ConnectionService from '@dsh-companion/connection'
import * as FixtureConnection from '@dsh-companion/connection-fixture'
import CompanionRuntimeService from '@dsh-companion/runtime'
import * as InboxUi from '@dsh-companion/ui-inbox'
import * as SessionUi from '@dsh-companion/ui-session'
import * as SettingsUi from '@dsh-companion/ui-settings'
import UiRegistryService, { AppShell } from '@dsh-companion/ui-shell'
import './styles.css'

async function boot(): Promise<void> {
  const element = document.getElementById('root')
  if (element === null) throw new Error('missing #root element')
  const root = createRoot(element)
  const ctx = new Context()
  const fibers: Fiber[] = []

  try {
    const connection = ctx.plugin(ConnectionService)
    fibers.push(connection)
    await connection.await()

    const fixture = ctx.plugin(FixtureConnection, {
      initialConnectDelayMs: 120,
      resolveDelayMs: 900,
      reconnectDelayMs: 700,
      resyncDelayMs: 550,
    })
    fibers.push(fixture)
    await fixture.await()

    const runtime = ctx.plugin(CompanionRuntimeService)
    fibers.push(runtime)
    await runtime.await()

    const ui = ctx.plugin(UiRegistryService)
    fibers.push(ui)
    await ui.await()

    for (const plugin of [InboxUi, SessionUi, SettingsUi]) {
      const fiber = ctx.plugin(plugin)
      fibers.push(fiber)
      await fiber.await()
    }

    root.render(
      <StrictMode>
        <AppShell runtime={ctx.companionRuntime} ui={ctx.companionUi} />
      </StrictMode>,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知启动错误'
    root.render(
      <main className="boot-failure" role="alert">
        <strong>DSH Companion 启动失败</strong>
        <p>{message}</p>
      </main>,
    )
  }

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      root.unmount()
      void disposeFibers(fibers)
    })
  }
}

async function disposeFibers(fibers: Fiber[]): Promise<void> {
  for (const fiber of fibers.reverse()) await fiber.dispose()
}

void boot()
