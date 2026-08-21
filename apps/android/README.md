# Android App

Capacitor 8 原生外壳。`www/` 来自 `@dsh-companion/web` 的 `native` 构建，不是手工维护的第二套界面。

当前原生入口使用 Android Keystore 中不可导出的 P-256 密钥认领电脑端配对 Offer。首次连接以 Capacitor 原生相机扫描为主，粘贴完整配对链接为降级入口；两者只接受包含一次性 Offer UUID 的 HTTPS 链接。电脑核对六位码并批准后，App 通过签名 Challenge 换取内存短会话，再启动与 Web 相同的 Harness Runtime 与功能插件。原生 Owner 可以选择 Host 已注册 Workspace、创建或复用空白 Session、发送消息并停止运行；App 不在手机上挂载或注册新 Workspace。Host 暂时不可达时可重试且不会删除配对，显式删除需要二次确认；错误服务、不兼容响应、撤销和 Keystore 失败分别显示恢复动作。通知和应用生命周期 Provider 是后续平台扩展点。官方扫码 Provider 要求 Android API 26 以上。

从仓库根目录运行 `pnpm android:sync` 构建 Web 资源并同步 Android 工程，运行 `pnpm android:apk` 构建本地 Debug APK，运行 `pnpm android:release` 构建已配置签名的版本化 Universal APK，运行 `pnpm android:open` 在 Android Studio 中打开工程。环境要求和发布约定见 [`docs/mobile.zh.md`](../../docs/mobile.zh.md)。
