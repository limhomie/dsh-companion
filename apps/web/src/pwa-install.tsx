import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert, Download, LoaderCircle, PanelsTopLeft, RotateCcw, WifiOff } from 'lucide-react'

type InstallPhase = 'checking' | 'offline' | 'waiting' | 'ready' | 'installing' | 'launch-required' | 'installed' | 'dismissed' | 'failed'

interface InstallChoice {
  outcome: 'accepted' | 'dismissed'
}

interface BrowserInstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<unknown>
}

interface InstalledRelatedApp {
  platform?: string
}

interface NavigatorWithInstalledApps extends Navigator {
  getInstalledRelatedApps?: () => Promise<InstalledRelatedApp[]>
}

const INSTALL_CONFIRMATION_INTERVAL_MS = 1_500
const INSTALL_PENDING_AT_KEY = 'dsh-companion:pwa-install-pending-at'
const STANDALONE_LAUNCHED_AT_KEY = 'dsh-companion:pwa-standalone-launched-at'

/** Records a real standalone launch so the originating browser tab can confirm installation. */
export function recordStandaloneLaunch(): void {
  if (isStandalone()) writeTimestamp(STANDALONE_LAUNCHED_AT_KEY, Date.now())
}

/** Presents the browser-owned PWA install transaction without starting Harness. */
export function PwaInstallPage() {
  const standalone = isStandalone()
  const [phase, setPhase] = useState<InstallPhase>(() => standalone ? 'installed' : 'checking')
  const installPrompt = useRef<BrowserInstallPrompt>()
  const mounted = useRef(true)
  const reachable = useRef(false)
  const verificationTimer = useRef<number>()

  const verifyInstallation = useCallback(() => {
    window.clearTimeout(verificationTimer.current)
    const poll = async () => {
      if (!mounted.current) return
      if (await hasConfirmedInstallation()) {
        setPhase('installed')
        return
      }
      verificationTimer.current = window.setTimeout(() => { void poll() }, INSTALL_CONFIRMATION_INTERVAL_MS)
    }
    setPhase('launch-required')
    void poll()
  }, [])

  const checkConnectivity = useCallback(async () => {
    setPhase('checking')
    reachable.current = await canReachOrigin()
    if (!mounted.current) return
    if (!reachable.current) {
      setPhase('offline')
      return
    }
    if (await hasConfirmedInstallation()) {
      setPhase('installed')
      return
    }
    if (readTimestamp(INSTALL_PENDING_AT_KEY) !== undefined) {
      verifyInstallation()
      return
    }
    setPhase(installPrompt.current === undefined ? 'waiting' : 'ready')
  }, [verifyInstallation])

  useEffect(() => {
    mounted.current = true
    const handleInstallPrompt = (event: Event) => {
      if (!isBrowserInstallPrompt(event)) {
        setPhase('failed')
        return
      }
      event.preventDefault()
      installPrompt.current = event
      if (reachable.current && readTimestamp(INSTALL_PENDING_AT_KEY) === undefined) setPhase('ready')
    }
    const handleInstalled = () => {
      ensurePendingInstallTimestamp()
      installPrompt.current = undefined
      verifyInstallation()
    }
    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    if (!standalone) void checkConnectivity()
    return () => {
      mounted.current = false
      window.clearTimeout(verificationTimer.current)
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [checkConnectivity, standalone, verifyInstallation])

  const install = async () => {
    const prompt = installPrompt.current
    if (prompt === undefined || phase !== 'ready') return
    setPhase('installing')
    try {
      await prompt.prompt()
      const choice = parseInstallChoice(await prompt.userChoice)
      if (!mounted.current) return
      installPrompt.current = undefined
      if (choice.outcome === 'dismissed') {
        setPhase('dismissed')
        return
      }
      ensurePendingInstallTimestamp()
      verifyInstallation()
    } catch {
      if (mounted.current) setPhase('failed')
    }
  }

  const content = installContent(phase)
  const canReload = phase === 'dismissed' || phase === 'failed'
  const actionable = phase === 'ready' || phase === 'offline' || phase === 'launch-required' || canReload
  return (
    <main className="pairing-page pwa-install-page">
      <header className="pairing-brand">
        <span className="brand-mark"><PanelsTopLeft aria-hidden="true" size={20} /></span>
        <strong>DSH Companion</strong>
      </header>
      <section className="pairing-panel" aria-live="polite">
        <span className={`pairing-leading ${installLeadingClass(phase)}`}>
          {installLeadingIcon(phase)}
        </span>
        <p className="eyebrow">Web 应用</p>
        <h1>安装 DSH Companion</h1>
        <p className="pairing-status pairing-instructions">{content.status}</p>
        <button
          className="button primary pairing-submit pwa-install-action"
          type="button"
          disabled={!actionable}
          onClick={() => {
            if (phase === 'offline') {
              void checkConnectivity()
              return
            }
            if (phase === 'launch-required') {
              verifyInstallation()
              return
            }
            if (canReload) {
              window.location.reload()
              return
            }
            void install()
          }}
        >
          {isPendingPhase(phase) && <LoaderCircle className="spin" aria-hidden="true" size={18} />}
          {(phase === 'offline' || canReload) && <RotateCcw aria-hidden="true" size={18} />}
          {content.action}
        </button>
      </section>
    </main>
  )
}

function isBrowserInstallPrompt(event: Event): event is BrowserInstallPrompt {
  const candidate = event as Event & { prompt?: unknown; userChoice?: unknown }
  const choice = candidate.userChoice as { then?: unknown } | null | undefined
  return typeof candidate.prompt === 'function'
    && typeof choice === 'object'
    && choice !== null
    && typeof choice.then === 'function'
}

function parseInstallChoice(value: unknown): InstallChoice {
  if (typeof value !== 'object' || value === null || !('outcome' in value)) {
    throw new Error('PWA install choice is missing an outcome')
  }
  const outcome = value.outcome
  if (outcome !== 'accepted' && outcome !== 'dismissed') {
    throw new Error('PWA install choice has an unknown outcome')
  }
  return { outcome }
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
}

function ensurePendingInstallTimestamp(): void {
  if (readTimestamp(INSTALL_PENDING_AT_KEY) === undefined) {
    writeTimestamp(INSTALL_PENDING_AT_KEY, Date.now())
  }
}

function readTimestamp(key: string): number | undefined {
  try {
    const stored = window.localStorage.getItem(key)
    if (stored === null) return undefined
    const value = Number(stored)
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  } catch {
    // Browser privacy settings may disable storage; direct install checks still work.
    return undefined
  }
}

function writeTimestamp(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, value.toString())
  } catch {
    // Browser privacy settings may disable storage; direct install checks still work.
  }
}

async function canReachOrigin(): Promise<boolean> {
  try {
    const url = new URL('./manifest.webmanifest', window.location.href)
    url.searchParams.set('online', Date.now().toString())
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return false
    const manifest = await response.json() as unknown
    return typeof manifest === 'object' && manifest !== null && 'name' in manifest
  } catch {
    return false
  }
}

async function hasInstalledPwa(): Promise<boolean> {
  const navigatorWithInstalledApps = navigator as NavigatorWithInstalledApps
  if (navigatorWithInstalledApps.getInstalledRelatedApps === undefined) return false
  try {
    const apps = await navigatorWithInstalledApps.getInstalledRelatedApps.call(navigator)
    return apps.some(app => app.platform === 'webapp')
  } catch {
    return false
  }
}

async function hasConfirmedInstallation(): Promise<boolean> {
  if (isStandalone()) return true
  const launchedAt = readTimestamp(STANDALONE_LAUNCHED_AT_KEY)
  const pendingAt = readTimestamp(INSTALL_PENDING_AT_KEY)
  if (launchedAt !== undefined && (pendingAt === undefined || launchedAt >= pendingAt)) return true
  return hasInstalledPwa()
}

function isPendingPhase(phase: InstallPhase): boolean {
  return phase === 'checking' || phase === 'installing'
}

function installLeadingClass(phase: InstallPhase): string {
  if (phase === 'installed') return 'approved'
  if (phase === 'offline' || phase === 'failed') return 'failed'
  if (phase === 'launch-required') return 'waiting'
  return 'unpaired'
}

function installLeadingIcon(phase: InstallPhase) {
  if (phase === 'installed') return <CheckCircle2 aria-hidden="true" size={25} />
  if (phase === 'offline') return <WifiOff aria-hidden="true" size={24} />
  if (phase === 'failed') return <CircleAlert aria-hidden="true" size={24} />
  return <Download aria-hidden="true" size={24} />
}

function installContent(phase: InstallPhase): { action: string; status: string } {
  switch (phase) {
    case 'checking':
      return { action: '检查连接', status: '正在确认 Tailscale 与电脑 Host 在线' }
    case 'offline':
      return { action: '重新检查', status: '当前页面来自离线缓存，请先连接 Tailscale' }
    case 'waiting':
      return { action: '等待 Chrome', status: '连接正常，Chrome 正在检查安装状态' }
    case 'ready':
      return { action: '安装应用', status: '安装后从手机桌面直接打开' }
    case 'installing':
      return { action: '等待确认', status: '请在 Chrome 安装窗口中确认' }
    case 'launch-required':
      return { action: '重新检测', status: 'Chrome 已接收安装请求；请从手机桌面打开一次 DSH Companion 完成确认' }
    case 'installed':
      return { action: '已确认安装', status: '已检测到 DSH Companion，可以从桌面打开' }
    case 'dismissed':
      return { action: '重新尝试', status: 'Chrome 已关闭本次安装窗口' }
    case 'failed':
      return { action: '重新尝试', status: 'Chrome 没有提供有效的安装请求' }
  }
}
