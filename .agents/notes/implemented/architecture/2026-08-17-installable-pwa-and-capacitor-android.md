# Agent Note: 可安装 PWA 与 Capacitor Android 外壳

Status: implemented

## Problem

Companion 的手机入口只能作为普通网页打开，不能安装到主屏幕，也没有可重复构建的 Android 工程。浏览器配对凭据又是 Host 同源的 HttpOnly Cookie；如果原生 WebView 直接把本地页面连到远端 Host，会失去同源保护并在原生凭据协议完成前制造一条不安全的认证路径。

## Decision

Host-served Web 构建在 `/companion/` 下发布 Web App Manifest、带图像 MIME 类型的图标和 Workbox Service Worker。Service Worker 只预缓存当前构建生成的 HTML、JavaScript、CSS 与图标，不注册 API 或 WebSocket 的运行时缓存；旧预缓存随新构建清理。Manifest 的启动入口是 `/companion/`，应用作用域覆盖同源根路径，使经过认证的 Owner 可以继续进入官方 Harness Web 客户端，而 Service Worker 的控制范围仍限制在 `/companion/`。`/companion/?install=1` 在设备信任启动前提供稳定安装入口，捕获浏览器的安装请求并由明确按钮提交；这样 Owner 不会在安装完成前被转交到使用另一份 Manifest 的 Harness 根页面。入口使用带随机查询的 Manifest 请求确认 Tailscale Origin 实时可达，不允许从离线静态缓存发起安装。浏览器和系统桌面管理安装窗口及桌面快捷方式权限；Chrome 接受安装请求或发送 `appinstalled` 只会记录当前安装事务。Manifest 的自身关联和 `getInstalledRelatedApps()` 返回已安装 Web App，或该事务之后的独立显示模式启动写入同源确认时间，入口才报告安装完成。没有确认时页面持续保留检测操作，不以超时推断安装失败或重新提交安装请求。

同一 Vite 入口增加 `native` 构建目标，使用相对资源路径并输出到 `apps/android/www`。Capacitor 8 Android 工程从该目录同步资源。原生运行时在装载 Harness Connection 前显示安全连接未启用状态，不发送 Harness 请求，也不读取或保存浏览器设备 Cookie、Harness Credential 或模型 Credential。原生密钥绑定认证完成后，这个分支负责注册原生平台 Provider，再进入与 Web 相同的 Runtime 和功能插件图。

Android 工程是可提交的源文件。根脚本提供 Web 资源构建、`cap sync android`、Android Studio 打开和 Gradle Debug APK 构建；Debug APK 使用 Android 自动生成的调试签名，仅供本地验证。

扫码、通知、应用生命周期与后台重连、安全凭据存储分别接入 Capacitor 平台插件。功能插件继续只依赖 Companion/Harness 能力接口，不直接导入 Capacitor API。APK 下载入口由 GitHub Release 资产提供，不由 Harness Host 动态下发可执行代码。

GitHub Actions 暂不加入仓库。当前 Companion 构建精确锁定 Harness 的本地提交 `2a8d995b4b43a4f308143a40ed1fcf9e633aac47`，远端 Runner 无法检出该提交；仓库也没有 Android Release 签名密钥约定。发布流程在该提交可由 Runner 获取并建立仓库级密钥策略后启用：Pull Request 构建 Debug APK，版本 Tag 构建签名 Release APK，把 APK 与 SHA-256 摘要发布到 GitHub Releases。Keystore 以 Base64 GitHub Actions Secret 注入临时目录，密码和 Alias 使用独立 Secret，任务结束后不上传 Keystore 或 Gradle 签名配置。

## Alternatives considered

**让 Capacitor `server.url` 指向 Tailscale Host。** Capacitor 将该配置定位为 Live Reload，明确不用于生产。它还会让签名 App 执行 Host 下发的客户端代码，与原生发布只执行随 APK 签名代码的安全要求冲突。

**从本地 WebView 跨域调用 Host 并复用 Cookie。** 当前 Cookie 使用 `SameSite=Strict` 且 JavaScript 不可读。放宽 Cookie 或把 Bearer Token 交给 UI 会削弱已经实现的浏览器安全模型。

**立即提交只产出未签名 APK 的 Release 工作流。** 未签名产物不能成为稳定升级路径，且 Runner 当前无法获得精确锁定的 Harness 源码。保留经过检查的发布设计比提交必然失败的工作流更明确。

## Verification

- 生产 Web 构建检查 Manifest、图标、Service Worker、注册脚本、作用域和缓存产物。
- Playwright 检查专用安装入口不启动 Harness 请求、拒绝离线缓存安装、能提交浏览器安装请求、等待事务之后的独立窗口启动，并在安装窗口被关闭后保留重试操作。
- Playwright 在 390x844、430x932 与 1280x800 视口继续运行真实 App Entry，并检查 Manifest 可达、移动端无横向溢出和现有配对/Session 流程。
- Native Vite 构建检查相对资源路径和原生安全状态；`cap sync android` 证明同一产物可以复制到官方 Android 工程。
- 安装 Android SDK 的环境运行 Gradle `assembleDebug` 并输出 Debug APK；缺少 SDK 的环境只执行 Web 构建与 Capacitor 同步，并报告环境缺口。

## Consequences

- 浏览器 PWA 是当前可连接、配对和控制 Harness 的安装路径。
- Viewer 与 Owner 都从 `/companion/?install=1` 安装同一个 PWA；安装后 Owner 仍由 `/companion/` 转交到官方 Harness 客户端。
- Android 工程已经可同步和构建，但 APK 在原生密钥绑定认证完成前不连接 Harness。
- PWA 离线时只能打开已缓存的静态界面；Session、配对、授权和操作始终需要在线 Host，Service Worker 不返回缓存的敏感 API 数据。
- Harness 和模型 Credential 始终留在电脑。未来原生设备凭据是独立、可撤销、密钥绑定的设备身份，只保存在 Android Keystore 后面的平台 Provider 中。
