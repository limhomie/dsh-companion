# 手机安装、连接与 Android 构建

本文是 DSH Companion 手机端的操作入口。浏览器 PWA 与 Capacitor Android APK 都可以连接和配对；两者复用同一套 React/Vite UI，但使用相互独立的浏览器 Cookie 与 Android Keystore 设备身份。

Host 现在作为标准 `@dsh-companion/host` Bundle 安装，不再依赖启动时临时 `--patch`。但截至 2026-08-20，官方 Harness `0.1.0-rc.8` 仍缺少 Owner 远程操作所需的公开认证主体和提交扩展点，当前 APK 只能连接迁移基线。兼容版本、安装、升级和卸载命令见 [Companion Host Bundle 安装与生命周期](host-plugin.zh.md)。

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

该命令会构建 Companion，调用官方 `dsh plugin --profile web` 生命周期安装或更新本地 Bundle，再启动普通 `dsh web`。profile 组装可用 `pnpm run host:plugin:verify` 检查；日常启动不再创建 `.tmp/companion.patch.yml`。

Windows 一键启动时，把 `companion.local.example.psd1` 复制为 Git 忽略的 `companion.local.psd1`，填写同样的 `DshHome` 与 `PublicOrigin`，以后直接双击仓库根目录的 `start-companion.cmd`。启动器会验证本机配置；如果 3080 上已经是 DSH Companion，则直接报告现有服务，不会重复启动；连续双击也只允许一个启动过程。如果 3080 被普通 `dsh web` 或另一项服务占用，必须先停止该服务再运行启动器。排查配置但不启动服务时运行：

```powershell
.\start-companion.ps1 -ValidateOnly
```

Tailscale Serve 的管理员命令仍然只需首次配置或 Serve 被关闭后执行，不放进日常启动脚本。

电脑入口是 [http://127.0.0.1:3080/companion/](http://127.0.0.1:3080/companion/)，手机入口是 `https://computer-name.tailnet-name.ts.net/companion/`。在电脑设置页选择“生成手机配对二维码”，用手机相机扫描二维码，并在两边核对相同的六位验证码后才批准。

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

本地正式构建从环境变量读取签名，不在仓库保存 Keystore 或密码：

```powershell
$env:DSH_ANDROID_KEYSTORE_FILE='C:\secure\dsh-companion-release.p12'
$env:DSH_ANDROID_KEYSTORE_PASSWORD='<keystore password>'
$env:DSH_ANDROID_KEY_ALIAS='dsh-companion'
$env:DSH_ANDROID_KEY_PASSWORD='<key password>'
pnpm android:release
```

缺少任何一项签名变量时构建会立即失败。当前版本成功后输出 `dist/releases/android-v0.1.1/dsh-companion-0.1.1-universal.apk` 和同名 `.sha256` 文件。发布后的每个版本必须继续使用同一个 Keystore，并递增 `versionCode`，否则 Android 无法覆盖升级。

## 4. 安装、配对并使用 APK

电脑连着手机且已开启 USB 调试与“USB 安装”后，在电脑 PowerShell 运行：

```powershell
adb install -r "D:\dsh-companion\apps\android\android\app\build\outputs\apk\debug\app-debug.apk"
```

该命令在电脑上执行，不在手机上输入。Android 显示安装确认时必须在手机上允许；出现 `INSTALL_FAILED_USER_RESTRICTED` 通常表示手机没有开启 USB 安装，或安装确认被取消。

首次启动 APK 时，在电脑的 Companion 设置页选择“生成手机配对二维码”，再点击 App 的“扫描电脑二维码”。App 只把扫码结果交给既有入口校验：必须是包含一次性 Offer UUID 的完整 HTTPS 链接；取消扫码不会改变页面或 Keystore，相机权限不可用时可以展开“改用粘贴配对链接”。扫描或粘贴通过后手机显示六位码；电脑待批准列表出现相同设备名称和号码后才批准。新设备默认是 Viewer；需要发送 Prompt 或处理 Interaction 时，在电脑设置页把该设备提升为“完整控制” Owner。

批准后，APK 会通过 Android Keystore 密钥签名 Challenge，建立内存短会话并进入当前 Companion Session；手机左侧抽屉包含 Session、收件箱和设置。以后冷启动使用同一 Keystore 身份重新认证，不需要重新配对。Harness 重启或 Tailscale 暂时断开会使当前连接失效，但不会删除设备记录；恢复网络后点击“重试连接”会再次签名。只有电脑撤销设备，或在 App 中选择“删除配对”并二次确认后，才必须重新配对。

Host 端的设备公钥、访问级别、有效期和撤销状态由 Storage Domain 持久化到当前 `DSH_HOME` 下的 `storages/device_trust.json`；手机只在 Android Keystore 保存不可导出的私钥，并在应用私有 SharedPreferences 保存 Host Origin、设备 id 和名称。配对 Offer、Challenge、短会话和 WebSocket Ticket 只存在于进程内存，Host 重启后会重新签发。关闭服务不会删除长期身份，但改用另一个 `DSH_HOME` 会得到另一套设备记录；单台电脑不需要 MySQL。不要把该存储文件或整个测试 Home 上传到公开仓库。

如果失败页提示当前地址没有返回 DSH Companion 认证响应，说明 Tailscale Origin 正在转发普通 Harness 或其他服务。电脑端访问 `/companion/manifest.webmanifest` 必须返回名为 `DSH Companion` 的 JSON；先停止占用 3080 的普通 `dsh web`，再双击 `start-companion.cmd`，然后在手机点击“重试连接”。该过程不需要删除配对。

Owner 可以直接打开已有 Session，或在左侧 Session 导航点击加号，先选择 Host 提供的 Agent 模式，再选择电脑 Harness 已注册的 Workspace。手机点击会话顶栏按钮或在页面任意位置向右拖动打开抽屉，点击遮罩或向左拖动返回对话；桌面端常驻显示同一 Session 列表。两个方向中，Session 抽屉、遮罩和对话页都跟随手指移动，对话页会被逐渐推出并在反向拖动时恢复。慢速拖动松手时超过抽屉宽度的一半才切换，否则回弹；快速短滑达到较短的方向位移后可以直接切换。明显的纵向滚动不会触发。运行中的 Session 显示旋转进度，后台完成且尚未查看的 Session 显示绿点，打开该会话后绿点消失。最近 3 个 Session 的已渲染视图只在本次运行的内存中保留，切回时恢复滚动位置与未发送草稿；隐藏视图暂停 Session 订阅，退出 Session 页面或超出容量后释放，不把对话写入持久缓存。模式只对即将创建或复用的空白 Session 生效；已有对话不能更换 Agent 组合。App 等待 Harness 返回并组合该 Session 后进入对话页；该页只保留会话顶栏、对话记录、待处理确认和底部输入框。用户消息显示为右侧气泡，Agent 正文按 Harness 网页端的 Markdown 规则显示，思考与 Tool 调用折叠为可展开轨迹行；发送按钮与运行期间的停止按钮位于一体化输入框右下角。输入区的展开图标会把同一个 Composer 放大为全屏编辑层，草稿、菜单与发送 Operation id 不变；Escape 先关闭菜单，再收起编辑器。需要审批或回答的问题显示在对话历史下方、输入框上方。

输入框左下角的加号每次从 Host 读取当前 Agent 的命令；无参数命令会直接执行，带参数命令会把 `/<命令> ` 放入输入框继续填写。权限按钮读取当前 Session 的 `permissions` Projection，切换 Full access 前必须确认风险；模型按钮只显示 Host 已加载的 Provider 与模型，推理等级使用该模型实际提供的选项，例如 DeepSeek 模型的 Off、High 和 Max。权限、模式、模型与推理等级都写回电脑上的同一个 Harness Session，其他客户端读取的是同一 Host 状态，不是手机本地设置。Agent 模式目录读取使用 8 秒超时并最多重试一次；Workspace 基线变慢时显示明确状态。Session 创建超时后由用户显式重试，Harness Runtime 会合并同一 Workspace 的在途创建并复用 Host 空白 Session，不盲目重复写入。命令、权限或模型菜单打开后，点击控制区之外或按 Escape 即可关闭。收件箱和设置位于左侧导航下方。Workspace、消息、流式回复和运行状态同样都来自 Host；手机不能注册新目录，也不保存 Workspace 内容或模型密钥。Viewer 只能查看，断线时新建、发送、切换和停止操作都会禁用。当前 Prompt 输入只支持纯文本，附件尚未接入。

APK 不读取 PWA Cookie，不把 Harness Credential、模型 Credential 或私钥交给 JavaScript。不要把 Capacitor `server.url` 指向 Tailscale Origin，不要放宽 PWA 的 `SameSite=Strict` HttpOnly Cookie，也不要把 Bearer Token、Harness 配置或模型 API Key 写入 Vite 环境变量、APK 资源或手机存储。

## 5. 原生扩展点

原生能力由 `apps/android/` 组合，功能 UI 继续复用 `apps/web/` 和现有插件。后续能力按以下职责接入：

| 能力 | Provider 责任 | 安全要求 |
|---|---|---|
| APK 下载 | GitHub Releases 提供签名 APK 与 SHA-256 摘要 | Host 不下发可执行插件或 APK |
| 二维码扫描 | Capacitor 原生扫码为主入口，粘贴完整链接为降级入口；两者共用 HTTPS Offer 校验 | Claim Secret 不进入日志或持久存储 |
| 通知 | 原生 Push Provider 接收无敏感内容的待处理信号 | Payload 不含 Prompt、Session、路径或 Token |
| 后台重连 | App/Network 生命周期 Provider 驱动一个 Connection lifecycle controller | 恢复时重新认证并从 Host 基线重建，不在后台执行 Agent |
| 安全凭据 | 已实现的原生设备信任 Provider 使用 Android Keystore 中不可导出的 P-256 密钥 | Harness 只保存公钥；App 只持久化非敏感连接信息，不保存 Harness 或模型密钥 |

功能插件不能直接导入 Capacitor API；平台 Provider 先完成连接、通知、扫描或存储能力，再由 Consumer 使用该接口。新的网络、二维码、原生桥接和持久数据都必须在入口做运行时校验。

## 6. GitHub Actions 与 Releases 路径

首个 Android 版本使用本机受保护的 Keystore 签名，手动上传 Universal APK 与 SHA-256 到 GitHub Pre-release。仓库当前仍没有 Android Workflow，而且 Companion 的开发验证仍锁定只存在本地的 Harness 迁移提交 `f652a3263943a26ebfa3f0945230c1f40884637d`。Host Bundle 已迁入本仓库，但官方 `0.1.0-rc.8` 还不能完成 Owner 工作流，因此当前不加入必然失败的 Workflow。

满足以下条件后将手动发布升级为自动发布：

1. 所需的认证主体、默认拒绝 Endpoint 策略、ActionSource 和幂等提交扩展点进入经验证的官方 Harness 版本，Companion 更新兼容范围并通过官方 profile 组装测试。
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

`test:web` 覆盖 390x844、430x932、1280x800，以及 390x844 的 Android Shell 视口；它检查 PWA Manifest、Service Worker 控制范围、缓存中没有 API 响应、扫码与粘贴配对、Agent 模式与 Workspace Session 创建、侧边栏按钮与滑动手势、Session 运行与完成提醒、Host 命令、权限 Projection、模型与推理等级切换、Composer 全屏编辑与 Escape 次序、菜单外部点击关闭、Markdown 对话层级、Tool 去重、首条消息、停止运行、失败与空状态、分级原生连接诊断和页面无横向溢出。Companion Host 包测试覆盖 P-256 签名、短会话、一次性 WebSocket Ticket、访问级别替换、撤销和标准 profile 组装；真机验收还要完成 APK 安装、相机权限、六位码批准、Viewer 连接、Owner 自动重连、创建 Session、真实模型对话与设置页权限显示。
