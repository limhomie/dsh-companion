# Android 原生连接

Android 平台 Provider 使用系统 Keystore 中不可导出的 P-256 私钥完成设备配对和签名挑战。Harness 返回的短时传输会话只保存在当前 WebView 内存中；非敏感的 Host Origin、设备 ID 与显示名称由原生插件持久化。

首次连接时，Android 扫码 Provider 或粘贴降级入口把电脑端生成的完整链接交给本包；本包只接受包含一次性 Offer UUID 的 HTTPS Origin，再把公钥与设备名称提交给 Harness，并显示与电脑待批准列表相同的六位码。批准不会向 App 发放长期 Bearer；以后每次冷启动都使用同一不可导出密钥完成新的持钥证明。网络或 Host 暂时不可达时，重试认证保留原生元数据与 Keystore 密钥；只有经过二次确认的“删除配对”才会清除这些状态并要求重新配对。

HTTP 通过 Capacitor 官方原生 Fetch 载体访问已配对 Host，并携带短时会话。每个原生认证与配对请求由 Client 拥有 AbortController 和 12 秒超时；关闭会中止并等待全部在途请求。每个 WebSocket 在打开前换取一次性票据，票据只进入 `Sec-WebSocket-Protocol` 握手头，不进入 URL。Provider 复用 Harness Connection 的重连控制器；短会话返回 401 时，共享的重新认证流程只执行一次 Keystore Challenge，再用新会话重试尚未分发的请求。销毁时清除内存会话与监听器，但保留 Keystore 设备身份，供下一次前台启动重新认证。
