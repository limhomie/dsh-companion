# Settings UI

注册 `/settings` 页面。电脑回环页面通过 `ctx.companionDeviceTrust` 创建二维码邀请、批准核对码并撤销设备；已配对手机只显示 `session:read` 授权。Harness 持有设备记录和配对状态，UI 不复制凭据或设备身份。
