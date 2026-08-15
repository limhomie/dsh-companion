import { useSyncExternalStore } from 'react'
import { Blocks, CheckCircle2, KeyRound, MonitorCog, Settings } from 'lucide-react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, HostDescription } from '@deepseek-ai/dsh-client-connection/client'

export const name = 'companion-ui-settings'
export const inject = ['companionUi', 'connection']

function SettingsPage({ connection }: { connection: ConnectionHandle }) {
  const host = useSyncExternalStore<HostDescription | undefined>(
    connection.hostDescription.subscribe,
    connection.hostDescription.getSnapshot,
  )
  const fixture = new URLSearchParams(window.location.search).has('fixture')

  return (
    <div className="page page-settings">
      <header className="page-header">
        <div><p className="eyebrow">仅本机访问</p><h1>设置</h1></div>
      </header>

      <section className="settings-section">
        <h2>Host</h2>
        <div className="settings-row host-row">
          <span className="settings-icon"><MonitorCog aria-hidden="true" size={20} /></span>
          <div>
            <strong>{host === undefined ? '正在连接 DeepSeek Harness' : `DeepSeek Harness ${host.version}`}</strong>
            <span>{host?.cwd ?? '等待 Host 握手'}</span>
          </div>
          <span className="mode-label">{fixture ? '演示数据' : '真实数据'}</span>
        </div>
        {host !== undefined && (
          <div className="settings-row">
            <span className="settings-icon muted"><CheckCircle2 aria-hidden="true" size={20} /></span>
            <div>
              <strong>{host.attachedSessions} 个已连接 Session</strong>
              <span>{host.provider === undefined ? 'Host 默认模型配置' : `${host.provider} / ${host.model ?? '默认模型'}`}</span>
            </div>
          </div>
        )}
      </section>

      <section className="settings-section">
        <h2>设备信任</h2>
        <div className="settings-row">
          <span className="settings-icon muted"><KeyRound aria-hidden="true" size={20} /></span>
          <div><strong>当前只允许回环访问</strong><span>手机配对与设备认证将在下一阶段实现</span></div>
        </div>
      </section>

      <section className="settings-section">
        <h2>已装载插件</h2>
        {['Harness Connection', 'Harness Client Runtime', 'Inbox UI', 'Session UI'].map(plugin => (
          <div className="plugin-row" key={plugin}>
            <Blocks aria-hidden="true" size={17} /><span>{plugin}</span><CheckCircle2 aria-label="已装载" size={17} />
          </div>
        ))}
      </section>
    </div>
  )
}

export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.companionUi.registerRoute({
    id: 'settings',
    path: '/settings',
    label: '设置',
    order: 30,
    icon: Settings,
    match: path => path === '/settings',
    component: () => <SettingsPage connection={connection} />,
  })
}
