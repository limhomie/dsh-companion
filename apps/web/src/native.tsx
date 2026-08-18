import { PanelsTopLeft, ShieldCheck } from 'lucide-react'

/** Native launch state until a key-bound device credential provider is available. */
export function NativeShellPage() {
  return (
    <main className="pairing-page native-shell-page">
      <header className="pairing-brand">
        <span className="brand-mark"><PanelsTopLeft aria-hidden="true" size={20} /></span>
        <strong>DSH Companion</strong>
      </header>
      <section className="pairing-panel" aria-live="polite">
        <span className="pairing-leading unpaired"><ShieldCheck aria-hidden="true" size={24} /></span>
        <p className="eyebrow">Android 预览</p>
        <h1>安全连接尚未启用</h1>
        <p className="pairing-status pairing-instructions">此版本不会连接 Harness，也不会读取或保存 Harness、模型或设备凭据。当前请使用电脑提供的 PWA 完成配对。</p>
      </section>
    </main>
  )
}
