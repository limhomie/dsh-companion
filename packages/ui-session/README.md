# Session UI

注册 Session 列表与详情页面，从 Harness Client Runtime 展示 Workspace 与 Agent 预设选择、Header、问题与审批、Conversation 历史和纯文本排队输入。原生 Owner 可以从 Host 已注册 Workspace 调用 `connectWorkspace()`，为 Runtime 创建或复用的空白 Session 选择 Agent 预设并发送第一条消息；浏览器 Owner 仍会转交官方客户端，Viewer 显示只读提示。单列页面把待处理 Interaction 放在历史之后、Composer 之前。

Workspace、Session、历史、运行状态和等待队列只读取上游 Runtime Snapshot，不保存业务状态副本。创建成功后才打开 Host 返回的 Session；Prompt 草稿在组件内保留可重试的 Operation id，Host 接受后才清空。停止操作调用 `SessionFace.cancel()`，界面继续等待 Host Snapshot 结束运行。Interaction 通过 `PendingWait.respond()` 发送，只有 Host 持久提交后的 resolved Frame 或新基线能移除；权限撤销、竞争和陈旧请求显示不同错误。

Session 是 Companion 根路径的默认入口。Shell 在桌面常驻显示 Session 侧栏，在手机通过顶栏按钮或页面任意位置向右拖动打开抽屉；从抽屉向左拖动返回对话。两个方向中，对话层与抽屉使用同一位移进度，反向拖动会逐步恢复；慢速拖动松手超过抽屉半宽才切换，否则回弹，快速短滑可以在较短位移后直接切换。运行中的 Session 显示旋转状态，未查看的完成 Session 显示 Harness Runtime 提供的绿点，打开后由 `sessions.open()` 清除。手机 Session 详情使用独立聊天工作面：紧凑顶栏只展示侧边栏入口、标题和运行状态，对话记录占用剩余高度，待处理操作与排队输入固定在对话下方。待办和对话记录在各自区域滚动，桌面布局继续按文档流展示完整页面。

对话 Renderer 复用 Harness `ui-primitives` 的 Markdown 组件展示 Agent 正文，用户输入保持字面文本并使用右对齐气泡。Reasoning 与 Tool 调用显示为可展开轨迹行；已有结果的 Tool 调用只显示一次，折叠态保留名称、主要参数和完成状态。底部 Composer 把文本区、Host 命令、权限、模型、推理强度、队列状态与发送或停止操作放在同一个容器中。权限读取 Session `permissions` Projection 并通过 `/permission` 写回；模型目录与推理强度读取 `session.models` 并通过 `session.selectModel` 写回；命令菜单每次从 Host `command.list` 加载。命令、权限和模型菜单在点击控制区外或按下 Escape 后关闭。附件仍未接入。
