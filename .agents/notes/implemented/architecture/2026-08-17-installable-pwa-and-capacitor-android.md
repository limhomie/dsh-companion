# Agent Note: 可安装 PWA 与 Capacitor Android 外壳

Status: implemented

## Problem

Companion 的手机入口只能作为普通网页打开，不能安装到主屏幕，也没有可重复构建的 Android 工程。浏览器配对凭据又是 Host 同源的 HttpOnly Cookie；如果原生 WebView 直接把本地页面连到远端 Host，会失去同源保护并在原生凭据协议完成前制造一条不安全的认证路径。

## Decision

Host-served Web 构建在 `/companion/` 下发布 Web App Manifest、带图像 MIME 类型的图标和 Workbox Service Worker。Service Worker 只预缓存当前构建生成的 HTML、JavaScript、CSS 与图标，不注册 API 或 WebSocket 的运行时缓存；旧预缓存随新构建清理。Manifest 的启动入口是 `/companion/`，应用作用域覆盖同源根路径，使经过认证的 Owner 可以继续进入官方 Harness Web 客户端，而 Service Worker 的控制范围仍限制在 `/companion/`。`/companion/?install=1` 在设备信任启动前提供稳定安装入口，捕获浏览器的安装请求并由明确按钮提交；这样 Owner 不会在安装完成前被转交到使用另一份 Manifest 的 Harness 根页面。入口使用带随机查询的 Manifest 请求确认 Tailscale Origin 实时可达，不允许从离线静态缓存发起安装。浏览器和系统桌面管理安装窗口及桌面快捷方式权限；Chrome 接受安装请求或发送 `appinstalled` 只会记录当前安装事务。Manifest 的自身关联和 `getInstalledRelatedApps()` 返回已安装 Web App，或该事务之后的独立显示模式启动写入同源确认时间，入口才报告安装完成。没有确认时页面持续保留检测操作，不以超时推断安装失败或重新提交安装请求。

同一 Vite 入口增加 `native` 构建目标，使用相对资源路径并输出到 `apps/android/www`。Capacitor 8 Android 工程从该目录同步资源。原生运行时先加载 Android Keystore 身份 Provider：首次连接用不可导出的 P-256 公钥认领电脑 Offer，批准后签署 Harness 的单次 Challenge，换取只存在于 WebView 内存的短会话。HTTP 通过 Capacitor 官方原生 Fetch 携带短会话；每条 WebSocket 先领取一次性 Ticket，并只在 `Sec-WebSocket-Protocol` 握手头中发送。认证完成后，入口向共享启动函数提供原生 Connection 与设备信任实现，再进入与 Web 相同的 Runtime 和功能插件图。

Android 只持久化 Host Origin、设备 id 和名称等非敏感连接信息；P-256 私钥保持在 Android Keystore 且不可导出。Harness 持久设备记录只保存对应公钥。浏览器 Cookie、Harness Credential、模型 Credential、原生短会话和 WebSocket Ticket 都不会写入手机持久存储。重置原生连接会删除 Keystore 密钥并要求重新配对。

Android 工程是可提交的源文件。根脚本提供 Web 资源构建、`cap sync android`、Android Studio 打开、Gradle Debug APK 与已签名 Release APK 构建；Debug APK 使用 Android 自动生成的调试签名，仅供本地验证。Release 构建只从环境变量读取 Keystore 路径、密码和 Alias；缺少任何一项时安全失败。签名后的单一 Universal APK 与 SHA-256 摘要输出到已忽略的 `dist/releases/android-v{version}/`。

Android 首次连接以相机扫描电脑设置页生成的二维码为主入口，粘贴完整配对链接保留为明确的降级入口。扫码 Provider 使用 Capacitor 官方 Barcode Scanner，只返回二维码文本；入口随后仍通过既有解析器验证完整 HTTPS Origin、一次性 Offer UUID，并进入相同的 Keystore 公钥 Claim、六位码核对和本机批准流程。取消扫码不改变页面或密钥状态；相机权限被拒、Provider 不可用和二维码内容不合法分别显示可恢复诊断，用户可以重试扫码或改用粘贴。扫码文本、Offer secret 和 Claim secret 都不持久化，也不进入日志。Android 最低系统版本随官方 Provider 要求提高到 API 26。

设置页把 Host 握手、手机访问 Origin、二维码有效期、待批准 Claim 和已配对设备放在同一个“手机访问”工作面中；这些均派生自现有 Host 描述、Offer 和设备信任响应，不建立第二份连接状态。通知、应用生命周期与后台重连继续保留 Capacitor 平台 Provider 扩展点。功能插件继续只依赖 Companion/Harness 能力接口，不直接导入 Capacitor API。APK 下载入口由 GitHub Release 资产提供，不由 Harness Host 动态下发可执行代码。

GitHub Actions 暂不加入仓库。当前 Companion 构建精确锁定 Harness 的本地提交 `f652a3263943a26ebfa3f0945230c1f40884637d`，远端 Runner 无法检出该提交。首个 Android 版本由本机受保护的 Keystore 签名，并手动上传 APK 与 SHA-256 到 GitHub Pre-release。该提交可由 Runner 获取后，自动发布使用受保护的 GitHub Environment：Pull Request 构建 Debug APK，版本 Tag 构建签名 Release APK，把 APK 与 SHA-256 摘要发布到 GitHub Releases。Keystore 以 Base64 GitHub Actions Secret 注入临时目录，密码和 Alias 使用独立 Secret，任务结束后不上传 Keystore 或 Gradle 签名配置。

## Alternatives considered

**让 Capacitor `server.url` 指向 Tailscale Host。** Capacitor 将该配置定位为 Live Reload，明确不用于生产。它还会让签名 App 执行 Host 下发的客户端代码，与原生发布只执行随 APK 签名代码的安全要求冲突。

**从本地 WebView 跨域调用 Host 并复用 Cookie。** 当前 Cookie 使用 `SameSite=Strict` 且 JavaScript 不可读。放宽 Cookie 或把 Bearer Token 交给 UI 会削弱已经实现的浏览器安全模型。

**在 WebView 中自行绘制持续相机预览。** 这会让页面拥有相机生命周期、权限和帧处理责任，并扩大 Web 端测试与后台切换范围。当前只需要一次性读取二维码，使用系统原生扫码界面更符合能力边界。

**立即提交只产出未签名 APK 的 Release 工作流。** 未签名产物不能成为稳定升级路径，且 Runner 当前无法获得精确锁定的 Harness 源码。保留经过检查的发布设计比提交必然失败的工作流更明确。

## Verification

- 生产 Web 构建检查 Manifest、图标、Service Worker、注册脚本、作用域和缓存产物。
- Playwright 检查专用安装入口不启动 Harness 请求、拒绝离线缓存安装、能提交浏览器安装请求、等待事务之后的独立窗口启动，并在安装窗口被关闭后保留重试操作。
- Playwright 在 390x844、430x932 与 1280x800 视口继续运行真实 App Entry，并检查 Manifest 可达、移动端无横向溢出和现有配对/Session 流程。
- Native Vite 构建检查相对资源路径、扫码主操作、粘贴降级和未配对输入状态；Playwright 通过模拟原生 Provider 覆盖扫码成功、取消、无效内容与不可用错误；`cap sync android` 证明同一产物和扫码 Provider 可以复制到官方 Android 工程。
- Harness 聚焦测试使用真实 P-256 签名覆盖公钥配对、单次 Challenge、短会话和一次性 WebSocket Ticket；Android 真机完成配对批准、Viewer 连接、Owner 权限替换及自动重连。
- 安装 Android SDK 的环境运行 Gradle `assembleDebug` 并输出 Debug APK；缺少 SDK 的环境只执行 Web 构建与 Capacitor 同步，并报告环境缺口。
- Release 构建在签名配置不完整时拒绝产物；配置完整时生成签名 Universal APK 和可独立校验的 SHA-256 摘要。

## Consequences

- 浏览器 PWA 是当前可连接、配对和控制 Harness 的安装路径。
- Viewer 与 Owner 都从 `/companion/?install=1` 安装同一个 PWA；安装后 Owner 仍由 `/companion/` 转交到官方 Harness 客户端。
- Android 工程已经可同步和构建；Debug 与正式签名使用不同证书，首次切换需要卸载 Debug 版并重新配对，后续正式版使用同一 Keystore 覆盖升级。APK 通过原生密钥绑定认证连接真实 Harness Runtime，未配对时不发送 Session 请求。
- PWA 离线时只能打开已缓存的静态界面；Session、配对、授权和操作始终需要在线 Host，Service Worker 不返回缓存的敏感 API 数据。
- Harness 和模型 Credential 始终留在电脑。原生设备身份独立、可撤销且绑定 Android Keystore 密钥；派生的传输会话短时且仅存于内存。
