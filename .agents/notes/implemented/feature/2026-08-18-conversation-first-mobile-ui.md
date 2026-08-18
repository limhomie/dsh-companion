# Agent Note: 对话优先的移动界面

Status: implemented

## Problem

Companion 已经能够从 Android 创建 Session、读取完整对话、发送消息和停止运行，但手机上的 Session 详情仍按管理页面组织：全局品牌栏、返回按钮、标题区、三列上下文信息、对话卡片、Composer 卡片和底部主导航同时占用纵向空间。在 390x844 与 430x932 视口中，真实对话只得到页面中部的一小块滚动区域，输入操作也被“排队消息”等实现术语包围。用户虽然已经打通对话能力，看到的仍不是可以持续使用的聊天界面。

释放纵向空间之后，Conversation 内部仍使用统一的头像、标签、分隔线和嵌套卡片展示所有事件，Agent 文本也按纯文本段落输出。这与 Harness 网页端的阅读层级不同：用户消息是右对齐气泡，Agent Markdown 是无框正文，Think 与 Tool 是可展开的紧凑轨迹行，错误使用局部状态色，Composer 则是包含输入和上下文操作的一体化浮层。手机端若继续把这些内容压成同一种消息卡片，长任务仍然难以扫描，代码、列表和表格也会丢失语义。

早期架构基线把收件箱设为手机首页。这适合只有审批和只读历史的切片，但原生 Owner 已经可以独立开始对话，继续让收件箱占据默认入口会把主要工作流隐藏在第二个标签之后。

## Decision

Route Registry 的排序决定根路径默认页，`Session` 是第一入口，Shell 不硬编码任何业务 Route。收件箱和设置继续作为顶层辅助页，待处理计数与会话内 Interaction 不变。

手机 Session 详情使用单一聊天工作面。紧凑顶栏合并返回、标题、Workspace、模型、连接和运行状态；全局品牌栏与底部主导航在详情内隐藏；Conversation 占满顶栏和底部 Composer 之间的剩余高度。对话记录不显示嵌套卡片标题和边框，Composer 贴近屏幕底部，发送与停止使用图标按钮，队列与失败仍显示在 Composer 内。返回 Session 列表后恢复全局品牌栏和三个顶层入口。

Conversation Renderer 遵循 Harness 网页端的内容语义。用户与中途指令使用右对齐浅蓝气泡；Agent 文本使用 Harness `ui-primitives` 提供的 Markdown Renderer，以相同的 GFM、安全链接、代码块和流式解析规则呈现；Think、Tool、命令、上下文、重试和失败保持独立的紧凑轨迹行。已完成 Tool 只显示一次，折叠行概括名称、主要参数和状态，展开后再展示参数与结果。这个展示层只读取既有 `ConversationSnapshot`，不创建第二份消息模型。

Composer 使用与网页版一致的一体化圆角容器：可增长的文本区位于上方，连接、权限、模型和队列上下文位于底部工具行，发送或停止按钮固定在右下角。当前能力仍只允许纯文本 Queue Input；视觉上不伪造附件、模型切换、权限切换或其他尚未接入的操作。离开对话尾部时显示返回底部按钮。

桌面 Companion 保留侧栏和文档流页面。认证、权限、Connection、Session Snapshot、Interaction、Prompt Operation id、取消与错误状态继续由现有 Runtime 和 UI Consumer 拥有；本改动不增加协议、持久状态或原生 API。

Windows Chrome 同时启动多个 PWA 测试 Context 时会间歇中止首次 Service Worker 导航。Playwright 在 Windows 使用一个 Worker，其他平台保留六个 Worker；覆盖矩阵和每个场景保持不变。

## Alternatives considered

**直接把 Harness 官方 React 组件打进原生 App。** 官方会话列还依赖完整的 Slot 图、设置、模型选择、附件和桌面布局。当前原生连接只组装 Companion 已验证的远程能力；直接嵌入会扩大权限与兼容性范围，且不能解决尚未适配的本机专用操作。

**保留收件箱首页，只修改颜色和圆角。** 这不会减少主要对话前的导航层级，也不会释放全局顶栏、信息卡和底栏占用的空间。

**删除收件箱和设置。** 两者仍承载跨 Session 待办、设备信任和诊断，应该保留为辅助入口，而不是从产品中移除。

## Verification

- `pnpm run typecheck`、`pnpm run lint` 和 13 个 Vitest 测试通过。
- `pnpm run test:web` 构建 Web 与 Native 产物，并通过 44 个 Playwright 场景；覆盖 390x844、430x932、1280x800 与 Android Shell 视口。
- Fixture 流程证明根路径进入 Session、手机详情隐藏全局导航、Conversation 与 Composer 不重叠、返回后仍可进入收件箱，以及 Workspace 创建、首条消息和停止运行保持可用。
- Fixture 的 Markdown、用户字面量、Reasoning、Tool 成功与失败样本证明网页版内容层级在手机 Renderer 中保持语义，且 Tool 调用不会重复显示。
- 390x844 与 430x932 截图检查长历史、审批、Tool、用户消息和底部 Composer，没有横向溢出或控件遮挡。
- `pnpm android:apk` 使用 Capacitor 同步后的同一 UI 成功生成 Debug APK。Xiaomi 23013RK75C 覆盖安装、重新配对为 Owner、读取真实“手机对话已打通”历史并强制停止后冷启动；冷启动直接恢复 Session 列表，没有再次要求配对。

## Consequences

从对话切换到收件箱或设置需要先返回 Session 列表。这是为了给持续对话和输入释放完整高度；返回按钮始终位于会话顶栏左侧。

当前 Composer 仍只支持纯文本，Markdown 只用于显示 Agent 输出。官方客户端的附件、命令、模型选择和权限切换不会因为视觉接近而自动获得支持，后续移动适配必须继续按已组装能力逐项加入。
