# 手机配对界面

在 Harness Client Runtime 启动前处理手机信任状态。`/companion/?pair=<offer-id>` 页面领取一次性 Claim、展示六位核对码、等待电脑批准，并在 Host 写入 HttpOnly Cookie 后回到 Companion；没有有效设备 Cookie 的非回环入口显示重新配对引导。Claim Secret 仅存在于组件内存中。
