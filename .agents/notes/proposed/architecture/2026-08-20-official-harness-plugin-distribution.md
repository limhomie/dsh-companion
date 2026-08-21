# Agent Note: 官方 Harness 的 Companion 插件分发

Status: proposed

## Problem

DSH Companion 的 Android、PWA 和网页客户端只能连接包含本地 Companion 提交的 Harness checkout。APK 本身可以独立分发，但其他测试者安装官方 Harness 后缺少设备配对、认证请求上下文、远程访问分类和 Companion 静态入口，因而不能使用自己的 Host。

本地 Harness 分支还把 Companion 专用 Provider、Web 资源和通用 Host 协议修改放在同一个提交序列中。用户必须维护整个 Harness 私有分支，无法通过官方 profile 生命周期安装、升级或卸载 Companion，也无法在启动前得到明确的版本不兼容诊断。

## Proposal

Companion 发布一个由本仓库拥有的 Host bundle。它通过官方 `dsh plugin --profile web` 命令安装到用户的 `web` profile，并由 `dsh.bundle.patch` 插入 Companion Host 插件。bundle 包含 `/companion/` 静态资源、设备信任 Service Definition、本地持久 Provider、浏览器与原生认证 Connection Consumer，以及它们的部署配置；安装包不包含 `DSH_HOME`、设备记录、凭据或密钥。

安装工具执行三个独立步骤：检查官方 Harness 版本和所需公开能力；让 `dsh plugin` 安装或移除 bundle；通过 `dsh --profile web --dump-config` 确认 Companion 行已进入真实组装。安装失败保留原 profile，诊断必须指出检测到的 Harness 版本、缺少的能力和可执行的升级要求。升级复用同一 profile 依赖；卸载只移除 bundle 和由它注册的 Cordis Effect，不删除设备信任存储。

Host 继续拥有 Session、Agent、Interaction、权限和持久事件。认证后的 Connection 产生不可由 Payload 声明的主体、访问级别、操作来源和主体生命周期 `AbortSignal`。Harness API Gateway 在解析请求后按公开的 Endpoint 策略分类为 `viewer`、`owner` 或 `local-only`；未知方法默认 `local-only`。修改状态的调用使用客户端操作 id，Prompt、审批、问题和命令只在权威持久事件提交后成功，并记录经过认证的设备来源。

官方 Harness `0.1.0-rc.8` 已提供 profile/bundle 安装、named Web route、index transform 和公开 `ctx.apiProxy`，但明确没有 Web authentication layer，也没有把认证主体传给 API Proxy 的公开接口。外部 bundle 可以迁移静态入口和新的能力 Provider，不能安全补写既有 API Proxy 闭包中的 Interaction、Prompt、幂等和持久来源语义。因此第一个可供他人使用的版本必须要求一个包含以下最小上游能力的官方 Harness 版本：

- Connection 可在 HTTP、WebSocket 和 Typert RPC 分派前认证主体，并为每个目标执行默认拒绝的远程访问分类。
- transport-independent API 调用可以接收主体 id、可信 ActionSource、授权查询和随撤销终止的 `AbortSignal`。
- Session Prompt 与 Interaction Response 接受稳定操作 id，并以权威事件作为提交点保存来源和去重结果。
- 官方 Web 启动在构造 Client Runtime 前区分回环、未配对、Viewer 与 Owner，或提供等价的可卸载 index transform 扩展点。

最小改动应落在通用 Package 边界，而不是加入 Companion 名称或设备表：

- `@deepseek-ai/dsh-client-connection` 公开注册认证 Consumer、主体 id、主体撤销 Signal 和 Endpoint 远程访问策略的契约；HTTP、Upgrade 和 Typert 三种载体复用同一个默认拒绝的判定。
- `@deepseek-ai/dsh-host-apiproxy` 的公开调用上下文接收 Connection 给出的主体、可信 ActionSource 和操作 id，并把它们传到具体 API Provider；Payload 中的同名字段一律无权覆盖。
- 官方发布 `@deepseek-ai/dsh-action-source`，Interaction 与 Session Prompt 的公共输入接受来源和操作 id，持久事件在同一个提交事务中保存来源、结果和去重记录。
- 官方 Web Client 在 Runtime 构造前提供可卸载的远程启动分类；未知权限或未知 Endpoint 只能进入只读安全展示，不能合成修改操作。

## 本地提交审计

审计基线是本地 `codex/trusted-device-connection@f652a32639` 相对共同基线 `47f943` 的八个提交，并用已拉取的官方 `origin/master@141eb6f`（`0.1.0-rc.8`）复核当前公开扩展点。

| 本地提交 | Companion Bundle 已接管 | 仍应进入官方 Harness 的通用能力 | 迁移结论 |
|---|---|---|---|
| `cccabc6` paired-device connection | 三个 device-trust Package、持久 Provider、配对与 Bundle 行 | Connection 认证前置、主体传播、默认拒绝的访问分类 | Companion 专用目录和 web-app 行不再需要；Connection 核心修改仍需要 |
| `596929` interaction answers | 设备认证 Consumer 与手机协议 | ActionSource、API 请求上下文、审批／问题的操作 id、持久来源与去重 | 业务提交语义不能由外部代理补写，保留为最小上游改动 |
| `9615d6` session prompts | 手机输入协议继续复用现有 UI | Prompt 操作 id、认证来源、权威事件提交和响应丢失去重 | 保留为最小上游改动 |
| `c2ea2b` official owner client | Companion UI 不需要 Harness 内的 Companion 入口 | API Gateway 的 Viewer／Owner／local-only 策略及官方 Client 远程启动分类 | 保留通用核心部分；删除 Companion 专用组合 |
| `fa7a408` PWA MIME | Bundle 自有静态路由显式服务 ico/png/svg/webmanifest | 无安全或协议前置条件 | Companion 不再需要此 Harness 修改 |
| `b43ce6f` degraded bundle transport | 无；这是官方 Client Loader 行为 | 有界并发和仅传输失败重试是通用可靠性能力 | 不阻塞插件认证，但要保持同等弱网启动体验仍应上游化 |
| `2a8d995` gzip responses | Bundle 自有静态路由可以无压缩正确工作 | gzip 是通用 Web 性能优化 | Companion 不再需要此 Harness 修改；可独立上游 |
| `f652a326` native key auth | P-256 配对、Challenge、短会话、Ticket 与 Android 协议迁入 Companion Package | Connection 的可信跨站 Origin、认证 Guard 和主体下行生命周期 | 设备实现不再属于 Harness；通用 Connection Hook 仍需要 |

这个划分也限定了后续删除顺序：先在兼容官方版本上通过真实组装和 Owner 行为测试，再停止日常使用本地分支；不能因为 Companion Package 已迁出就提前丢弃仍承载通用认证契约的提交。

本地 `codex/trusted-device-connection` 分支是这些上游能力的实现证据，不是插件的安装来源。迁移期间保留该分支和提交；日常 Host 只有在 bundle 通过官方基线组装与行为测试后才切回官方分支。

## Alternatives considered

**把 `trustedHosts`、局域网或 Tailscale 成员身份当作认证。** 官方文档明确把该检查定义为 Reachability 与 DNS rebinding 防护，不提供设备身份、逐设备撤销或 Owner 授权。这会把可达 Host 的调用者提升成匿名本地用户。

**在 Companion 插件中复制整个官方 Connection 和 API Proxy。** Profile 可以替换现有行，但 Companion 将拥有数千行随 Harness 快速变化的核心分支，并可能在升级后漏掉新的 Endpoint 或持久事件。该方案把私有 Harness fork 改名为插件依赖，没有建立稳定的公开能力。

**只开放 Viewer，暂时移除 Owner 写操作。** 这能在官方 `rc.8` 上实现安全的只读插件，但会破坏已发布 APK 的 Session 创建、Prompt、停止、审批和重连工作流，不满足迁移目标。

**安装时修改官方 npm 包或生成 pnpm patch。** 这种方式不经过 Cordis 生命周期，升级和卸载不能可靠恢复，且错误的补丁组合可能在启动后才暴露授权缺口。它只适合作为上游开发验证，不是用户安装路径。

## Acceptance criteria

- 一个干净的官方 Harness 安装可以用一条 Companion 命令安装 bundle，再用普通 `dsh web` 启动，不需要 Harness 源码 checkout 或 `--patch`。
- 安装、升级和卸载在隔离 `DSH_HOME` 中通过真实 `dsh plugin` 与 `web` profile 验证；失败不会写入设备、凭据或用户配置。
- 不兼容的官方版本在加载 Session 或建立远程 Transport 前失败，并显示检测版本、缺少能力和支持范围。
- Android、PWA 和网页入口保留 Viewer／Owner、Session、Prompt、审批、问题、停止、重连与配对撤销行为；390x844、430x932 和桌面流程继续通过。
- 未认证、Viewer 越权、未知 Endpoint、重复操作 id、撤销、访问级别替换、过期 Challenge 和重复 WebSocket Ticket 均安全失败。
- 发布 tarball 只包含代码、声明、静态资源、bundle patch 和文档；扫描确认没有 `DSH_HOME`、设备记录、配对材料、Token、私钥或模型 Credential。

## 实现证据（2026-08-20）

Companion 现在拥有 `@dsh-companion/device-trust`、`@dsh-companion/device-trust-local`、`@dsh-companion/device-trust-connection` 和 `@dsh-companion/host` Bundle。Bundle 声明 `dsh.bundle.patch`，用 Companion 所有的行替换迁移分支中的设备信任行，提供 `/companion/`，并只在版本与导出能力屏障成功后加载依赖核心能力的 Connection Consumer。

`pnpm host` 不再写临时 Patch。它构建 Bundle，通过 `dsh plugin --profile web add` 安装，使用 `dsh --profile web --dump-config` 核验组合树，再启动普通 `dsh web`。隔离 `DSH_HOME` 测试完成了 Bundle 安装、迁移基线启动、Companion Manifest HTTP 200 响应和 `dsh plugin remove` 卸载，且没有删除设备记录。打包产物只包含声明的代码、静态资源、Patch 和文档；source map 与本地构建路径已排除。

拉取的官方基线是 `0.1.0-rc.8`。其 Connection Package 仍明确说明 Web 载体没有认证层，官方树也没有 ActionSource Package 或屏障所需的运行时能力导出。因此本文继续保持 Proposed：分发边界已经迁移，但官方 Owner 兼容仍需等待上述上游契约。

## Risks

Harness 处于开发者预览期，公开 Package 和客户端协议会发生不兼容变化。Companion bundle 必须声明窄版本范围并逐版本完成真实组装验证，不能把 `peerDependencies` 可解析等同于协议兼容。

设备信任 Provider 的持久数据由用户当前 `DSH_HOME` 所有。卸载保留记录便于重装，永久清理必须是单独、明确且可审计的管理操作。

在所需上游能力进入正式 Harness 发布前，插件只能完成可安装 bundle 和失败前置检查，不能宣称官方 Harness 已支持 Owner 连接。
