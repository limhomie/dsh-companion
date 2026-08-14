import { useSyncExternalStore } from 'react'
import { Blocks, CheckCircle2, KeyRound, MonitorCog, RefreshCw, Settings } from 'lucide-react'
import type { Context } from '@deepseek-ai/cordis'
import type { CompanionRuntimeService } from '@dsh-companion/runtime'

export const name = 'companion-ui-settings'
export const inject = ['companionUi', 'companionRuntime']

function SettingsPage({ runtime }: { runtime: CompanionRuntimeService }) {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  const busy = snapshot.phase === 'reconnecting' || snapshot.phase === 'resyncing'
  return (
    <div className="page page-settings">
      <header className="page-header">
        <div><p className="eyebrow">本机预览</p><h1>设置</h1></div>
      </header>

      <section className="settings-section">
        <h2>Host</h2>
        <div className="settings-row host-row">
          <span className="settings-icon"><MonitorCog aria-hidden="true" size={20} /></span>
          <div><strong>{snapshot.host?.name ?? '正在连接'}</strong><span>{snapshot.host?.protocolVersion ?? '等待握手'}</span></div>
          <span className="mode-label">演示数据</span>
        </div>
        <button className="settings-action" type="button" disabled={busy || snapshot.phase === 'booting'} onClick={() => { runtime.reconnect() }}>
          <RefreshCw className={busy ? 'spin' : undefined} aria-hidden="true" size={18} />
          <span><strong>{busy ? '正在重新连接' : '重新连接'}</strong><small>重新获取 Fixture 基线</small></span>
        </button>
      </section>

      <section className="settings-section">
        <h2>设备信任</h2>
        <div className="settings-row">
          <span className="settings-icon muted"><KeyRound aria-hidden="true" size={20} /></span>
          <div><strong>未配置设备身份</strong><span>当前没有连接真实 Harness</span></div>
        </div>
      </section>

      <section className="settings-section">
        <h2>已装载插件</h2>
        {['Fixture Connection Provider', 'Session & Attention Runtime', 'Inbox UI', 'Session UI'].map(plugin => (
          <div className="plugin-row" key={plugin}>
            <Blocks aria-hidden="true" size={17} /><span>{plugin}</span><CheckCircle2 aria-label="已装载" size={17} />
          </div>
        ))}
      </section>
    </div>
  )
}

export function apply(ctx: Context): void {
  ctx.companionUi.registerRoute({
    id: 'settings',
    path: '/settings',
    label: '设置',
    order: 30,
    icon: Settings,
    match: path => path === '/settings',
    component: () => <SettingsPage runtime={ctx.companionRuntime} />,
  })
}
