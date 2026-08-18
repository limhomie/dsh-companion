# Agent Note: 原生手机新建 Session 与对话闭环

Status: implemented

## Problem

Android App 可以认证、恢复连接并控制已经存在的 Session，但 Session 为空时只显示空状态。用户无法从手机选择电脑上的 Workspace、创建 Session 并发送第一条消息，因此已打通的原生连接仍不能独立开始一次 Harness 对话。

现有 Session 详情已经从 Harness Client Runtime 读取对话、队列和 Interaction，也能向现有普通 Session 发送文本。缺失的是从 Workspace 基线进入 Host 权威 Session 的入口，以及运行期间明确的停止操作。客户端不能为了填补入口而自行生成 Session、消息或运行状态。

## Decision

`ui-session` 消费 Harness Client Runtime 已公开的 `IWorkspaces` 与 `ISessions`。Owner 在 Session 列表选择一个 Host Workspace；Consumer 调用 `connectWorkspace(workspaceId)`，等待 Host 创建或复用该 Workspace 的空白 Session，随后调用 `sessions.open(sessionId)` 并导航到 Session 详情。只有返回的 Session 已经进入 Runtime 列表和 Binding 后才离开选择页。

Workspace 列表、Session 列表、对话、队列、运行状态和错误继续由 Harness Runtime 拥有。React 只保存工作区选择器是否展开、当前提交中的 Workspace id 与一次失败文案。断线、Viewer、基线未就绪、没有 Workspace 或正在创建时禁用修改操作；失败停留在选择页并允许重试。

Session 详情沿用现有纯文本 Queue Composer。空白 Session 的第一条消息使用同一个 `SessionFace.prompt()` 和 Operation id 重试语义。运行期间显示 `SessionFace.cancel()` 对应的停止按钮；只有 Host 接受取消后，后续 Snapshot 才决定界面是否停止。停止失败显示在输入区，不在客户端改写运行状态。

这项能力不新增 Service Definition 或 Provider。Harness Client Runtime 是已有 Definition 与 Provider，`ui-session` 是新增 Consumer；原生与 Web 入口继续共享同一插件图。创建、发送和停止使用现有 Owner Endpoint 权限，Viewer 不显示可调用入口。

## Alternatives considered

**在 Companion 直接调用 `session.create` Remote。** 这会绕过 Runtime 对并发创建合并、空白 Session 复用、Workspace 归属和 Binding 就绪的规则，并复制错误处理。

**在 App 启动时无条件自动创建 Session。** 自动创建不能表达用户要使用哪个 Workspace，并会在用户只是查看收件箱时修改 Host 状态。显式入口更符合提交点和权限预期。

**嵌入 Harness 完整桌面 Workspace 浏览器与 Composer。** 桌面组件包含 Host 原生目录选择、附件、命令和多面板布局，其中部分 Endpoint 是 `local-only`。第一条移动切片只选择已经注册的 Workspace，并复用 Companion 已有对话 Renderer。

## Verification

- Harness 官方 Fixture Runtime 在 390x844、430x932 和 1280x800 视口完成 Workspace 选择、空白 Session 创建、首条纯文本消息和停止运行。
- 没有 Workspace 时，Session 空状态要求先在电脑注册 Workspace；Host 拒绝 Workspace 归属时，选择器保留错误和重试入口。
- 全部 40 个 Playwright 场景检查 PWA、桌面、两种手机视口和 Android Shell；13 个单元测试、类型检查、代码规范与生产构建通过。
- Debug APK 在 Xiaomi 23013RK75C 覆盖安装后保留 Keystore 配对。原生 Owner 选择 `deepseek-harness` Workspace，进入 Host 返回的空白 Session，并通过 `deepseek-v4-flash` 得到真实回复“手机对话已打通”。
- 真机页面同时显示 Workspace、模型、Host 同步状态、权威 Conversation 和底部 Composer，没有横向溢出或与底部导航重叠。

## Consequences

移动端只能选择 Host 已注册 Workspace。新增路径或打开系统目录选择器继续是电脑本机操作；App 不在手机上挂载 Workspace，也不持有模型 Credential。

`connectWorkspace()` 会复用同 Workspace 的现有空白 Session。这是 Harness Runtime 的正式 New Session 语义；界面不承诺每次点击都生成不同 id。

当前第一条消息使用 Host 默认模型和 Agent Preset。模型选择、附件、命令补全与新 Workspace 注册仍由后续独立切片处理，不能通过复制桌面状态临时加入。
