# DSH Companion

[English](README.md) | 中文

DSH Companion 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的移动优先伴侣界面，由 Harness 在同一 Origin 的 `/companion/` 提供。电脑回环页面保留本机管理能力；经过批准的手机通过私有 Tailscale HTTPS 连接，并作为只读 Viewer 或经明确提升的 Owner 使用 Harness。

Harness 后端仍然只监听 `127.0.0.1`。Tailscale Serve 提供私有网络可达性，Harness 持有一次性配对、HttpOnly 设备凭据、授权与撤销。Viewer 使用有界的只读 Companion 界面；Owner 启动 Harness 官方 Web 客户端并获得远程浏览器能力，原生对话框和打开文档操作仍然只允许本机使用。

## 已实现

- 直接装载 Harness 的 Typert Registry、Client Connection、API Remotes 和 Client Runtime，不维护第二套 Session 或 Interaction 协议。
- 注册 Harness 标准 Conversation Definition，并展示 Runtime 所有的只读历史，包括消息、工具过程、流式片段和失败状态。
- 从 `ctx.sessions` 派生收件箱、Session 列表和待处理状态。
- 通过 Harness 的 `PendingWait.respond()` 回答问题或批准/拒绝工具调用；只有 Host 的 resolved Frame 才会移除事项。
- 独立 Cordis UI 插件贡献收件箱、Session 和设置页面，Shell 只负责路由、导航与连接提示。
- 中文配对页在正常 Runtime 启动前运行，Claim Secret 只留在页面内存中；凭据通过 HttpOnly Cookie 领取，随后启动标准 Harness Client Runtime。
- 本机设置页可以创建二维码 Offer、核对并批准六位验证码、列出已配对设备，并在二次确认后撤销设备。
- 新配对设备默认获得 Viewer 权限；本机设置页在显示完整控制警告后，可以明确把设备提升为 Owner。
- 认证后的 Owner 启动 Harness 官方 Web 客户端；Viewer 留在 Companion，未知目标和 Host 原生 API 均按本机专用拒绝。
- `dsh-companion-host-web` 插件把构建产物挂载到 Harness 的 `/companion` 前缀，并在非回环 Host 或 Harness 版本不一致时拒绝加载。
- `/companion/` 提供可安装 Manifest、主屏幕图标和只缓存版本化静态资源的 Service Worker；`/companion/?install=1` 为 Viewer 与 Owner 提供不会启动 Harness 的稳定安装入口，API 与 WebSocket 数据不进入缓存。
- Capacitor 8 Android 工程复用同一个 React/Vite Entry，并在原生设备身份完成前停在不连接 Harness 的安全状态。
- 原生 Owner 可以选择 Host 已注册 Workspace、创建或复用空白 Session、发送第一条消息并停止运行，不在手机端复制 Harness Session 状态。
- 官方 Harness Fixture 驱动的无密钥浏览器测试覆盖 390x844、430x932 和 1280x800。

完整机制见 [架构文档](docs/architecture.zh.md)、[手机安装与 Android 构建](docs/mobile.zh.md)、[可信 Host 同源 PWA 决策](.agents/notes/implemented/architecture/2026-08-16-trusted-host-served-pwa.md)和[可安装 PWA 与 Capacitor 决策](.agents/notes/implemented/architecture/2026-08-17-installable-pwa-and-capacitor-android.md)。工程修改遵循 [AGENTS.md](AGENTS.md) 与 [设计和开发流程](docs/design-workflow.zh.md)。

## 环境准备

当前预发布开发方式要求两个仓库位于同一父目录：

```text
workspace/
  deepseek-harness/
  dsh-companion/
```

Companion 锁定 DeepSeek Harness `0.1.0-rc.5` 和提交 `f652a3263943a26ebfa3f0945230c1f40884637d`。需要 Node.js 22.19 以上版本、pnpm 10 和 Chrome。

首次准备 Harness：

```sh
cd deepseek-harness
pnpm install --frozen-lockfile
pnpm run build
```

安装并启动 Companion：

```sh
cd ../dsh-companion
pnpm install
pnpm host
```

打开 [http://127.0.0.1:3080/companion/](http://127.0.0.1:3080/companion/)。该页面读取同一 `dsh web` 进程中的真实 Session；Harness 原有页面仍位于根路径 `/`。

Windows 日常启动时，把 `companion.local.example.psd1` 复制为 Git 忽略的 `companion.local.psd1`，填写 `DshHome` 与 `PublicOrigin`，以后直接双击 `start-companion.cmd`。启动器会复用已经运行的 Companion Host，并阻止重复启动；如果普通 `dsh web` 或其他服务占用 3080，先停止它再启动 Companion。重启时保持同一个 `DshHome`：持久设备记录位于该目录，原生 Challenge 和短会话则按设计在内存中重建，单台电脑不需要外部数据库。只验证配置时运行：

```powershell
.\start-companion.ps1 -ValidateOnly
```

## 手机可信连接

在电脑和手机上安装 Tailscale，并让两台设备登录同一个 Tailnet。先保持 Harness 停止，在 Windows 管理员 PowerShell 中进入 Companion 目录并运行：

```powershell
tailscale serve --bg 3080
```

命令会显示类似 `https://computer-name.tailnet-name.ts.net` 的地址。在普通 PowerShell 中使用这个完整 Origin 启动 Companion：

```powershell
$env:DSH_COMPANION_PUBLIC_ORIGIN = 'https://computer-name.tailnet-name.ts.net'
pnpm host
```

在电脑上打开[本机设置页](http://127.0.0.1:3080/companion/)，创建配对码，再用手机扫描二维码。批准前必须核对两边显示的六位验证码。不要使用 Tailscale Funnel，也不要把 3080 端口直接暴露给局域网或互联网。运行 `tailscale serve off` 可以停止私有共享。

## 只看演示数据

不启动真实 Host 时，可以使用 Harness 官方 Fixture 查看问题和审批的完整流程：

```sh
pnpm dev
```

打开 [http://127.0.0.1:5173/companion/?fixture](http://127.0.0.1:5173/companion/?fixture)。不带 `?fixture` 的独立 Vite 页面没有同源 Harness API，不能作为真实连接入口。

## 验证

```sh
pnpm run check
pnpm run test:web
```

`check` 运行 Harness checkout 校验、类型检查、Lint、单元测试和生产构建；`test:web` 使用官方 Fixture 与真实 Client Runtime 运行三种视口的浏览器流程。

## PWA 与 Android

手机浏览器通过 `/companion/?install=1` 把 Companion 安装为 PWA。Android 原生工程的同步、Debug APK、Android Studio 与后续 GitHub Releases 路径见[手机安装与 Android 构建](docs/mobile.zh.md)。当前 APK 只验证原生打包和安全入口，真实连接仍使用 PWA；原生扫码、通知、后台重连和 Keystore 设备身份继续通过平台插件实现。Harness 执行与模型 Credential 始终留在电脑上。
