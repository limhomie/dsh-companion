# Agent Note: 以待处理事项为中心的首个移动端纵向切片

Status: implemented

## Problem

Companion 的初始架构确定了移动优先、插件组合和 Host 权威状态，但缺少一条贯穿真实 App Entry 的用户流程。分别搭建通用路由、完整对话、真实认证和所有 Harness Tool 展示会同时产生多个未闭合 Package，并在远端协议确定前把 Fixture 假设写进产品接口。

用户离开电脑后最有时间价值的行为是发现 Agent 正在等待自己，查看必要上下文，作出一次回答或审批，并确认电脑端已经接受处理。首个切片需要证明这个结果以及断线后的状态收敛，同时明确不具备生产远程连接能力。

## Decision

Stage 0 是一个由确定性 Fixture Connection Provider 驱动的响应式 Web 应用。真实 App Entry 启动 Cordis Context，依次装载 Connection Service Definition、Fixture Provider、统一 Session 与 Attention Runtime、UI Registry，以及收件箱、Session、设置三个 UI 插件。

用户从收件箱进入所属 Session，提交回答或审批。Runtime 立即发布本地 `submitting` 状态并禁用重复操作，但 Interaction 继续保持 pending；只有 Fixture Host 发出的 `interaction-resolved` Frame 或新的完整基线能够将其标记为 resolved 并从收件箱移除。断线时修改操作不可用，Provider 经 reconnecting、resyncing 后发布 replace-baseline 并恢复 connected。

Fixture 只替代 Host 和网络，不替代 App Entry、Cordis 插件装配、Runtime、路由或 React UI。真实 Connection Provider 使用相同 Service Definition 替换 Fixture；真实 Wire DTO 继续由 Harness 的独立协议 Package 拥有。

## Plugin topology

| 单元 | 角色 | 当前职责 |
|---|---|---|
| `apps/web` | Shell | 装载插件图、挂载根 Renderer、展示启动失败 |
| `packages/connection` | Service Definition | Host 描述、连接状态、Frame、带幂等键的命令及 Provider 生命周期 |
| `packages/connection-fixture` | Service Provider | 确定性基线、Frame、延迟、断线和业务结果 |
| `packages/runtime` | Consumer + client state | Session 与 Interaction 投影、收件箱派生、命令协调 |
| `packages/ui-shell` | UI composition | 路由注册、桌面侧栏、移动底栏和 Connection Banner |
| `packages/ui-inbox` | UI Consumer | 待处理和结果筛选、跨 Session 导航 |
| `packages/ui-session` | UI Consumer | Session 上下文、Conversation、问题与审批处理 |
| `packages/ui-settings` | UI Consumer | Host、连接重试、设备信任状态和插件清单 |

Session 与 Attention 保留在同一个 Runtime Package。两者消费同一基线和 Frame、共享 Connection 代次及提交点；拆成两个 Service 会增加第二套订阅和发布时序，没有独立生命周期证据。

## State ownership

| 状态 | 所有者 | 权威来源与提交点 |
|---|---|---|
| Session 与 Interaction 业务状态 | Harness；Stage 0 为 Fixture Host | Host baseline 和有序 Frame |
| 客户端 Runtime Snapshot | Companion Runtime | 最近一次完整基线加连续 Frame；可全部丢弃重建 |
| 跨 Session 收件箱 | Companion Runtime | 从 Session 与 Interaction Snapshot 派生，不独立持久化 |
| 修改请求进行中状态 | Companion Runtime | `interactionId + operationId`；resolved Frame 后删除 |
| 当前路由 | UI Shell | 浏览器 URL |
| 表单选项 | 对应 UI 插件 | 组件状态 |
| Connection 代次和重连状态 | Connection Provider | 单个 Provider lifecycle controller |

Runtime 对 React 暴露 immutable snapshot 和 subscribe 接口。UI 不消费原始 Frame，也不维护第二份 pending Interaction 列表。

## Connection and failure semantics

Connection Provider 区分 booting、connected、reconnecting、resyncing、offline 和 failed。每个修改命令携带客户端生成的 `operationId`；相同键返回同一个操作 Promise，不重复执行。另一个键在相同 Interaction 仍有操作进行时得到稳定 invalid 结果。

Provider 的 `dispose()` abort 当前代次并等待所有操作与重连任务结束。Abort Listener 在 Timer 结算时移除，失败操作释放 Interaction 占用，使新连接代次可以重试。

Runtime 在非 connected 状态拒绝修改，并区分 NOT_CONNECTED、STALE_INTERACTION、INVALID_RESOLUTION、FORBIDDEN 和 Provider 业务失败。UI 保留提交错误和用户选择，不用一个通用网络错误替代这些结果。

## Mobile interface

收件箱是首屏，按问题、审批、完成和失败展示跨 Session 事项。手机使用底部三个导航目的地，桌面使用固定侧栏；两种布局装载相同插件并读取同一 Runtime Snapshot。

Session 页面使用单主列，依次展示紧凑上下文、内联 Interaction 和 Conversation。待处理操作位于有独立滚动区域的历史之前，使审批与回答在手机首屏可达。审批只展示 Fixture Host 提供的 Tool、命令、风险和说明字段。设置页明确显示演示数据、未配置真实设备身份，并提供重新连接操作。

所有图标来自 Lucide。界面没有 Marketing Hero、嵌套卡片或远程 Schema 生成的高风险表单。

## Boundaries

Stage 0 不连接真实 Harness，不生成设备身份，不发送通知，也不提供生产配对。浏览器刷新会从 Fixture 基线重建业务状态，不从 UI Store 恢复独立 Session 副本。

真实 Provider 开始前，Harness 需要拥有线协议 DTO 与 Parser、协议和 Capability 协商、设备认证主体、请求 Scope、Interaction 稳定 ID 与 resolved Event、幂等命令，以及断线恢复或新基线语义。Companion 不复制这些 Schema 为第二个来源。

## Verification

- `pnpm run typecheck` 覆盖严格 TypeScript 接口和 Package 消费关系。
- `pnpm run lint` 覆盖代码静态检查。
- `pnpm run test` 通过 11 个测试，覆盖 Provider 注册与卸载、UI Contribution 卸载、基线派生、重复提交复用、权威 resolved 提交点和重连期间拒绝修改。
- `pnpm run build` 从真实 Web Entry 生成 Vite 生产产物。
- `pnpm run test:web` 在 390x844、430x932 和 1280x800 的 Chrome 视口通过 12 条流程，覆盖待处理操作首屏可达、回答问题、提交中、resolved 后移除事项、reconnecting、resyncing 和横向溢出。
- 浏览器人工检查覆盖手机收件箱、Session 问题、提交中、resolved、设置以及桌面收件箱；页面控制台没有错误。

## Alternatives considered

**直接复制 Harness Web 客户端。** 可以快速获得 Conversation，但会带入桌面导航、同版本同源连接和整套 workspace 依赖，无法证明独立移动客户端的恢复与注意力工作流。

**第一步实现真实远程认证。** 安全价值高，但上游 Wire Package、设备身份和恢复语义尚未完成；同时开发会让客户端接口跟随临时 Host 实现变化。

**将 Session Runtime 与 Attention Runtime 拆成两个 Package。** 原型证明它们共享事件窗口、提交点和销毁顺序，拆分只会增加同步状态，因此当前合并。

**使用通用终端流。** 审批、问题、Session 状态和操作者来源会退化为文本，绕过 Harness 结构化语义。

**根据 Host Schema 自动生成操作表单。** 未知远端数据不能决定高风险修改界面。原生客户端只激活随应用签名发布的功能插件，未知能力默认只读。

## Consequences

仓库现在提供无需原生 SDK 的可运行视觉契约和插件生命周期证据。Fixture 让 UI 与 Runtime 能在真实远端协议之前迭代，但它只证明 Stage 0 组装，不证明认证、授权、真实 Harness 兼容性或模型回合。

当前 `ConnectionFrame` 是 Companion Fixture 所需的最小数据，不是最终公开 Wire DTO。真实连接工作必须以 Harness 所属 Package 为权威，并允许一次性调整 Stage 0 类型及所有 Consumer。

浏览器测试在本地使用已安装的 Chrome Channel。CI 环境需要提供 Chrome，或在执行测试前安装 Playwright Chromium 并覆盖 Channel 配置。
