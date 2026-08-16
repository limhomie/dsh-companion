# Agent Note: 移动端只读 Conversation 历史

Status: implemented

## Problem

真实 Harness 连接已经让 Companion 展示 Session 摘要和待处理 Interaction，但 Session 详情不显示用户消息、Agent 回复或工具过程。用户无法仅凭标题和问题 Payload 判断 Agent 已经完成了什么，也不能在审批前查看最近上下文。

Harness Client Runtime 已经能够把 Session Event 折叠为公开的 `ConversationSnapshot`，但标准 Conversation Event Definition 和 `chat` View Definition 由 Harness `ui-conversation` 提供。只启动 Runtime 会得到空的节点列表；复制 Event Fold 会建立第二套 Conversation 状态实现，装载完整桌面 Conversation 插件又会同时引入 Composer、Layout、Locale、Settings 和 Attachment 组合。

## Decision

Companion 的 `conversation-projection` Cordis 插件在 Client Runtime 之后注册 Harness `ui-conversation` 已有的 Conversation Event Definition 和 `chat` View Definition。插件不拥有状态，只激活 Harness 标准 Fold；注册项由 Harness Registry 绑定 Cordis Effect，并随插件生命周期销毁。

`ui-session` 直接消费 `SessionFace` 的公开 `ConversationSnapshot`，不读取原始 Session Event，也不保存独立消息数组。只读 Renderer 覆盖核心 `ConversationNode` union、`partial` 和 `runningCalls`，展示用户与 steering 消息、Assistant 文本与推理、工具调用和结果、命令、压缩标记、重试与失败状态。

历史窗口继续由 Harness Client Runtime 所有。界面在 `hasMore` 时调用 `SessionFace.loadOlder()`，前插完成后保持当前阅读位置；实时快照更新只在用户位于底部附近时跟随最新内容。图片和未知扩展块使用安全的只读占位，不根据未知数据生成操作。

当前固定 Harness 版本只在 Package Manifest 明确声明的 `./src/*` 导出中提供 `registerConversationNodes()`。`conversation-projection` 隔离这项预发布版本耦合，TypeScript 的模块增强映射只指向同一上游 `ChatNodeDataMap` 声明。独立发布 Companion 前，Harness 需要提供编译后的正式投影子路径，届时只替换该插件的上游 Import。

## Capability roles and ownership

| Role | Owner | Responsibility |
|---|---|---|
| Definition | Harness Client Runtime registries and `ui-conversation` definitions | Interpret Session Event and build the `chat` snapshot |
| Provider | `@dsh-companion/conversation-projection` | Register the upstream definitions after Runtime boot |
| Consumer | `@dsh-companion/ui-session` | Render `ConversationSnapshot` without owning business state |

Harness Host remains authoritative for Session Event and Interaction state. Harness Client Runtime owns the history window, ordering, partial output, tool pairing, and snapshot publication. React owns only scroll-following state and an in-flight older-page layout measurement.

## Alternatives considered

**装载 `@deepseek-ai/dsh-client-ui-conversation/client`。** 该插件要求 Harness Slot Host、Layout、Locale、Settings、Attachment 和 Composer 服务。只为显示历史装载完整桌面组合会扩大产品能力和启动图，因此未采用。

**在 Companion 复制 Conversation Definition 或 Session Event Fold。** 两种做法都会让两处代码分别解释相同的 Session Event，并可能遗漏上游新增节点类型，因此未采用。

**只展示最后一条纯文本。** 审批上下文可能位于工具调用、结果或前几轮消息中，不能解决用户判断任务进展的问题。

## Verification

- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run test`
- `pnpm run test:web`
- 应用内浏览器通过真实 `/companion/?fixture` Origin 检查 390x844 与 1280x800 布局、Conversation 内容和页面级横向溢出

Playwright 在 390x844、430x932 和 1280x800 通过官方 Fixture 验证 `fx-alpha` 的真实用户消息、问题与审批流程。页面展示 67 个最近节点，并提供“加载更早的对话”。

## Consequences

用户打开 Session 后可以直接查看最近对话、工具过程、图片占位和失败状态，再决定如何回答问题或审批工具。Conversation 展示保持只读；Markdown、附件读取、Tool 专用 Renderer、复制、分支、Prompt、排队、中途指令和中断仍未开放。

生产 JavaScript 相比仅有 Client Runtime 的切片增加约 45 kB minified、11 kB gzip。当前没有性能证据支持复制轻量 Fold 或引入虚拟列表；后续优化必须继续保留 Harness Runtime 的单一状态所有权。
