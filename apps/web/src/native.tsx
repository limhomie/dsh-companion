import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  Link,
  LoaderCircle,
  PanelsTopLeft,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react'
import type { ClaimPairingResponse } from '@deepseek-ai/dsh-device-trust-connection'
import { DeviceTrustClientError } from '@dsh-companion/device-trust-web'
import { NativeConnectionClient, type NativeDevicePrincipal } from '@dsh-companion/native-connection'

const POLL_INTERVAL_MS = 2_000

type NativePhase = 'starting' | 'unpaired' | 'claiming' | 'waiting' | 'connecting' | 'failed'

function nativeError(error: unknown): string {
  if (error instanceof DeviceTrustClientError) {
    switch (error.code) {
      case 'offer-not-found': return '配对链接不存在或已经使用，请在电脑上重新创建'
      case 'offer-expired':
      case 'claim-expired': return '配对链接已经过期，请在电脑上重新创建'
      case 'device-revoked': return '这台 Android 设备已经被撤销'
      case 'native-signature-invalid': return 'Android Keystore 身份校验失败'
      default: return error.kind === 'network' ? '无法连接电脑，请检查 Tailscale' : error.message
    }
  }
  return error instanceof Error ? error.message : 'Android 连接失败'
}

/** Android key-bound pairing and startup page. */
export function NativeShellPage({
  onConnected,
}: {
  onConnected(client: NativeConnectionClient, device: NativeDevicePrincipal): Promise<void>
}) {
  const clientRef = useRef<NativeConnectionClient>()
  if (clientRef.current === undefined) clientRef.current = new NativeConnectionClient()
  const client = clientRef.current
  const transferred = useRef(false)
  const [phase, setPhase] = useState<NativePhase>('starting')
  const [pairingUrl, setPairingUrl] = useState('')
  const [claim, setClaim] = useState<ClaimPairingResponse>()
  const [error, setError] = useState<string>()
  const [hasSavedConnection, setHasSavedConnection] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

  const connect = async (): Promise<void> => {
    setError(undefined)
    setPhase('connecting')
    const device = await client.authenticate()
    transferred.current = true
    await onConnected(client, device)
  }

  useEffect(() => {
    let active = true
    void client.loadBinding().then(async binding => {
      if (!active) return
      if (binding === undefined) {
        setPhase('unpaired')
        return
      }
      setHasSavedConnection(true)
      try {
        await connect()
      } catch (cause) {
        if (!active) return
        setError(nativeError(cause))
        setPhase('failed')
      }
    }).catch(cause => {
      if (!active) return
      setError(nativeError(cause))
      setPhase('failed')
    })
    return () => {
      active = false
      if (!transferred.current) client.close()
    }
  }, [client])

  useEffect(() => {
    if (phase !== 'waiting' || claim === undefined) return
    let active = true
    let polling = false
    const poll = async (): Promise<void> => {
      if (!active || polling) return
      polling = true
      try {
        const result = await client.finishPairing(claim.claimId, claim.claimSecret)
        if (!active) return
        if (result.status === 'approved') {
          setHasSavedConnection(true)
          await connect()
        }
        if (result.status === 'rejected') {
          setError('电脑端没有批准这次配对')
          setPhase('failed')
        }
      } catch (cause) {
        if (!active) return
        if (!(cause instanceof DeviceTrustClientError && cause.kind === 'network')) {
          setError(nativeError(cause))
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

  const claimOffer = async (): Promise<void> => {
    setPhase('claiming')
    setError(undefined)
    try {
      setClaim(await client.claimPairingUrl(pairingUrl))
      setPhase('waiting')
    } catch (cause) {
      setError(nativeError(cause))
      setPhase('failed')
    }
  }

  const reset = async (): Promise<void> => {
    setConfirmingReset(false)
    try {
      await client.reset()
      setHasSavedConnection(false)
      setClaim(undefined)
      setPairingUrl('')
      setError(undefined)
      setPhase('unpaired')
    } catch (cause) {
      setError(nativeError(cause))
      setPhase('failed')
    }
  }

  const retryConnection = async (): Promise<void> => {
    setConfirmingReset(false)
    try {
      await connect()
    } catch (cause) {
      setError(nativeError(cause))
      setPhase('failed')
    }
  }

  const returnToPairing = (): void => {
    setClaim(undefined)
    setError(undefined)
    setPhase('unpaired')
  }

  return (
    <main className="pairing-page native-shell-page">
      <header className="pairing-brand">
        <span className="brand-mark"><PanelsTopLeft aria-hidden="true" size={20} /></span>
        <strong>DSH Companion</strong>
      </header>
      <section className="pairing-panel" aria-live="polite">
        {phase === 'starting' || phase === 'connecting' ? (
          <>
            <span className="pairing-leading waiting"><LoaderCircle className="spin" aria-hidden="true" size={24} /></span>
            <p className="eyebrow">Android 安全连接</p>
            <h1>{phase === 'starting' ? '正在读取设备身份' : '正在连接 Harness'}</h1>
            <p className="pairing-status">通过 Android Keystore 验证这台手机</p>
          </>
        ) : phase === 'unpaired' || phase === 'claiming' ? (
          <>
            <span className="pairing-leading"><Smartphone aria-hidden="true" size={24} /></span>
            <p className="eyebrow">Android 安全配对</p>
            <h1>连接这台电脑</h1>
            <label className="pairing-field">
              <span>配对链接</span>
              <input
                autoCapitalize="none"
                autoCorrect="off"
                inputMode="url"
                placeholder="https://电脑地址/companion/?pair=..."
                value={pairingUrl}
                onChange={event => { setPairingUrl(event.target.value) }}
              />
            </label>
            <button className="button primary pairing-submit" type="button" disabled={phase === 'claiming' || pairingUrl.trim() === ''} onClick={() => { void claimOffer() }}>
              {phase === 'claiming' ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <Link aria-hidden="true" size={18} />}
              {phase === 'claiming' ? '正在请求' : '开始配对'}
            </button>
            <p className="pairing-status pairing-instructions">在电脑 Companion 设置中创建配对二维码，把二维码对应的完整链接粘贴到这里。</p>
          </>
        ) : phase === 'waiting' && claim !== undefined ? (
          <>
            <span className="pairing-leading waiting"><LoaderCircle className="spin" aria-hidden="true" size={24} /></span>
            <p className="eyebrow">等待电脑确认</p>
            <h1>核对这组六位码</h1>
            <output className="verification-code" aria-label="配对核对码">{claim.verificationCode}</output>
            <p className="pairing-status">电脑上显示相同号码后批准此设备</p>
          </>
        ) : (
          <>
            <span className="pairing-leading failed"><CircleAlert aria-hidden="true" size={24} /></span>
            <p className="eyebrow error">Android 连接失败</p>
            <h1>{error ?? '无法连接 Harness'}</h1>
            {hasSavedConnection ? (
              <div className="native-recovery-actions">
                <p className="pairing-status">原配对仍保存在这台手机上</p>
                <button className="button primary pairing-submit" type="button" onClick={() => { void retryConnection() }}>
                  <RotateCcw aria-hidden="true" size={18} />重试连接
                </button>
                {confirmingReset ? (
                  <div className="native-reset-confirm" role="alert">
                    <p>删除后必须在电脑上重新创建并批准配对。</p>
                    <div className="native-reset-buttons">
                      <button className="button secondary" type="button" onClick={() => { setConfirmingReset(false) }}>取消</button>
                      <button className="button danger" type="button" onClick={() => { void reset() }}>
                        <Trash2 aria-hidden="true" size={17} />确认删除
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="button native-reset-button" type="button" onClick={() => { setConfirmingReset(true) }}>
                    <Trash2 aria-hidden="true" size={17} />删除配对
                  </button>
                )}
              </div>
            ) : (
              <button className="button primary pairing-submit" type="button" onClick={returnToPairing}>
                <RotateCcw aria-hidden="true" size={18} />返回配对
              </button>
            )}
          </>
        )}
        {phase === 'waiting'
          ? <CheckCircle2 className="native-key-indicator" aria-label="设备私钥已保存在 Android Keystore" size={18} />
          : phase !== 'failed' && <ShieldCheck className="native-key-indicator" aria-label="Android Keystore 保护" size={18} />}
      </section>
    </main>
  )
}
