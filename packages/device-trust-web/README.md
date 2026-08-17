# 浏览器设备信任

提供 `ctx.companionDeviceTrust`，封装 Harness 设备配对与访问级别 HTTP 协议、网络响应校验、同源 Cookie 请求和插件卸载时的请求取消。服务会读取当前认证设备不含凭据的主体与 `viewer`／`owner` 访问级别，并向 UI 发布变化；凭据由浏览器作为 HttpOnly Cookie 管理，本 Package 不读取或持久保存凭据。

`canPrompt()` 和 `canAnswerInteractions()` 只从当前认证设备访问级别派生；回环页面拥有本机能力，远程页面必须是 Owner。访问级别更新后，Connection 重新认证并刷新当前设备，UI 不持久保存访问副本。

非回环浏览器收到明确的 `401 device-unauthorized` 时，服务发布 `unpaired` 信任状态，使 App Entry 可以在 Client Runtime 启动前显示配对入口。网络失败、其他 HTTP 拒绝和不兼容响应仍然拒绝插件加载。

`DeviceTrustHttpClient` 也供 Client Runtime 启动前的扫码落地页使用。调用方销毁时必须等待 `close()`，使领取和轮询请求收敛到同一个生命周期完成点。
