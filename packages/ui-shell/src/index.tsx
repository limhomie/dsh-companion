import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type TouchEvent } from 'react'
import { Context, Service } from '@deepseek-ai/cordis'
import { Inbox, LoaderCircle, Menu, MessageSquare, PanelsTopLeft, Plus, Radio, Search, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions, SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'

declare module '@deepseek-ai/cordis' {
  interface Context {
    companionUi: UiRegistryService
  }
}

export interface RouteProps {
  path: string
  navigate(path: string): void
  openNavigation(): void
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
            data-route-id={route.id}
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

interface SessionNavigationProps {
  snapshot: SessionListState
  activePath: string
  mode: 'desktop' | 'mobile'
  openSession(id: SessionId): void
  createSession(): void
}

function sessionWorkspace(cwd: string | undefined): string {
  if (cwd === undefined) return '未提供工作区'
  const normalized = cwd.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).at(-1) || cwd
}

function activeSessionId(path: string): string | undefined {
  const raw = /^\/sessions\/([^/]+)$/.exec(path)?.[1]
  return raw === undefined || raw === 'new' ? undefined : decodeURIComponent(raw)
}

function SessionNavigation({ snapshot, activePath, mode, openSession, createSession }: SessionNavigationProps) {
  const [query, setQuery] = useState('')
  const selected = activeSessionId(activePath)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const ids = normalizedQuery === ''
    ? snapshot.ids
    : snapshot.ids.filter(id => {
      const summary = snapshot.byId[id]
      if (summary === undefined) return false
      return `${summary.displayTitle}\n${summary.cwd ?? ''}`.toLocaleLowerCase().includes(normalizedQuery)
    })

  return (
    <section className={`session-navigation ${mode}-session-navigation`} aria-label="Session 侧边栏列表">
      <header>
        <strong>Session</strong>
        <span>{snapshot.ids.length}</span>
        <button className="sidebar-new-session" type="button" title="新建 Session" aria-label="新建 Session" onClick={createSession}>
          <Plus aria-hidden="true" size={18} />
        </button>
      </header>
      <label className="session-search">
        <Search aria-hidden="true" size={17} />
        <input aria-label="搜索 Session" type="search" value={query} placeholder="搜索会话" onChange={event => { setQuery(event.target.value) }} />
      </label>
      <div className="session-navigation-list">
        {ids.map(id => {
          const session = snapshot.byId[id]
          if (session === undefined) return null
          const active = selected === id
          return (
            <button
              className="session-navigation-row"
              type="button"
              data-active={active}
              data-session-id={id}
              key={id}
              aria-current={active ? 'page' : undefined}
              onClick={() => { openSession(id) }}
            >
              <span className="session-navigation-status">
                {session.running
                  ? <LoaderCircle className="spin" aria-label="运行中" size={16} />
                  : session.pendingInteraction !== undefined
                    ? <span className="session-waiting-dot" aria-label="等待处理" />
                    : session.completed === true
                      ? <span className="session-completed-dot" aria-label="已完成，尚未查看" />
                      : <MessageSquare aria-hidden="true" size={15} />}
              </span>
              <span>
                <strong>{session.displayTitle}</strong>
                <small>{sessionWorkspace(session.cwd)}</small>
              </span>
            </button>
          )
        })}
        {snapshot.phase === 'ready' && ids.length === 0 && (
          <p className="session-navigation-empty">{snapshot.ids.length === 0 ? '还没有 Session' : '没有匹配的 Session'}</p>
        )}
      </div>
    </section>
  )
}

interface MobileDrawerProps extends SessionNavigationProps {
  routes: readonly RouteContribution[]
  attentionCount: number
  connected: boolean
  dragging: boolean
  open: boolean
  beginDrag(event: TouchEvent<HTMLElement>): void
  cancelDrag(): void
  close(): void
  continueDrag(event: TouchEvent<HTMLElement>): void
  finishDrag(event: TouchEvent<HTMLElement>): void
  navigate(path: string): void
}

function MobileDrawer({ routes, snapshot, activePath, attentionCount, connected, dragging, open, beginDrag, cancelDrag, close, continueDrag, finishDrag, navigate, openSession, createSession }: MobileDrawerProps) {
  useEffect(() => {
    if (!open) return
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', dismiss)
    return () => { document.removeEventListener('keydown', dismiss) }
  }, [close, open])

  return (
    <>
      <button className="mobile-drawer-backdrop" data-dragging={dragging} data-open={open} type="button" aria-label="关闭侧边栏" tabIndex={open ? 0 : -1} onClick={close} />
      <aside
        className="mobile-session-drawer"
        id="mobile-session-drawer"
        aria-label="Session 侧边栏"
        aria-hidden={!open}
        data-dragging={dragging}
        data-open={open}
        onTouchStart={beginDrag}
        onTouchMove={continueDrag}
        onTouchEnd={finishDrag}
        onTouchCancel={cancelDrag}
      >
        <div className="mobile-drawer-heading">
          <div className="brand-lockup compact">
            <span className="brand-mark"><PanelsTopLeft aria-hidden="true" size={18} /></span>
            <strong>DSH Companion</strong>
          </div>
          <button className="icon-button" type="button" title="关闭" aria-label="关闭侧边栏" onClick={close}><X aria-hidden="true" size={19} /></button>
        </div>
        <SessionNavigation snapshot={snapshot} activePath={activePath} mode="mobile" openSession={openSession} createSession={createSession} />
        <Navigation routes={routes} activePath={activePath} attentionCount={attentionCount} navigate={navigate} mode="mobile" />
        <div className="mobile-drawer-status">
          <span className="status-dot" data-phase={connected ? 'connected' : 'booting'} />
          <span>{phaseLabel(connected)}</span>
        </div>
      </aside>
    </>
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
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerDragging, setDrawerDragging] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  const navigationSwipe = useRef<{ x: number; y: number; width: number; opening: boolean; engaged: boolean; progress: number }>()
  const navigate = useCallback((nextPath: string) => {
    const nextUrl = `/companion${nextPath}${window.location.search}`
    setDrawerOpen(false)
    if (`${window.location.pathname}${window.location.search}` === nextUrl) return
    window.history.pushState({}, '', nextUrl)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])
  const current = useMemo(() => routes.find(route => route.match(path)) ?? routes[0], [path, routes])
  const activePath = current?.path ?? ''
  const pendingCount = sessionList.ids.filter(id => sessionList.byId[id]?.pendingInteraction !== undefined).length
  const connected = host !== undefined
  const auxiliaryRoutes = useMemo(() => routes.filter(route => route.id !== 'sessions'), [routes])
  const openSession = useCallback((id: SessionId) => {
    sessions.open(id)
    navigate(`/sessions/${encodeURIComponent(id)}`)
  }, [navigate, sessions])
  const createSession = useCallback(() => { navigate('/sessions/new') }, [navigate])
  const openNavigation = useCallback(() => {
    setDrawerDragging(false)
    setDrawerOpen(true)
  }, [])
  const closeNavigation = useCallback(() => {
    setDrawerDragging(false)
    setDrawerOpen(false)
  }, [])

  const updateDrawerDrag = (progress: number, width: number): number => {
    const limited = Math.max(0, Math.min(progress, 1))
    frame.current?.style.setProperty('--drawer-drag-offset', `${limited * width}px`)
    frame.current?.style.setProperty('--drawer-drag-progress', `${limited}`)
    return limited
  }

  const beginNavigationSwipe = (event: TouchEvent<HTMLElement>): void => {
    const touch = event.touches[0]
    if (touch !== undefined) {
      const width = Math.max(280, Math.min(window.innerWidth * 0.86, 360))
      navigationSwipe.current = { x: touch.clientX, y: touch.clientY, width, opening: !drawerOpen, engaged: false, progress: drawerOpen ? 1 : 0 }
    }
  }
  const continueNavigationSwipe = (event: TouchEvent<HTMLElement>): void => {
    const gesture = navigationSwipe.current
    const touch = event.touches[0]
    if (gesture === undefined || touch === undefined) return
    const signedDistance = gesture.opening ? touch.clientX - gesture.x : gesture.x - touch.clientX
    const verticalDistance = Math.abs(touch.clientY - gesture.y)
    if (verticalDistance > 24 && verticalDistance > Math.abs(signedDistance)) {
      setDrawerDragging(false)
      navigationSwipe.current = undefined
      return
    }
    if (signedDistance > 8 && signedDistance > verticalDistance * 1.25) {
      gesture.engaged = true
      const visibleDistance = gesture.opening ? signedDistance : gesture.width - signedDistance
      gesture.progress = updateDrawerDrag(visibleDistance / gesture.width, gesture.width)
      setDrawerDragging(true)
      event.preventDefault()
    }
  }
  const finishNavigationSwipe = (event: TouchEvent<HTMLElement>): void => {
    const gesture = navigationSwipe.current
    if (gesture !== undefined) {
      const touch = event.changedTouches[0]
      if (touch !== undefined) {
        const signedDistance = gesture.opening ? touch.clientX - gesture.x : gesture.x - touch.clientX
        const verticalDistance = Math.abs(touch.clientY - gesture.y)
        if (signedDistance > 8 && signedDistance > verticalDistance * 1.25) {
          const visibleDistance = gesture.opening ? signedDistance : gesture.width - signedDistance
          gesture.progress = updateDrawerDrag(visibleDistance / gesture.width, gesture.width)
        }
      }
      if (gesture.engaged) setDrawerOpen(gesture.progress > 0.5)
    }
    setDrawerDragging(false)
    navigationSwipe.current = undefined
  }
  const cancelNavigationSwipe = (): void => {
    setDrawerDragging(false)
    navigationSwipe.current = undefined
  }

  useEffect(() => {
    if (path === '/' && routes[0] !== undefined) navigate(routes[0].path)
  }, [navigate, path, routes])

  return (
    <div className="app-frame" ref={frame}>
      <aside className="desktop-sidebar">
        <div className="brand-lockup">
          <span className="brand-mark"><PanelsTopLeft aria-hidden="true" size={21} /></span>
          <span><strong>DSH</strong><small>Companion</small></span>
        </div>
        <SessionNavigation snapshot={sessionList} activePath={path} mode="desktop" openSession={openSession} createSession={createSession} />
        <Navigation routes={auxiliaryRoutes} activePath={activePath} attentionCount={pendingCount} navigate={navigate} mode="desktop" />
        <div className="sidebar-status">
          <span className="status-dot" data-phase={connected ? 'connected' : 'booting'} />
          <div>
            <strong>DeepSeek Harness</strong>
            <span>{phaseLabel(connected)}</span>
          </div>
        </div>
      </aside>

      <div
        className="app-column"
        onTouchStart={beginNavigationSwipe}
        onTouchMove={continueNavigationSwipe}
        onTouchEnd={finishNavigationSwipe}
        onTouchCancel={cancelNavigationSwipe}
      >
        <header className="mobile-topbar">
          <div className="brand-lockup compact">
            <button className="mobile-menu-button" type="button" title="打开侧边栏" aria-label="打开侧边栏" aria-controls="mobile-session-drawer" aria-expanded={drawerOpen} onClick={openNavigation}>
              <Menu aria-hidden="true" size={20} />
            </button>
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
            : <current.component path={path} navigate={navigate} openNavigation={openNavigation} />}
        </main>
      </div>
      <MobileDrawer
        routes={auxiliaryRoutes}
        snapshot={sessionList}
        activePath={path}
        attentionCount={pendingCount}
        connected={connected}
        dragging={drawerDragging}
        open={drawerOpen}
        beginDrag={beginNavigationSwipe}
        cancelDrag={cancelNavigationSwipe}
        close={closeNavigation}
        continueDrag={continueNavigationSwipe}
        finishDrag={finishNavigationSwipe}
        navigate={navigate}
        openSession={openSession}
        createSession={createSession}
        mode="mobile"
      />
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
