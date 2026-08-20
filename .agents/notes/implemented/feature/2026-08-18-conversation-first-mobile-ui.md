# Agent Note: 对话优先的移动界面

Status: implemented

## Problem

Companion 已经能够从 Android 创建 Session、读取完整对话、发送消息和停止运行，但手机上的 Session 详情仍按管理页面组织：全局品牌栏、返回按钮、标题区、三列上下文信息、对话卡片、Composer 卡片和底部主导航同时占用纵向空间。在 390x844 与 430x932 视口中，真实对话只得到页面中部的一小块滚动区域，输入操作也被“排队消息”等实现术语包围。用户虽然已经打通对话能力，看到的仍不是可以持续使用的聊天界面。

释放纵向空间之后，Conversation 内部仍使用统一的头像、标签、分隔线和嵌套卡片展示所有事件，Agent 文本也按纯文本段落输出。这与 Harness 网页端的阅读层级不同：用户消息是右对齐气泡，Agent Markdown 是无框正文，Think 与 Tool 是可展开的紧凑轨迹行，错误使用局部状态色，Composer 则是包含输入和上下文操作的一体化浮层。手机端若继续把这些内容压成同一种消息卡片，长任务仍然难以扫描，代码、列表和表格也会丢失语义。

早期架构基线把收件箱设为手机首页。这适合只有审批和只读历史的切片，但原生 Owner 已经可以独立开始对话，继续让收件箱占据默认入口会把主要工作流隐藏在第二个标签之后。

## Decision

Route Registry 的排序决定根路径默认页，`Session` 是第一入口，Shell 不硬编码任何业务 Route。收件箱和设置继续作为顶层辅助页，待处理计数与会话内 Interaction 不变。

手机 Session 详情使用单一聊天工作面。紧凑顶栏合并侧边栏入口、标题和运行状态；全局品牌栏不再重复显示；Conversation 占满顶栏和底部 Composer 之间的剩余高度。对话记录不显示嵌套卡片标题和边框，Composer 贴近屏幕底部，发送与停止使用图标按钮，队列与失败仍显示在 Composer 内。

Conversation Renderer 遵循 Harness 网页端的内容语义。用户与中途指令使用右对齐浅蓝气泡；Agent 文本使用 Harness `ui-primitives` 提供的 Markdown Renderer，以相同的 GFM、安全链接、代码块和流式解析规则呈现；Think、Tool、命令、上下文、重试和失败保持独立的紧凑轨迹行。已完成 Tool 只显示一次，折叠行概括名称、主要参数和状态，展开后再展示参数与结果。这个展示层只读取既有 `ConversationSnapshot`，不创建第二份消息模型。

Composer 使用与网页版一致的一体化圆角容器：可增长的文本区位于上方，连接、Host 命令、权限、模型、推理等级和队列上下文位于底部工具行，发送或停止按钮固定在右下角。当前能力仍只允许纯文本 Queue Input，不展示尚未接入的附件操作。离开对话尾部时显示返回底部按钮。

桌面 Companion 保留侧栏和文档流页面。认证、权限、Connection、Session Snapshot、Interaction、Prompt Operation id、取消与错误状态继续由现有 Runtime 和 UI Consumer 拥有；本改动不增加协议、持久状态或原生 API。

Windows Chrome 同时启动多个 PWA 测试 Context 时会间歇中止首次 Service Worker 导航。Playwright 在 Windows 使用一个 Worker，其他平台保留六个 Worker；覆盖矩阵和每个场景保持不变。

## Navigation drawer extension

Session 切换从独立列表页移入 Shell 拥有的左侧导航。Shell 继续直接订阅 `sessions.list`，不复制 Session Runtime 状态：运行中的 Session 使用旋转进度，`SessionSummary.completed` 使用绿色完成提醒，点击行先调用 `sessions.open()`，由 Harness Client Runtime 消除已经查看的提醒。手机通过顶栏按钮或在页面任意位置向右拖动打开抽屉，点击遮罩、选择页面或向左拖动关闭；桌面侧栏常驻同一 Session 列表。两个方向的抽屉、遮罩和对话层使用同一位移进度；对话层被抽屉向右推出，反向移动时逐步恢复。慢速拖动松手时超过抽屉实际宽度的一半才切换，否则回弹；持续不超过 280ms、同方向位移至少 28px 且速度达到 0.25px/ms 的短滑直接切换。纵向位移占主导时取消识别，避免干扰正常滚动。收件箱与设置保留为插件 Route，其中设置固定在抽屉底部。

`/sessions` 在存在 Session 时进入 Runtime 当前选择或最近一项，`/sessions/new` 保留 Workspace 与 Agent 模式创建流程；没有 Session 时继续展示创建或只读空状态。该路由变化不改变 Host Session、设备权限、认证或持久化。

命令、权限和模型菜单保持 Composer 私有展示状态。打开后，指针落在控制区之外或按下 Escape 都关闭当前菜单；菜单内部交互和切换另一个控制仍由原按钮处理。

验收覆盖按钮打开、页面任意位置右拖与抽屉内左拖跟手、对话层与抽屉边界同步、反向拖动恢复、慢拖半宽切换或回弹、两个方向的快速短滑、纵向滚动不误触、遮罩关闭、运行旋转状态、完成提醒在查看后消失、设置位于抽屉底部、三个 Composer 菜单的外部点击关闭，以及 390x844、430x932 和桌面视口无溢出或遮挡。

## Alternatives considered

**直接把 Harness 官方 React 组件打进原生 App。** 官方会话列还依赖完整的 Slot 图、设置、模型选择、附件和桌面布局。当前原生连接只组装 Companion 已验证的远程能力；直接嵌入会扩大权限与兼容性范围，且不能解决尚未适配的本机专用操作。

**保留收件箱首页，只修改颜色和圆角。** 这不会减少主要对话前的导航层级，也不会释放全局顶栏、信息卡和底栏占用的空间。

**删除收件箱和设置。** 两者仍承载跨 Session 待办、设备信任和诊断，应该保留为辅助入口，而不是从产品中移除。

## Verification

- `pnpm run typecheck`、`pnpm run lint` 和 15 个 Vitest 测试通过。
- `pnpm run test:web` 构建 Web 与 Native 产物，并通过 48 个 Playwright 场景，另有 3 个按视口条件跳过；覆盖 390x844、430x932、1280x800 与 Android Shell 视口。
- Fixture 流程证明根路径进入 Session、手机详情隐藏全局导航、Conversation 与 Composer 不重叠、返回后仍可进入收件箱，以及 Workspace 创建、首条消息和停止运行保持可用。
- Fixture 的 Markdown、用户字面量、Reasoning、Tool 成功与失败样本证明网页版内容层级在手机 Renderer 中保持语义，且 Tool 调用不会重复显示。
- 390x844 与 430x932 截图检查长历史、审批、Tool、用户消息和底部 Composer，没有横向溢出或控件遮挡。
- `pnpm android:apk` 使用 Capacitor 同步后的同一 UI 成功生成 Debug APK。Xiaomi 23013RK75C 覆盖安装、重新配对为 Owner、读取真实“手机对话已打通”历史并强制停止后冷启动；冷启动直接恢复 Session 列表，没有再次要求配对。
- Shell Fixture 覆盖页面中央右拖与抽屉内左拖时的双层跟手位移、反向拖动恢复、慢拖半宽松手切换或回弹、两个方向的快速短滑、纵向滚动不误触、按钮和遮罩操作、运行旋转状态、完成提醒在查看后消失、设置位于抽屉底部，以及命令、权限和模型菜单点击外部关闭。
- Xiaomi 23013RK75C 通过 `adb install -r` 覆盖安装本次 APK 后保留原有 Keystore 配对，直接恢复真实“你好”会话；Android UI 层可以访问侧边栏入口、Session、新建、收件箱、设置和连接状态。

## Consequences

从对话切换 Session、收件箱或设置时，手机使用顶栏按钮、慢速拖动超过半宽或快速短滑打开抽屉；返回对话使用对称手势。拖动过程中对话和抽屉共同移动，未提交的慢速拖动会回弹；桌面使用常驻侧栏。Session 完成提醒只来自 Harness Client Runtime，查看后由同一 Runtime 清除。

当前 Composer 仍只支持纯文本，Markdown 只用于显示 Agent 输出。官方客户端的附件、命令、模型选择和权限切换不会因为视觉接近而自动获得支持，后续移动适配必须继续按已组装能力逐项加入。
