# 手机安装、连接与 Android 构建

本文是 DSH Companion 手机端的操作入口。浏览器 PWA 已经可以安装、连接和配对；Capacitor Android 工程已经可以同步与构建，但在原生密钥绑定设备身份完成前，APK 不连接 Harness。

## 1. 安装并连接 PWA

电脑和手机必须先登录同一个 Tailscale Tailnet。Harness 继续只监听电脑的 `127.0.0.1:3080`，Tailscale Serve 提供私有 HTTPS，不要使用 Funnel，也不要把 3080 直接暴露到局域网或互联网。

在 Windows 管理员 PowerShell 中配置一次 Tailscale Serve：

```powershell
tailscale serve --bg 3080
```

在普通 PowerShell 中从 Companion 仓库启动 Host，其中 Origin 必须替换为 Tailscale 输出的完整 HTTPS Origin：

```powershell
$env:DSH_HOME = 'D:\dsh-companion\.tmp\owner-test-home'
$env:DSH_COMPANION_PUBLIC_ORIGIN = 'https://computer-name.tailnet-name.ts.net'
pnpm host
```

电脑入口是 [http://127.0.0.1:3080/companion/](http://127.0.0.1:3080/companion/)，手机入口是 `https://computer-name.tailnet-name.ts.net/companion/`。在电脑设置页选择“配对新手机”，用手机相机扫描二维码，在手机填写设备名称，并在两边核对相同的六位验证码后才批准。

配对成功后，先在 Tailscale 中确认手机显示“已连接”，再在同一个 Android Chrome 普通标签页打开 `https://computer-name.tailnet-name.ts.net/companion/?install=1`，点击页面中的“安装应用”。专用入口不会因为设备已经提升为 Owner 而提前跳到 Harness 根页面。页面会绕过静态缓存检查 Host 连通性；如果只剩离线缓存，必须恢复 Tailscale 后才能安装。Chrome 接受安装请求并不表示 Android 已经提供可用的桌面入口；页面会提示从手机桌面打开一次 DSH Companion，只有这次独立窗口启动被原安装标签页检测到，或浏览器直接返回已安装 Web App，才显示“已确认安装”。Chrome 只创建桌面快捷方式时不会生成独立 WebAPK Package，这是正常的 PWA 安装形式。HyperOS 还要求 Chrome 拥有“桌面快捷方式”权限；在“设置 > 应用设置 > 应用管理 > Chrome > 权限管理 > 其他权限”中把该权限设为“始终允许”。安装后的入口仍然连接同一 Tailscale HTTPS Origin；Viewer 留在只读 Companion，Owner 进入 Harness 官方客户端。PWA 的 Service Worker 只缓存当前版本的静态界面资源，离线时不能读取 Session、配对、审批或发送 Prompt。

如果手机 Tailscale 显示 Relay server unavailable，并且电脑的 `tailscale status` 把手机列为 `offline`，先在手机 Tailscale 中断开再重新连接；此时浏览器可能直接报 MagicDNS 解析失败，尚未到达 Companion 或 Harness。恢复连接后关闭并重新打开桌面入口。官方客户端的插件脚本使用 Host 下发的有界加载策略，默认同时加载 4 个脚本，并对没有执行过的传输失败最多尝试 3 次，以避免弱中继链路被大量并发请求压垮。

停止私有共享：

```powershell
tailscale serve off
```

## 2. Android 构建环境

Capacitor 8 要求 Node.js 22 以上、Android Studio 2025.2.1 以上和 Android SDK。仓库生成的工程使用 min SDK 24、compile SDK 36 和 target SDK 36。优先使用 Android Studio 自带的 JDK，并在 SDK Manager 安装 Android SDK Platform 36、对应 Build Tools 与 Platform Tools。

完成 Android Studio 首次设置后，确保命令行能找到 SDK。Windows 可以设置：

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:ANDROID_HOME\platform-tools;$env:Path"
```

仓库不会提交 `local.properties`、SDK 路径、Keystore、密码或设备信息。

## 3. 同步与构建 Debug APK

安装依赖并把同一套 React/Vite UI 同步到 Capacitor Android 工程：

```powershell
pnpm install
pnpm android:sync
```

`android:sync` 依次验证精确锁定的 Harness checkout、构建 `native` Web 产物、生成 Android 图标和启动图，再运行 `cap sync android`。同步不需要模拟器，但首次依赖安装需要网络。

在 Android Studio 中打开工程：

```powershell
pnpm android:open
```

从命令行构建使用 Android 调试签名的 APK：

```powershell
pnpm android:apk
```

输出位于 `apps/android/android/app/build/outputs/apk/debug/app-debug.apk`。Debug APK 只用于本机安装与打包验证，不能作为 GitHub Release 或长期升级通道。

## 4. 当前 APK 行为

APK 启动同一个 Vite Entry，但在创建 Harness Connection 之前识别 Capacitor 原生平台并停在“安全连接尚未启用”页面。它不读取浏览器 Cookie，不向 Host 发送 API/WebSocket 请求，也不保存 Harness Credential、模型 Credential 或设备 Credential。

因此当前真实手机工作流仍使用 PWA。不要通过以下方式让 APK 临时连接 Host：

- 不把 Capacitor `server.url` 指向 Tailscale Origin；该字段只用于 Live Reload，不用于生产。
- 不放宽 PWA 的 `SameSite=Strict` HttpOnly Cookie。
- 不把 Bearer Token、Harness 配置或模型 API Key 写入 Vite 环境变量、APK 资源或手机存储。

## 5. 原生扩展点

原生能力由 `apps/android/` 组合，功能 UI 继续复用 `apps/web/` 和现有插件。后续能力按以下职责接入：

| 能力 | Provider 责任 | 安全要求 |
|---|---|---|
| APK 下载 | GitHub Releases 提供签名 APK 与 SHA-256 摘要 | Host 不下发可执行插件或 APK |
| 二维码扫描 | Capacitor 扫码 Provider 只解析并校验配对 Offer | Claim Secret 不进入日志或持久存储 |
| 通知 | 原生 Push Provider 接收无敏感内容的待处理信号 | Payload 不含 Prompt、Session、路径或 Token |
| 后台重连 | App/Network 生命周期 Provider 驱动一个 Connection lifecycle controller | 恢复时重新认证并从 Host 基线重建，不在后台执行 Agent |
| 安全凭据 | 原生设备信任 Provider 使用 Android Keystore 后面的不可导出密钥 | 只保存独立、可撤销、密钥绑定的设备身份，不保存 Harness 或模型密钥 |

功能插件不能直接导入 Capacitor API；平台 Provider 先完成连接、通知、扫描或存储能力，再由 Consumer 使用该接口。新的网络、二维码、原生桥接和持久数据都必须在入口做运行时校验。

## 6. GitHub Actions 与 Releases 路径

仓库当前没有 Release、Android Workflow 或签名 Secret 约定，而且 Companion 精确锁定的 Harness 提交 `2a8d995b4b43a4f308143a40ed1fcf9e633aac47` 只存在本地。GitHub Runner 无法检出这个提交，因此当前不加入必然失败的 Workflow。

满足以下条件后启用发布：

1. 精确锁定的 Harness 提交可由 GitHub Runner 检出，或 Companion 改为消费已发布且带完整客户端入口的 Harness Package。
2. 建立受保护的 `android-release` GitHub Environment，并要求 Release 审核。
3. 配置 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS` 和 `ANDROID_KEY_PASSWORD` 四个 Secret。
4. Pull Request Workflow 在 Ubuntu Runner 检出两个相邻仓库，安装 Node 22、pnpm、Java 21 和 Android SDK 36，运行 `pnpm install --frozen-lockfile`、`pnpm run check`、`pnpm run test:web`、`pnpm android:sync` 与 Gradle `assembleDebug`，只上传 Debug Artifact。
5. `android-v*` Tag Workflow 在临时目录解码 Keystore，使用 `cap build android --androidreleasetype APK` 生成签名 Release APK，计算 SHA-256，并把 APK 与摘要上传到同名 GitHub Release。
6. Workflow 结束后删除临时 Keystore；任何 Artifact、日志、缓存或 Release 都不得包含 Keystore、密码、配对材料或 Harness/模型 Credential。

发布后的用户下载入口是仓库的 GitHub Releases 页面。首个正式 APK 发布前还必须在真实 Android 设备上验证安装、升级、撤销、通知权限、后台恢复和 Keystore 丢失后的失败行为。

## 7. 验证命令

Web、PWA 和原生入口：

```powershell
pnpm run check
pnpm run test:web
pnpm android:sync
```

安装 Android SDK 后再运行：

```powershell
pnpm android:apk
```

`test:web` 覆盖 390x844、430x932、1280x800，以及 390x844 的 Android Shell 视口；它检查 PWA Manifest、Service Worker 控制范围、缓存中没有 API 响应、现有配对与 Session 流程、原生入口不发送 Harness 请求和页面无横向溢出。
