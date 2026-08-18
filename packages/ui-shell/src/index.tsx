import { useCallback, useEffect, useMemo, useSyncExternalStore, type ComponentType } from 'react'
import { Context, Service } from '@deepseek-ai/cordis'
import { Inbox, PanelsTopLeft, Radio } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'

declare module '@deepseek-ai/cordis' {
  interface Context {
    companionUi: UiRegistryService
  }
}

export interface RouteProps {
  path: string
  navigate(path: string): void
}

export interface RouteContribution {
  id: string
  path: string
  label: string
  order: number
  icon: LucideIcon
  match(path: string): boolean
  component: ComponentType<RouteProps>
  badge?: 'attention'
}

/** Immutable route registry populated by independent UI plugins. */
export class UiRegistryService extends Service {
  private routes: readonly RouteContribution[] = []
  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context) {
    super(ctx, 'companionUi')
  }

  getSnapshot = (): readonly RouteContribution[] => this.routes

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Register one top-level route for the lifetime of its owning UI plugin. */
  registerRoute(route: RouteContribution): () => void {
    const dispose = this.ctx.effect(function* (this: UiRegistryService) {
      if (this.routes.some(existing => existing.id === route.id || existing.path === route.path)) {
        throw new Error(`route ${route.id} conflicts with an active route`)
      }
      this.routes = [...this.routes, route].sort((left, right) => left.order - right.order)
      this.notify()
      yield () => {
        this.routes = this.routes.filter(existing => existing !== route)
        this.notify()
      }
    }.bind(this), `companionUi.registerRoute(${route.id})`)
    return () => void dispose()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

function phaseLabel(connected: boolean): string {
  return connected ? '已连接' : '正在连接，只读'
}

interface NavigationProps {
  routes: readonly RouteContribution[]
  activePath: string
  attentionCount: number
  navigate(path: string): void
  mode: 'desktop' | 'mobile'
}

function Navigation({ routes, activePath, attentionCount, navigate, mode }: NavigationProps) {
  return (
    <nav className={`${mode}-nav`} aria-label={mode === 'desktop' ? '桌面主导航' : '移动主导航'}>
      {routes.map(route => {
        const Icon = route.icon
        const active = route.path === activePath
        const badge = route.badge === 'attention' ? attentionCount : 0
        return (
          <button
            className="nav-item"
            data-active={active}
            key={route.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => { navigate(route.path) }}
          >
            <span className="nav-icon-wrap">
              <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
              {badge > 0 && <span className="nav-badge" aria-label={`${badge} 项待处理`}>{badge}</span>}
            </span>
            <span>{route.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

export interface AppShellProps {
  connection: ConnectionHandle
  sessions: ISessions
  ui: UiRegistryService
}

/** Generic responsive shell over plugin-contributed top-level routes. */
export function AppShell({ connection, sessions, ui }: AppShellProps) {
  const routes = useSyncExternalStore(ui.subscribe, ui.getSnapshot)
  const host = useSyncExternalStore(
    connection.hostDescription.subscribe,
    connection.hostDescription.getSnapshot,
  )
  const sessionList = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  const path = useBrowserPath()
  const navigate = useCallback((nextPath: string) => {
    const nextUrl = `/companion${nextPath}${window.location.search}`
    if (`${window.location.pathname}${window.location.search}` === nextUrl) return
    window.history.pushState({}, '', nextUrl)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])
  const current = useMemo(() => routes.find(route => route.match(path)) ?? routes[0], [path, routes])
  const activePath = current?.path ?? ''
  const pendingCount = sessionList.ids.filter(id => sessionList.byId[id]?.pendingInteraction !== undefined).length
  const connected = host !== undefined

  useEffect(() => {
    if (path === '/' && routes[0] !== undefined) navigate(routes[0].path)
  }, [navigate, path, routes])

  return (
    <div className="app-frame">
      <aside className="desktop-sidebar">
        <div className="brand-lockup">
          <span className="brand-mark"><PanelsTopLeft aria-hidden="true" size={21} /></span>
          <span><strong>DSH</strong><small>Companion</small></span>
        </div>
        <Navigation routes={routes} activePath={activePath} attentionCount={pendingCount} navigate={navigate} mode="desktop" />
        <div className="sidebar-status">
          <span className="status-dot" data-phase={connected ? 'connected' : 'booting'} />
          <div>
            <strong>DeepSeek Harness</strong>
            <span>{phaseLabel(connected)}</span>
          </div>
        </div>
      </aside>

      <div className="app-column">
        <header className="mobile-topbar">
          <div className="brand-lockup compact">
            <span className="brand-mark"><PanelsTopLeft aria-hidden="true" size={18} /></span>
            <strong>DSH Companion</strong>
          </div>
          <span className="compact-connection"><span className="status-dot" data-phase={connected ? 'connected' : 'booting'} />{phaseLabel(connected)}</span>
        </header>

        {!connected && (
          <div className="connection-banner" role="status" data-testid="connection-banner">
            <Radio aria-hidden="true" size={18} />
            <span><strong>{phaseLabel(false)}</strong></span>
          </div>
        )}

        <main className="app-main">
          {current === undefined
            ? <div className="empty-state"><Inbox aria-hidden="true" size={28} /><strong>没有可用页面</strong></div>
            : <current.component path={path} navigate={navigate} />}
        </main>

        <Navigation routes={routes} activePath={activePath} attentionCount={pendingCount} navigate={navigate} mode="mobile" />
      </div>
    </div>
  )
}

function useBrowserPath(): string {
  const subscribe = useCallback((listener: () => void) => {
    window.addEventListener('popstate', listener)
    return () => { window.removeEventListener('popstate', listener) }
  }, [])
  const getSnapshot = useCallback(() => {
    const pathname = window.location.pathname
    if (pathname === '/companion' || pathname === '/companion/') return '/'
    return pathname.startsWith('/companion/') ? pathname.slice('/companion'.length) : pathname
  }, [])
  return useSyncExternalStore(subscribe, getSnapshot)
}

export default UiRegistryService
