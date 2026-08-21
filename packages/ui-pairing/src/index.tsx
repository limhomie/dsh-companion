import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  PanelsTopLeft,
  QrCode,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import {
  DeviceTrustClientError,
  DeviceTrustHttpClient,
} from '@dsh-companion/device-trust-web'
import type { ClaimPairingResponse } from '@dsh-companion/device-trust-connection'

const POLL_INTERVAL_MS = 2_000

type Phase = 'claim' | 'claiming' | 'waiting' | 'approved' | 'failed'

/** Pre-runtime landing page for a remote browser without a paired-device Cookie. */
export function UnpairedDevicePage() {
  return (
    <main className="pairing-page">
      <header className="pairing-brand">
        <span className="brand-mark"><PanelsTopLeft aria-hidden="true" size={20} /></span>
        <strong>DSH Companion</strong>
      </header>
      <section className="pairing-panel" aria-live="polite">
        <span className="pairing-leading unpaired"><QrCode aria-hidden="true" size={24} /></span>
        <p className="eyebrow">尚未建立可信连接</p>
        <h1>这台手机还没有配对</h1>
        <p className="pairing-status pairing-instructions">请在电脑端打开 Companion 设置，选择“生成手机配对二维码”，再用这台手机扫描。</p>
      </section>
    </main>
  )
}

function pairingError(error: unknown): string {
  if (!(error instanceof DeviceTrustClientError)) return '配对失败，请回到电脑重新创建二维码'
  switch (error.code) {
    case 'offer-not-found': return '这个二维码不存在或已经使用'
    case 'offer-expired':
    case 'claim-expired': return '二维码已经过期，请回到电脑重新创建'
    case 'claim-secret-invalid': return '配对状态无效，请回到电脑重新开始'
    case 'claim-not-found': return 'Harness 已重启，请回到电脑重新创建二维码'
    default: return error.kind === 'network' ? '暂时无法连接电脑' : error.message
  }
}

/** Pre-runtime mobile landing page for claiming one pairing offer. */
export function PairingPage({ offerId }: { offerId: string }) {
  const client = useMemo(() => new DeviceTrustHttpClient(), [])
  const [label, setLabel] = useState('我的手机')
  const [claim, setClaim] = useState<ClaimPairingResponse>()
  const [phase, setPhase] = useState<Phase>('claim')
  const [error, setError] = useState<string>()
  const [networkWarning, setNetworkWarning] = useState(false)

  useEffect(() => () => { void client.close() }, [client])

  useEffect(() => {
    if (claim === undefined || phase !== 'waiting') return
    let active = true
    let polling = false
    const poll = async (): Promise<void> => {
      if (!active || polling) return
      polling = true
      try {
        const result = await client.pollClaim(claim.claimId, claim.claimSecret)
        if (!active) return
        setNetworkWarning(false)
        if (result.status === 'approved') setPhase('approved')
        if (result.status === 'rejected') {
          setError('电脑端没有批准这次配对')
          setPhase('failed')
        }
      } catch (cause) {
        if (!active) return
        if (cause instanceof DeviceTrustClientError && cause.kind === 'network') {
          setNetworkWarning(true)
        } else if (!(cause instanceof DeviceTrustClientError && cause.kind === 'closed')) {
          setError(pairingError(cause))
          setPhase('failed')
        }
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, POLL_INTERVAL_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [claim, client, phase])

  useEffect(() => {
    if (phase !== 'approved') return
    const fixture = new URLSearchParams(window.location.search).has('fixture') ? '?fixture' : ''
    const timer = window.setTimeout(() => { window.location.replace(`/companion/${fixture}`) }, 900)
    return () => { window.clearTimeout(timer) }
  }, [phase])

  const submit = async (): Promise<void> => {
    const normalized = label.trim()
    if (normalized === '') return
    setPhase('claiming')
    setError(undefined)
    try {
      const next = await client.claimOffer(offerId, normalized)
      setClaim(next)
      setPhase('waiting')
    } catch (cause) {
      setError(pairingError(cause))
      setPhase('failed')
    }
  }

  return (
    <main className="pairing-page">
      <header className="pairing-brand">
        <span className="brand-mark"><PanelsTopLeft aria-hidden="true" size={20} /></span>
        <strong>DSH Companion</strong>
      </header>
      <section className="pairing-panel" aria-live="polite">
        {phase === 'claim' || phase === 'claiming' ? (
          <>
            <span className="pairing-leading"><Smartphone aria-hidden="true" size={24} /></span>
            <p className="eyebrow">连接这台电脑</p>
            <h1>确认手机名称</h1>
            <label className="pairing-field">
              <span>设备名称</span>
              <input
                autoComplete="name"
                maxLength={128}
                value={label}
                onChange={event => { setLabel(event.target.value) }}
              />
            </label>
            <button className="button primary pairing-submit" type="button" disabled={phase === 'claiming' || label.trim() === ''} onClick={() => { void submit() }}>
              {phase === 'claiming' ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <ShieldCheck aria-hidden="true" size={18} />}
              {phase === 'claiming' ? '正在连接' : '请求配对'}
            </button>
          </>
        ) : phase === 'waiting' && claim !== undefined ? (
          <>
            <span className="pairing-leading waiting"><LoaderCircle className="spin" aria-hidden="true" size={24} /></span>
            <p className="eyebrow">等待电脑确认</p>
            <h1>核对这组六位码</h1>
            <output className="verification-code" aria-label="配对核对码">{claim.verificationCode}</output>
            <p className="pairing-status">电脑上显示相同号码后批准此设备</p>
            {networkWarning && <p className="inline-error"><CircleAlert aria-hidden="true" size={16} />连接暂时中断，正在重试</p>}
          </>
        ) : phase === 'approved' ? (
          <>
            <span className="pairing-leading approved"><CheckCircle2 aria-hidden="true" size={25} /></span>
            <p className="eyebrow">可信连接已建立</p>
            <h1>正在打开 Companion</h1>
            <p className="pairing-status">这台手机获得 Session 只读权限</p>
          </>
        ) : (
          <>
            <span className="pairing-leading failed"><CircleAlert aria-hidden="true" size={25} /></span>
            <p className="eyebrow error">无法完成配对</p>
            <h1>{error ?? '配对请求已失效'}</h1>
          </>
        )}
      </section>
    </main>
  )
}
