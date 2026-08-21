import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  CircleAlert,
  ClipboardPaste,
  Link,
  LoaderCircle,
  PanelsTopLeft,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react'
import type { ClaimPairingResponse } from '@dsh-companion/device-trust-connection'
import { DeviceTrustClientError } from '@dsh-companion/device-trust-web'
import {
  NativeConnectionClient,
  NativePairingUrlError,
  parseNativePairingUrl,
  type NativeDevicePrincipal,
} from '@dsh-companion/native-connection'
import { NativePairingScannerError, scanNativePairingUrl } from './native-scanner.ts'

const POLL_INTERVAL_MS = 2_000

type NativePhase = 'starting' | 'unpaired' | 'claiming' | 'waiting' | 'connecting' | 'failed'

interface NativeFailure {
  readonly title: string
  readonly detail: string
  readonly recovery: 'retry' | 'repair'
}

function nativeFailure(error: unknown): NativeFailure {
  if (error instanceof DeviceTrustClientError) {
    switch (error.code) {
      case 'offer-not-found': return {
        title: '配对二维码已经失效',
        detail: '请在电脑的 Companion 设置中重新生成二维码。',
        recovery: 'retry',
      }
      case 'offer-expired':
      case 'claim-expired': return {
        title: '配对二维码已经过期',
        detail: '电脑不会再接受这次请求，请重新生成二维码。',
        recovery: 'retry',
      }
      case 'device-not-found':
      case 'device-revoked': return {
        title: '这台手机的授权已失效',
        detail: '电脑已撤销或清理了该设备，需要删除本机配对后重新扫码。',
        recovery: 'repair',
      }
      case 'native-signature-invalid': return {
        title: '设备密钥无法通过验证',
        detail: 'Android Keystore 身份与电脑记录不一致，需要重新配对。',
        recovery: 'repair',
      }
      case 'request-timeout': return {
        title: '连接电脑超时',
        detail: '确认电脑上的 Companion Host 正在运行，并检查手机的 Tailscale 连接。',
        recovery: 'retry',
      }
      default:
        if (error.kind === 'network') return {
          title: '无法到达电脑',
          detail: '确认手机已连接 Tailscale，且电脑上的 Companion Host 可以访问。',
          recovery: 'retry',
        }
        if (error.kind === 'invalid-response') {
          const isCompatibleStatus = error.status === undefined || (error.status >= 200 && error.status < 300)
          return {
            title: isCompatibleStatus ? 'Host 响应不兼容' : '当前地址不是 Companion Host',
            detail: isCompatibleStatus
              ? '电脑端版本与这台 App 不兼容，请更新后重试。'
              : '这个 Origin 返回了其他服务，请在该地址启动 Companion Host。',
            recovery: 'retry',
          }
        }
        return {
          title: '设备认证被拒绝',
          detail: '电脑可以到达，但没有接受当前身份。请检查设备授权后重试。',
          recovery: 'retry',
        }
    }
  }
  return {
    title: '无法连接 Harness',
    detail: error instanceof Error ? error.message : 'Android 连接启动失败，请重试。',
    recovery: 'retry',
  }
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
  const [showPaste, setShowPaste] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [pairingIssue, setPairingIssue] = useState<string>()
  const [claim, setClaim] = useState<ClaimPairingResponse>()
  const [failure, setFailure] = useState<NativeFailure>()
  const [hasSavedConnection, setHasSavedConnection] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

  const connect = async (): Promise<void> => {
    setFailure(undefined)
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
        setFailure(nativeFailure(cause))
        setPhase('failed')
      }
    }).catch(cause => {
      if (!active) return
      setFailure(nativeFailure(cause))
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
          setFailure({
            title: '电脑拒绝了配对',
            detail: '请核对六位码后，在电脑设置中重新生成二维码。',
            recovery: 'retry',
          })
          setPhase('failed')
        }
      } catch (cause) {
        if (!active) return
        if (!(cause instanceof DeviceTrustClientError && cause.kind === 'network')) {
          setFailure(nativeFailure(cause))
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

  const claimOffer = async (value: string): Promise<void> => {
    try {
      parseNativePairingUrl(value)
    } catch (cause) {
      setPairingIssue(cause instanceof NativePairingUrlError ? cause.message : '无法读取这个配对链接')
      setPhase('unpaired')
      return
    }
    setPhase('claiming')
    setFailure(undefined)
    setPairingIssue(undefined)
    try {
      setClaim(await client.claimPairingUrl(value))
      setPhase('waiting')
    } catch (cause) {
      setFailure(nativeFailure(cause))
      setPhase('failed')
    }
  }

  const scanAndClaim = async (): Promise<void> => {
    setScanning(true)
    setPairingIssue(undefined)
    try {
      const value = await scanNativePairingUrl()
      if (value === undefined) return
      setPairingUrl(value)
      await claimOffer(value)
    } catch (cause) {
      setPairingIssue(cause instanceof NativePairingScannerError ? cause.message : '无法打开扫码器，请改用粘贴配对链接')
    } finally {
      setScanning(false)
    }
  }

  const reset = async (): Promise<void> => {
    setConfirmingReset(false)
    try {
      await client.reset()
      setHasSavedConnection(false)
      setClaim(undefined)
      setPairingUrl('')
      setPairingIssue(undefined)
      setFailure(undefined)
      setPhase('unpaired')
    } catch (cause) {
      setFailure(nativeFailure(cause))
      setPhase('failed')
    }
  }

  const retryConnection = async (): Promise<void> => {
    setConfirmingReset(false)
    try {
      await connect()
    } catch (cause) {
      setFailure(nativeFailure(cause))
      setPhase('failed')
    }
  }

  const returnToPairing = (): void => {
    setClaim(undefined)
    setPairingIssue(undefined)
    setFailure(undefined)
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
            <button className="button primary pairing-submit native-scan-button" type="button" disabled={phase === 'claiming' || scanning} onClick={() => { void scanAndClaim() }}>
              {phase === 'claiming' || scanning ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <ScanLine aria-hidden="true" size={18} />}
              {scanning ? '正在打开相机' : phase === 'claiming' ? '正在请求配对' : '扫描电脑二维码'}
            </button>
            <button className="button secondary native-paste-toggle" type="button" aria-expanded={showPaste} onClick={() => { setShowPaste(value => !value) }}>
              <ClipboardPaste aria-hidden="true" size={17} />{showPaste ? '收起链接输入' : '改用粘贴配对链接'}
            </button>
            {showPaste && (
              <div className="native-paste-panel">
                <label className="pairing-field">
                  <span>配对链接</span>
                  <input
                    autoCapitalize="none"
                    autoCorrect="off"
                    inputMode="url"
                    placeholder="https://电脑地址/companion/?pair=..."
                    value={pairingUrl}
                    onChange={event => {
                      setPairingUrl(event.target.value)
                      setPairingIssue(undefined)
                    }}
                  />
                </label>
                <button className="button secondary pairing-link-submit" type="button" disabled={phase === 'claiming' || scanning || pairingUrl.trim() === ''} onClick={() => { void claimOffer(pairingUrl) }}>
                  <Link aria-hidden="true" size={17} />验证并配对
                </button>
              </div>
            )}
            {pairingIssue !== undefined && <p className="inline-error native-pairing-error" role="alert"><CircleAlert aria-hidden="true" size={16} />{pairingIssue}</p>}
            <p className="pairing-status pairing-instructions">在电脑的 Companion 设置中生成二维码，再用这台手机扫描。</p>
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
            <h1>{failure?.title ?? '无法连接 Harness'}</h1>
            <p className="pairing-status native-failure-detail">{failure?.detail ?? '请检查电脑端服务后重试。'}</p>
            {hasSavedConnection ? (
              <div className="native-recovery-actions">
                <p className="pairing-status">原配对仍保存在这台手机上</p>
                {failure?.recovery !== 'repair' && (
                  <button className="button primary pairing-submit" type="button" onClick={() => { void retryConnection() }}>
                    <RotateCcw aria-hidden="true" size={18} />重试连接
                  </button>
                )}
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
