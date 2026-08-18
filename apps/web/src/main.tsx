import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import * as TypertRegistry from '@deepseek-ai/dsh-typert-registry/client'
import * as Connection from '@deepseek-ai/dsh-client-connection/client'
import * as ApiGateway from '@deepseek-ai/dsh-api-gateway/client'
import * as ApiRemotes from '@deepseek-ai/dsh-api-remotes/client'
import * as ClientRuntime from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import * as ConversationProjection from '@dsh-companion/conversation-projection'
import CompanionDeviceTrustService from '@dsh-companion/device-trust-web'
import {
  NativeCompanionDeviceTrust,
  type NativeConnectionClient,
} from '@dsh-companion/native-connection'
import * as InboxUi from '@dsh-companion/ui-inbox'
import { PairingPage, UnpairedDevicePage } from '@dsh-companion/ui-pairing'
import * as SessionUi from '@dsh-companion/ui-session'
import * as SettingsUi from '@dsh-companion/ui-settings'
import UiRegistryService, { AppShell } from '@dsh-companion/ui-shell'
import { NativeShellPage } from './native.tsx'
import { PwaInstallPage, recordStandaloneLaunch } from './pwa-install.tsx'
import './styles.css'

async function boot(): Promise<void> {
  recordStandaloneLaunch()
  const element = document.getElementById('root')
  if (element === null) throw new Error('missing #root element')
  const root = createRoot(element)
  if (Capacitor.isNativePlatform()) {
    root.render(<NativeShellPage onConnected={async (client, device) => {
      await bootNativeRuntime(root, client, device)
    }} />)
    return
  }
  const pairingOfferId = new URLSearchParams(window.location.search).get('pair')
  if (pairingOfferId !== null) {
    root.render(<PairingPage offerId={pairingOfferId} />)
    return
  }
  if (new URLSearchParams(window.location.search).has('install')) {
    root.render(<PwaInstallPage />)
    return
  }
  const ctx = new Context()
  const fibers: Fiber[] = []
  const disposers: Array<() => void> = []

  try {
    for (const plugin of [TypertRegistry, Connection, CompanionDeviceTrustService]) {
      const fiber = ctx.plugin(plugin)
      fibers.push(fiber)
      await fiber.await()
    }

    const trust = ctx.companionDeviceTrust
    if (trust.getTrustState() === 'unpaired') {
      root.render(<UnpairedDevicePage />)
    } else if (!trust.isLocal
      && trust.getSnapshot()?.access === 'owner'
      && window.location.pathname.startsWith('/companion')) {
      window.location.replace('/')
      return
    } else {
      disposers.push(trust.subscribe(() => {
        if (trust.getSnapshot()?.access === 'owner'
          && window.location.pathname.startsWith('/companion')) window.location.replace('/')
      }))
      await mountRuntime(ctx, root, fibers)
    }
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
      for (const dispose of disposers.splice(0).reverse()) dispose()
      void disposeFibers(fibers)
    })
  }
}

async function bootNativeRuntime(
  root: ReturnType<typeof createRoot>,
  client: NativeConnectionClient,
  device: Awaited<ReturnType<NativeConnectionClient['authenticate']>>,
): Promise<void> {
  const ctx = new Context()
  const fibers: Fiber[] = []
  try {
    const registry = ctx.plugin(TypertRegistry)
    fibers.push(registry)
    await registry.await()
    const connection = client.connection()
    const trust = new NativeCompanionDeviceTrust(client, device)
    trust.attach(connection)
    ctx.provide('connection', connection)
    ctx.provide('companionDeviceTrust', trust)
    await mountRuntime(ctx, root, fibers)
    if (import.meta.hot) {
      import.meta.hot.dispose(() => {
        trust.dispose()
        client.close()
        void disposeFibers(fibers)
      })
    }
  } catch (error) {
    client.close()
    await disposeFibers(fibers)
    throw error
  }
}

async function mountRuntime(
  ctx: Context,
  root: ReturnType<typeof createRoot>,
  fibers: Fiber[],
): Promise<void> {
  for (const plugin of [ApiGateway, ApiRemotes, ClientRuntime]) {
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
}

async function disposeFibers(fibers: Fiber[]): Promise<void> {
  for (const fiber of fibers.reverse()) await fiber.dispose()
}

void boot()
