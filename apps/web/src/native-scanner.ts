import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerTypeHint,
} from '@capacitor/barcode-scanner'

export class NativePairingScannerError extends Error {
  override readonly name = 'NativePairingScannerError'

  constructor(
    readonly kind: 'permission' | 'unavailable' | 'failed',
    message: string,
  ) {
    super(message)
  }
}

function scanFailure(error: unknown): NativePairingScannerError | undefined {
  const message = error instanceof Error ? error.message : String(error)
  if (/cancel(?:led|ed)?|canceled|user closed/i.test(message)) return undefined
  if (/permission|denied|camera access/i.test(message)) {
    return new NativePairingScannerError('permission', '相机权限未开启，请在系统设置中允许相机访问')
  }
  if (/unimplemented|not available|unsupported/i.test(message)) {
    return new NativePairingScannerError('unavailable', '这台设备暂时无法使用扫码，请改用粘贴配对链接')
  }
  return new NativePairingScannerError('failed', '没有读到二维码，请重试或改用粘贴配对链接')
}

/** Invoke the native scanner once; cancellation is a normal empty result. */
export async function scanNativePairingUrl(): Promise<string | undefined> {
  try {
    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
      scanInstructions: '扫描电脑 Companion 设置中的二维码',
      cancelButtonAccessibilityLabel: '取消扫码',
      torchButtonOnAccessibilityLabel: '关闭手电筒',
      torchButtonOffAccessibilityLabel: '打开手电筒',
    })
    return result.ScanResult.trim() || undefined
  } catch (error) {
    const failure = scanFailure(error)
    if (failure === undefined) return undefined
    throw failure
  }
}
