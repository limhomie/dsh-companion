# Agent Note: 可信手机向现有 Session 发送任务

Status: implemented

## Problem

手机可以查看真实对话并处理经过授权的待办，但处理完成后不能继续给 Agent 新任务。用户仍需要回到电脑输入下一条消息，可信连接无法形成从监督、处理阻塞到继续工作的闭环。

直接显示现有 Session Prompt 输入框会错误暗示手机拥有完整桌面权限。当前接口同时支持排队、中途指令和图片，客户端也没有保存能够安全重试未知提交结果的 Operation 身份，Session 页面尚未展示 Host 权威 Queue。

## Decision

第一条远程 Prompt 切片只允许获得 `session:prompt` Scope 的手机向现有普通 Session 发送非空纯文本 Queue Input。Session 空闲时该输入启动下一轮；Session 运行时输入进入下一轮队列。新建 Session、中途指令、停止、队列编辑、斜杠命令和图片继续不可用。

电脑回环设置页为每台设备增加独立的“允许发送任务”开关，并在开启前确认该权限可以让 Agent 使用当前 Session 已配置的工具。新配对设备仍只有 `session:read`，手机只能查看自己的当前授权，不能修改 Scope。

`companionDeviceTrust` 从 Host 当前 Principal 派生 `canPrompt()`，不在浏览器存储 Scope 副本。`ui-session` 使用已有 `SessionFace.prompt()` 与 `ConversationSnapshot.queue`，不建立第二份 Prompt 或 Queue Store。输入草稿、提交状态、Operation id 和最近错误属于组件内的一次提交生命周期。

输入区位于 Conversation 之后和手机底部导航之前。文本框保持有界，Send 图标按钮具有明确的禁用和加载状态。Host 返回 Accepted 后清空草稿；传输结果未知时保留草稿和原 Operation id，重试不能重复入队。权威 Queue 区显示等待数量与内容预览，被 Agent Claim 后由 Host Snapshot 自动移除并进入对话记录。

断线、Session Removed、Subagent、Scope 不足和提交中都会禁用输入。授权撤销会关闭 Connection；重新认证后界面从当前 Scope 和 Queue Baseline 重建。UI 不根据本地点击推断消息已经进入队列。

## Alternatives considered

**复用完整 Harness 桌面 Composer。** 该组件依赖桌面 Slot、Attachment、Slash、Queue Edit 与 Steering 组合。直接挂载会扩大远程能力并把 Companion 带入无关的 UI 架构。

**创建独立 `ui-prompt` Package 和通用 Session Slot。** 当前只有 `ui-session` 一个真实 Consumer。提前增加 Registry 会为尚不存在的第二个 Consumer 固化抽象；出现独立演进需求时再拆分。

**只在前端隐藏 Steer 与图片。** 网络调用可以绕过 UI。Harness 必须在解析后的请求上执行权限判定，界面隐藏只负责清楚表达可用能力。

**发送成功后增加本地聊天气泡。** Host Queue 与 Session Event 已经是权威状态，本地副本会在断线和多客户端操作下产生重复或错误顺序。

## Acceptance criteria

- 电脑可以为单台设备独立开启或关闭 `session:prompt`，并显示风险确认；手机没有权限升级入口。
- 获得 Scope 的手机可以在空闲和运行中的现有普通 Session 发送纯文本任务，没有 Scope 的设备保持只读。
- 提交中、Accepted、传输未知、Forbidden、Conflict、断线、Removed 与 Subagent 状态均有明确界面结果，失败不会丢失草稿。
- Queue 展示只读取 `ConversationSnapshot.queue`，消息被 Claim 后进入已有 Conversation Renderer，不保留第二份消息状态。
- 390x844、430x932 与桌面视口中输入区、Interaction、Conversation 和底部导航不重叠，也没有横向溢出。
- 单元测试覆盖授权派生、Operation 重试和错误映射；Playwright 通过真实 Harness Client Runtime 覆盖授权、发送、Queue、Claim、撤销与移动布局。

## Risks

Prompt 比 Interaction 应答拥有更大的间接执行能力。授权文案必须说明 Agent 会继续使用 Session 的现有工具和权限，不能把它描述成普通聊天权限。

固定底部输入区可能遮挡待处理 Interaction 或 Conversation。布局需要使用页面流和稳定的导航间距，不依赖视口高度猜测内容位置。

当前 Host-served Web 构建与 Harness 精确版本绑定。独立安装客户端仍需要协议版本与能力协商，本切片不把同源部署假设扩展到原生应用。
