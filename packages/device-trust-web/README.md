# 浏览器设备信任

提供 `ctx.companionDeviceTrust`，封装 Harness 设备配对 HTTP 协议、网络响应校验、同源 Cookie 请求和插件卸载时的请求取消。凭据由浏览器作为 HttpOnly Cookie 管理，本 Package 不读取或持久保存凭据。

`DeviceTrustHttpClient` 也供 Client Runtime 启动前的扫码落地页使用。调用方销毁时必须等待 `close()`，使领取和轮询请求收敛到同一个生命周期完成点。
