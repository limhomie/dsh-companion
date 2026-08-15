import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import * as TypertRegistry from '@deepseek-ai/dsh-typert-registry/client'
import * as Connection from '@deepseek-ai/dsh-client-connection/client'
import * as ApiGateway from '@deepseek-ai/dsh-api-gateway/client'
import * as ApiRemotes from '@deepseek-ai/dsh-api-remotes/client'
import * as ClientRuntime from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import * as ConversationProjection from '@dsh-companion/conversation-projection'
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
    for (const plugin of [TypertRegistry, Connection, ApiGateway, ApiRemotes, ClientRuntime]) {
      const fiber = ctx.plugin(plugin)
      fibers.push(fiber)
      await fiber.await()
    }

    const conversationProjection = ctx.plugin(ConversationProjection)
    fibers.push(conversationProjection)
    await conversationProjection.await()

    const ui = ctx.plugin(UiRegistryService)
    fibers.push(ui)
    await ui.await()

    for (const plugin of [InboxUi, SessionUi, SettingsUi]) {
      const fiber = ctx.plugin(plugin)
      fibers.push(fiber)
      await fiber.await()
    }

    const connection = ctx.get('connection') as ConnectionHandle
    root.render(
      <StrictMode>
        <AppShell connection={connection} sessions={ctx.sessions} ui={ctx.companionUi} />
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
