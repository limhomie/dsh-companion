import { Fragment, useEffect, useState, useSyncExternalStore } from 'react'
import {
  Blocks,
  CheckCircle2,
  CircleAlert,
  KeyRound,
  LoaderCircle,
  MonitorCog,
  QrCode,
  Settings,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react'
import QRCode from 'qrcode'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, HostDescription } from '@deepseek-ai/dsh-client-connection/client'
import type {
  CreatePairingResponse,
  PendingPairingResponse,
  TrustedDeviceResponse,
} from '@deepseek-ai/dsh-device-trust-connection'
import {
  CompanionDeviceTrustService,
  DeviceTrustClientError,
} from '@dsh-companion/device-trust-web'

export const name = 'companion-ui-settings'
export const inject = ['companionUi', 'companionDeviceTrust', 'connection']

const CLAIM_REFRESH_MS = 2_000

function displayError(error: unknown): string {
  if (!(error instanceof DeviceTrustClientError)) return '设备信任操作失败'
  switch (error.code) {
    case 'pairing-unavailable': return '未配置手机访问地址'
    case 'offer-capacity': return '当前已有太多待处理的配对邀请'
    case 'claim-not-pending': return '这个配对请求已经处理'
    case 'device-revoked': return '这个设备已经撤销'
    default: return error.kind === 'network' ? '无法连接 Harness' : error.message
  }
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function PairingAdministration({ trust }: { trust: CompanionDeviceTrustService }) {
  const [offer, setOffer] = useState<CreatePairingResponse>()
  const [qrDataUrl, setQrDataUrl] = useState<string>()
  const [claims, setClaims] = useState<PendingPairingResponse['claims']>([])
  const [devices, setDevices] = useState<readonly TrustedDeviceResponse[]>([])
  const [working, setWorking] = useState<string>()
  const [revokeTarget, setRevokeTarget] = useState<string>()
  const [answerTarget, setAnswerTarget] = useState<string>()
  const [error, setError] = useState<string>()

  const refreshDevices = async (): Promise<void> => {
    setDevices(await trust.client.devices())
  }

  useEffect(() => {
    let active = true
    void trust.client.devices().then(next => {
      if (active) setDevices(next)
    }).catch(cause => {
      if (active) setError(displayError(cause))
    })
    return () => { active = false }
  }, [trust])

  useEffect(() => {
    if (offer === undefined) return
    let active = true
    let refreshing = false
    const refresh = async (): Promise<void> => {
      if (!active || refreshing) return
      refreshing = true
      try {
        const next = await trust.client.pendingClaims()
        if (active) setClaims(next.claims.filter(claim => claim.offerId === offer.offerId))
      } catch (cause) {
        if (active) setError(displayError(cause))
      } finally {
        refreshing = false
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, CLAIM_REFRESH_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [offer, trust])

  const createOffer = async (): Promise<void> => {
    setWorking('create')
    setError(undefined)
    try {
      const next = await trust.client.createOffer()
      const qr = await QRCode.toDataURL(next.pairingUrl, {
        color: { dark: '#20231f', light: '#ffffff' },
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 232,
      })
      setOffer(next)
      setQrDataUrl(qr)
      setClaims([])
    } catch (cause) {
      setError(displayError(cause))
    } finally {
      setWorking(undefined)
    }
  }

  const approve = async (claimId: string, verificationCode: string): Promise<void> => {
    setWorking(claimId)
    setError(undefined)
    try {
      await trust.client.approveClaim(claimId, verificationCode)
      setClaims(current => current.filter(claim => claim.claimId !== claimId))
      await refreshDevices()
    } catch (cause) {
      setError(displayError(cause))
    } finally {
      setWorking(undefined)
    }
  }

  const revoke = async (deviceId: string): Promise<void> => {
    setWorking(deviceId)
    setError(undefined)
    try {
      await trust.client.revoke(deviceId)
      setRevokeTarget(undefined)
      await refreshDevices()
    } catch (cause) {
      setError(displayError(cause))
    } finally {
      setWorking(undefined)
    }
  }

  const setAnswerPermission = async (deviceId: string, enabled: boolean): Promise<void> => {
    setWorking(`scope:${deviceId}`)
    setError(undefined)
    try {
      await trust.client.updateScopes(
        deviceId,
        enabled ? ['session:read', 'interaction:answer'] : ['session:read'],
      )
      setAnswerTarget(undefined)
      await refreshDevices()
    } catch (cause) {
      setError(displayError(cause))
    } finally {
      setWorking(undefined)
    }
  }

  return (
    <>
      <button className="settings-action" type="button" disabled={working !== undefined} onClick={() => { void createOffer() }}>
        <span className="settings-icon"><QrCode aria-hidden="true" size={20} /></span>
        <span><strong>配对新手机</strong><small>Session 只读权限</small></span>
        {working === 'create' ? <LoaderCircle className="spin" aria-label="正在创建" size={18} /> : <QrCode aria-hidden="true" size={18} />}
      </button>

      {error !== undefined && <p className="inline-error"><CircleAlert aria-hidden="true" size={16} />{error}</p>}

      {offer !== undefined && qrDataUrl !== undefined && (
        <div className="pairing-offer">
          <img src={qrDataUrl} alt="手机配对二维码" width="232" height="232" />
          <div>
            <strong>手机扫码</strong>
            <span>{timeLabel(offer.expiresAt)} 前有效</span>
          </div>
        </div>
      )}

      {claims.map(claim => (
        <div className="pairing-claim" key={claim.claimId}>
          <span className="settings-icon"><Smartphone aria-hidden="true" size={20} /></span>
          <div>
            <strong>{claim.label}</strong>
            <output aria-label={`${claim.label} 的核对码`}>{claim.verificationCode}</output>
          </div>
          <button className="button primary" type="button" disabled={working !== undefined} onClick={() => { void approve(claim.claimId, claim.verificationCode) }}>
            {working === claim.claimId ? <LoaderCircle className="spin" aria-hidden="true" size={17} /> : <ShieldCheck aria-hidden="true" size={17} />}
            批准
          </button>
        </div>
      ))}

      {devices.map(device => (
        <Fragment key={device.deviceId}>
          <div className="trusted-device" data-revoked={device.revokedAt !== undefined}>
            <span className="settings-icon muted"><Smartphone aria-hidden="true" size={20} /></span>
            <div>
              <strong>{device.label}</strong>
              <span>{device.revokedAt === undefined
                ? `${device.scopes.includes('interaction:answer') ? '可查看和回答' : '仅查看'} · ${timeLabel(device.expiresAt)} 到期`
                : '已撤销'}</span>
            </div>
            {device.revokedAt === undefined && (
              <span className="device-actions">
                <label className="permission-toggle" title="允许这台设备回答问题和审批">
                  <input
                    type="checkbox"
                    aria-label={`允许 ${device.label} 回答`}
                    checked={device.scopes.includes('interaction:answer')}
                    disabled={working !== undefined}
                    onChange={event => {
                      if (event.target.checked) setAnswerTarget(device.deviceId)
                      else void setAnswerPermission(device.deviceId, false)
                    }}
                  />
                  <span aria-hidden="true" />
                </label>
                {revokeTarget !== device.deviceId ? (
                  <button className="icon-button danger" title="撤销设备" aria-label={`撤销 ${device.label}`} type="button" onClick={() => { setRevokeTarget(device.deviceId) }}>
                    <Trash2 aria-hidden="true" size={18} />
                  </button>
                ) : (
                  <span className="confirm-actions">
                    <button className="icon-button" title="取消" aria-label="取消撤销" type="button" onClick={() => { setRevokeTarget(undefined) }}><X aria-hidden="true" size={18} /></button>
                    <button className="icon-button danger" title="确认撤销" aria-label={`确认撤销 ${device.label}`} type="button" disabled={working !== undefined} onClick={() => { void revoke(device.deviceId) }}><CheckCircle2 aria-hidden="true" size={18} /></button>
                  </span>
                )}
              </span>
            )}
          </div>
          {answerTarget === device.deviceId && (
            <div className="permission-confirm" role="dialog" aria-label={`确认 ${device.label} 的回答权限`}>
              <ShieldCheck aria-hidden="true" size={19} />
              <div>
                <strong>允许处理问题与审批？</strong>
                <span>这台设备可以回答 Agent，并允许或拒绝一次工具操作。</span>
              </div>
              <span className="confirm-actions">
                <button className="icon-button" title="取消" aria-label="取消授权" type="button" onClick={() => { setAnswerTarget(undefined) }}><X aria-hidden="true" size={18} /></button>
                <button className="button primary" type="button" disabled={working !== undefined} onClick={() => { void setAnswerPermission(device.deviceId, true) }}><ShieldCheck aria-hidden="true" size={17} />确认</button>
              </span>
            </div>
          )}
        </Fragment>
      ))}
    </>
  )
}

function SettingsPage({ connection, trust }: { connection: ConnectionHandle; trust: CompanionDeviceTrustService }) {
  const host = useSyncExternalStore<HostDescription | undefined>(
    connection.hostDescription.subscribe,
    connection.hostDescription.getSnapshot,
  )
  const currentDevice = useSyncExternalStore(trust.subscribe, trust.getSnapshot)

  return (
    <div className="page page-settings">
      <header className="page-header">
        <div><p className="eyebrow">{trust.isLocal ? '电脑本机' : '已配对手机'}</p><h1>设置</h1></div>
      </header>

      <section className="settings-section">
        <h2>Host</h2>
        <div className="settings-row host-row">
          <span className="settings-icon"><MonitorCog aria-hidden="true" size={20} /></span>
          <div>
            <strong>{host === undefined ? '正在连接 DeepSeek Harness' : `DeepSeek Harness ${host.version}`}</strong>
            <span>{host?.cwd ?? '等待 Host 握手'}</span>
          </div>
          <span className="mode-label">{trust.fixture ? '演示数据' : '真实数据'}</span>
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
        {trust.fixture ? (
          <div className="settings-row">
            <span className="settings-icon muted"><KeyRound aria-hidden="true" size={20} /></span>
            <div><strong>演示模式</strong><span>不会创建真实配对</span></div>
          </div>
        ) : trust.isLocal ? (
          <PairingAdministration trust={trust} />
        ) : (
          <div className="settings-row">
            <span className="settings-icon"><KeyRound aria-hidden="true" size={20} /></span>
            <div>
              <strong>{currentDevice?.label ?? '可信设备'}</strong>
              <span>{currentDevice?.scopes.includes('interaction:answer') === true
                ? '可查看 Session、回答问题和处理一次性审批'
                : '仅可查看 Session'}</span>
            </div>
            <CheckCircle2 aria-label="已认证" size={18} />
          </div>
        )}
      </section>

      <section className="settings-section">
        <h2>已装载插件</h2>
        {['Harness Connection', 'Device Trust', 'Harness Client Runtime', 'Inbox UI', 'Session UI'].map(plugin => (
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
    component: () => <SettingsPage connection={connection} trust={ctx.companionDeviceTrust} />,
  })
}
