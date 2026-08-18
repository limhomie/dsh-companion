# Agent Note: Harness 同源托管的真实 Session 切片

Status: implemented

## Problem

Stage 0 的页面只读取 Companion 自有 Fixture，无法证明电脑上的真实 Harness Session、问题和审批能够到达移动界面，也无法证明处理结果会返回正在运行的 Agent。继续扩展 Companion 的 `ConnectionFrame`、Session 投影和 Interaction 状态机会复制 Harness 已经拥有的协议、重连、幂等和生命周期语义。

Harness 当前浏览器载体信任同源回环请求，但没有可供手机使用的设备身份、配对、Scope 和撤销能力。把现有 Web Server 直接绑定到局域网会混淆网络可达性与认证，不能作为真实手机连接的基础。

## Decision

Companion 提供一个由 Harness 同源托管、只允许回环访问的真实 Session 切片。用户通过 `dsh web` 的 `/companion/` 查看真实 Session 摘要和当前待处理问题或审批；Harness 原有页面继续占用根路径。

### 客户端组合

`apps/web` 创建一个 Cordis Context，并按公开依赖顺序装载以下 Harness Client 入口：

1. `@deepseek-ai/dsh-typert-registry/client`
2. `@deepseek-ai/dsh-client-connection/client`
3. `@deepseek-ai/dsh-api-gateway/client`
4. `@deepseek-ai/dsh-api-remotes/client`
5. `@deepseek-ai/dsh-client-runtime/client`
6. Companion 的 Conversation Projection 插件
7. Companion 的 UI Registry、Shell、Inbox、Session 和 Settings 插件

Companion 删除 Stage 0 的 `packages/connection`、`packages/connection-fixture` 和 `packages/runtime`。无密钥预览与浏览器测试改用 Harness Connection 自带的 `?fixture` Provider，因此生产和 Fixture 流程共享同一个 Client Runtime 与 UI Consumer。

### 状态所有权

| 状态 | 所有者 | Companion 用法 |
|---|---|---|
| Session Log、运行状态和 Interaction | Harness Host | 从 `ctx.sessions.list` 与 Session snapshot 读取 |
| 连接状态与 Host 描述 | Harness Client Connection | 订阅 `hostDescription`；缺失时只读 |
| Session 客户端投影与重连恢复 | Harness Client Runtime | 调用 `sessions.open()`，读取稳定 binding |
| 跨 Session 收件箱 | 无独立 Store | 从 `SessionListState.pendingInteraction` 和 `completed` 派生 |
| 表单草稿和提交中 | 对应 React 组件 | 组件卸载或提交失败时结束 |

问题和审批通过上游 `PendingWait.respond()` 提交。返回 receipt 只表示 Host 接受应答载体；组件保持提交中，直到 resolved Frame 或新基线移除对应 wait。Companion 不维护 Interaction 已解决副本，也不实现重连计时器。

Session 页面从公开 `ConversationSnapshot` 展示只读历史，并从 `snapshot.pending` 展示可应答的 Interaction。Conversation Definition 的复用方式由 [只读 Conversation 决策](../feature/2026-08-15-read-only-conversation-history.md) 记录；Companion 不根据原始 Session Event 实现 Fold。

### Host 插件

`packages/host-web` 注入现有 `webServer`，用 effect 注册 `/companion` named prefix，并复用 `@deepseek-ai/dsh-host-frontend-static` 的静态文件、MIME、协商压缩、路径包含和 SPA fallback 规则。`GET` 与 `HEAD` 可读取页面和资源，其他方法返回 405；插件卸载时 route disposer 随 effect 撤销。

插件在读取构建产物前要求 `ctx.webServer.host === '127.0.0.1'`，没有配置可以跳过该安全不变量。静态路由不读取 Session；业务请求继续经过 Harness 原有 `/api`、Origin、Fetch-Metadata 和 WebSocket 检查。

### 版本与开发布局

Harness `host.describe` 没有独立协议版本，当前 Host 与浏览器 Client 仍按同一发布物演进。Companion 因此固定 `0.1.0-rc.5`，Host 插件在加载时检查 Connection、Frontend Static 和 WebServer Package 的解析版本，任何不一致都会阻止页面启动。

部分 `0.1.0-rc.5` Client Package 尚无完整 npm 发布组合。预发布开发采用相邻的 `deepseek-harness` checkout，`scripts/verify-harness.mjs` 同时检查版本与提交 `47f943859bef60e4160492346772ded9b24f765a`。TypeScript 使用 Harness 已构建的公开声明；Vite 只把浏览器 Client 入口映射到该 checkout 的源码，避免把 Harness 多个编译面压进一个 TypeScript Program。

`scripts/start-harness.mjs` 生成临时 patch layer，以 `file:` URL 装载 Host 插件，并通过当前 pnpm 的 JavaScript 入口启动 `dsh web`。这使 Windows 不依赖 Node 直接执行 `.cmd` 文件。

### 验证

单元测试覆盖收件箱派生、Harness Package 版本拒绝和非回环 Host 拒绝。Playwright 通过官方 Fixture 与真实 Client Runtime 展示 Conversation 历史、完成三道问题、一次审批和 resolved 后的收件箱移除，并在 390x844、430x932 与 1280x800 检查横向溢出。

真实 Host 组装验证同时访问 `/`、`/companion/` 和 `/companion/sessions/example`，确认主 fallback 与 named prefix 共存、深层路由返回 Companion index，POST 返回 405。应用内浏览器在真实 Origin 上完成 Connection 握手，页面没有当前控制台错误。

## Alternatives considered

**立即开放局域网并使用 Tailscale 地址作为信任。** Tailscale 可以提供可达性和网络身份，但当前 Harness 请求没有 Companion 设备主体、操作 Scope 或撤销记录。非回环访问继续被拒绝，直到完整设备信任能力进入 Harness。

**继续扩展 Companion 的 Fixture Connection 与 Runtime。** 这会保留较少改动，但要求两套实现分别维护 Frame、Session Fold、重连和 Interaction 提交点。项目尚未发布，因此删除自有实现并一次更新全部 Consumer。

**嵌入完整 Harness Web UI。** 这能展示真实 Conversation，但保留桌面工作台的信息密度，无法验证待处理事项优先的手机流程。当前切片复用 Harness Runtime，不复制或嵌套整个桌面界面。

**使用独立 Vite Server 代理 `/api`。** Origin 重写会建立一条不同于真实部署的安全路径。独立 Vite Server 只运行 `?fixture`；真实数据始终使用 Harness 同源 `/companion/`。

**从 npm 组合相近的预发布版本。** 混用 `rc.5` 与 `rc.6` 不能证明 Client/Host 兼容。当前使用精确 checkout；发布独立客户端前必须由 Harness 提供完整的发布 Package 集和协议兼容信息。

## Consequences

用户现在可以在电脑浏览器中确认 Companion 读取真实 Harness Session、查看只读 Conversation 历史，并通过移动布局处理问题和审批。页面仍不能从手机访问，也不支持 Prompt、排队、中途指令、中断、文件或 Diff Review。

Harness 成为唯一 Session 与 Interaction 状态所有者，Companion 的业务代码和测试显著减少。代价是当前开发环境依赖一个精确的相邻 Harness checkout 及其构建产物；Harness 升级必须同时更新固定提交、Package 版本、类型适配和全部验证。

生产 JavaScript 当前约 578 kB minified、165 kB gzip。该体积来自真实 Client Runtime 和 Harness Conversation Projection 依赖图；在加载性能数据出现前不创建第二套轻量 Runtime。后续可以在保持同一状态所有者的前提下按 UI 路由拆分 Chunk。

下一阶段必须先在 Harness 中完成设备信任 Service Definition、Provider 与 Connection Consumer，以及二维码配对、Scope、撤销、持久操作者来源和明确协议兼容信息。只有这些能力完成后，Host 插件才可以设计非回环部署方式。
