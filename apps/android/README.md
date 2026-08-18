# Android App

Capacitor 8 原生外壳。`www/` 来自 `@dsh-companion/web` 的 `native` 构建，不是手工维护的第二套界面。

当前原生入口在 Harness Connection 启动前停在安全状态；浏览器 PWA 是可连接和配对的手机入口。原生密钥绑定设备身份完成后，由此 App 组合二维码、通知、应用生命周期、后台重连和 Android Keystore Provider，再启动同一套 Runtime 与功能插件。

从仓库根目录运行 `pnpm android:sync` 构建 Web 资源并同步 Android 工程，运行 `pnpm android:apk` 构建本地 Debug APK，运行 `pnpm android:open` 在 Android Studio 中打开工程。环境要求和发布约定见 [`docs/mobile.zh.md`](../../docs/mobile.zh.md)。
