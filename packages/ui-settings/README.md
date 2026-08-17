# Settings UI

注册 `/settings` 页面。电脑回环页面通过 `ctx.companionDeviceTrust` 创建二维码邀请、批准核对码、撤销设备，并在独立的风险确认后把 Viewer 提升为 Owner；关闭完整控制会降回 Viewer，并立即终止该设备的活动连接。已配对手机只显示自己的当前访问级别。Harness 持有设备记录和配对状态，UI 不复制凭据或设备身份。
