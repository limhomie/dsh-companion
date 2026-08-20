# Agent Note: Windows 一键启动 Companion Host

Status: implemented

## Problem

`pnpm host` 已经封装 Web 构建、临时 patch 和 Harness 启动，但可信手机部署仍要求每个新 PowerShell 窗口重复设置本机 DSH Home 与 Tailscale HTTPS Origin。用户容易漏设、误用旧值或重复启动占用同一端口的 Host。把这些值硬编码进仓库会提交机器相关配置；把它们写入用户级环境变量又会让一个项目的测试状态隐式影响其他 Harness 启动。

## Decision

Windows 日常入口由根目录 `start-companion.cmd` 调用 `start-companion.ps1`。`.cmd` 优先使用 PowerShell 7，未安装时回退到 Windows PowerShell 5.1，并在启动失败时保留错误信息。

PowerShell 启动器使用 `Import-PowerShellDataFile` 读取被 Git 忽略的 `companion.local.psd1`，解析相对 DSH Home，验证 Public Origin 是不带路径的规范 HTTPS Origin，并把两项配置只注入当前启动进程。仓库提交 `companion.local.example.psd1` 作为字段示例，不提交实际机器值。

`/companion/manifest.webmanifest` 返回预期应用身份时，启动器报告现有服务而不创建第二个 Host；端口由其他服务占用时在构建前失败。命名 Mutex 让同一端口只存在一个启动过程，并允许异常退出后的下一次启动接管 abandoned mutex。`-ValidateOnly` 验证本地配置与精确 Harness checkout，但不启动服务。

Tailscale Serve 的管理员配置继续独立执行，因为它是持久系统路由，不属于每次 Harness 进程启动。

## Alternatives considered

**把本机值直接写进启动脚本。** 这样文件最少，但会把 Tailnet Hostname 和测试数据目录固化到共享仓库，其他 checkout 也无法安全复用。

**设置 Windows 用户级环境变量。** 后续终端可以直接运行 `pnpm host`，但变量会隐式影响同一用户启动的其他 Harness 实例，切换测试 Home 时也难以发现旧值。

**每次启动自动执行 Tailscale Serve。** 该命令需要管理员权限且配置在进程结束后继续存在。把它放进普通启动器会混淆系统路由配置与应用进程生命周期。

## Consequences

Windows 用户配置一次本机 Data File 后可以双击启动 Companion，不再逐次粘贴环境变量。该入口仍要求 Node、pnpm、精确相邻 Harness checkout 和已配置的 Tailscale Serve；它不安装依赖、不申请管理员权限，也不持久修改系统环境变量。

3080 被普通 Harness 或其他进程占用时，一键启动明确失败，不会终止未知进程。用户必须先确认并停止占用者，再重新双击启动。

Windows PowerShell 5.1、PowerShell 7、示例配置、错误 Origin、端口冲突和并发启动路径均通过命令行验证。
