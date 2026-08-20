# Agent Note: Host 同步的 Session 控件

Status: implemented

## Problem

Companion 的对话输入栏只显示静态的“完整控制”和 Host 默认模型名称，不能读取或修改当前 Session 的权限预设、模型和推理强度。新建 Session 也只能选择 Workspace，无法在空白 Session 开始前选择 Agent 预设。界面虽然接近 Harness 网页客户端，但这些文字不是可操作状态，手机端修改与电脑端状态无法收敛。

输入栏也没有 Host 命令入口。直接在 Companion 维护一份命令清单、模型表或权限值会复制 Harness 状态，并在插件组合、设置或其他客户端修改后失真。待审批与提问面板位于对话历史之前，在手机上会把当前操作推到屏幕顶端，离输入位置过远。

## Decision

Companion 只作为 Harness 既有能力的另一种 UI Consumer。当前 Session 的权限读取 `permissions` Projection，切换通过 Host `/permission <preset>` 命令提交；模型目录读取 `session.models`，模型与推理强度通过 `session.selectModel` 提交；输入栏每次打开命令菜单时读取 Host `command.list`，无参数命令直接通过 `command.execute` 执行，带参数命令把完整的 `/<name> ` 前缀放入 Composer 继续输入。菜单不维护静态命令清单。

Agent 预设只属于新会话流程。Workspace Picker 打开时读取 Host `agentPreset.list`，选择项随创建流程保留；Workspace 连接得到可复用或新建的空白 Session 后，通过 `agentPreset.select` 组合所选预设，再导航到 Session。Host 拒绝非空白 Session 的重新组合时，Picker 保持打开并显示失败，不能进入一个与用户选择不符的会话。

所有控件以 Host 回应和 Session Projection 为提交点。选择中的临时忙碌状态可以显示，但不能把本地点击值当作权威结果。权限、模型、推理强度和预设均使用 Host 返回的选项与标识；内置 Agent 预设只在展示层提供中文名称和说明。Full access 切换必须经过显式风险确认。

对话顶栏只保留 Session 标题和运行状态，不再重复 Workspace 与模型。Workspace、权限、模型和推理强度位于输入栏附近。待处理 Interaction 排在 Conversation 历史之后、Composer 之前；手机端因此固定出现在对话下方，同时继续使用既有 Interaction 回应和冲突处理。

命令、权限和模型菜单只保留一个打开状态。指针落在 Composer 控制区之外或按下 Escape 会关闭菜单；菜单内部选择继续完成对应的 Host 操作。

## Alternatives considered

**加载 Harness 官方完整 Conversation 插件图。** 官方输入栏依赖 Locale、Slots、Input Trigger、Commands、Settings 和多个业务插件。Companion 当前拥有独立的单面板移动布局，整体装配会同时引入尚未适配的附件、设置和桌面 Shell。当前阶段复用公开 Host API、Projection 与数据类型，保留 Companion 的展示层。

**在 Companion 写死三个权限、四个模式和模型列表。** 这会把部署配置和插件组合复制到手机，并且无法表示自定义预设、其他模型 Provider 或 Host 增删的命令。只有 Full access 的风险标识和内置预设的中文展示文案属于客户端固定展示规则。

**允许正在运行的 Session 切换 Agent 预设。** Harness 明确只允许空白 Session 重组。运行后切换会使历史中的工具和新组合不一致，因此模式选择只出现在新会话流程。

## Verification

- Fixture 的真实 Client Runtime 覆盖 Agent 预设选择、权限 Projection 切换、Host 命令加载与执行、模型切换及 Off／High／Max 推理强度。
- Playwright 在 390x844、430x932 和 1280x800 验证菜单触摸目标、无横向溢出、Interaction 位于历史之后且 Composer 之前。
- Playwright 分别打开命令、权限和模型菜单，并验证点击对话区后菜单关闭且没有提交操作。
- Web 与 Native 使用同一 React 组件和 Host 写入路径；Native 构建同步后产出 Android Debug APK。

## Consequences

命令输入仍是纯文本参数。需要专用表单的命令先把 Host 声明的命令前缀与提示放入 Composer，用户补全后再提交；权限和模型已有专用选择器，不经过自由文本。

模型选择是 Host 中当前 Agent 的下一次请求配置。其他客户端重新打开模型选择器时从 `session.models` 读取同一 Host 值；当前运行中的 Step 保留已经组装的配置。
