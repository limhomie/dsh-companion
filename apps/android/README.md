# Android App

Capacitor 8 原生外壳。`www/` 来自 `@dsh-companion/web` 的 `native` 构建，不是手工维护的第二套界面。

当前原生入口使用 Android Keystore 中不可导出的 P-256 密钥认领电脑端配对 Offer。电脑核对六位码并批准后，App 通过签名 Challenge 换取内存短会话，再启动与 Web 相同的 Harness Runtime 与功能插件。当前以粘贴完整配对链接完成认领；相机扫码、通知和应用生命周期 Provider 是后续平台扩展点。

从仓库根目录运行 `pnpm android:sync` 构建 Web 资源并同步 Android 工程，运行 `pnpm android:apk` 构建本地 Debug APK，运行 `pnpm android:open` 在 Android Studio 中打开工程。环境要求和发布约定见 [`docs/mobile.zh.md`](../../docs/mobile.zh.md)。
