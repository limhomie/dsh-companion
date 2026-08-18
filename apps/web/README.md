# Web App

真实 Companion App Entry。它创建 Cordis Context，按 Harness 的公开依赖顺序装载 Typert Registry、Client Connection、API Gateway、Remotes 与 Client Runtime，再装载 Companion UI 插件并挂载 `AppShell`。入口不包含收件箱、Session 或 Interaction 业务分支。

生产 Web 构建输出到 `packages/host-web/web-dist`，由 Harness 同源提供，并包含 PWA Manifest、图标和限定在 `/companion/` 的静态资源 Service Worker。`/companion/?install=1` 在装载设备信任前提交浏览器安装请求，使 Owner 不会提前跳到 Harness 根页面。Chrome 接收请求后，入口等待新桌面入口至少以独立显示模式启动一次；支持 Installed Related Apps API 的浏览器也可以直接完成确认。`native` 构建使用相对资源路径输出到 `apps/android/www`，由 Capacitor 同步；原生入口先完成 Android Keystore 密钥绑定认证，再向同一启动函数提供原生 Connection 与设备信任实现并装载共享 Runtime。

根目录 `pnpm dev` 只用于 `?fixture` 无密钥预览；真实 Web 入口通过 `pnpm host` 启动。手机安装、Android 构建和安全限制见 [`docs/mobile.zh.md`](../../docs/mobile.zh.md)。
