# Session UI

注册 Session 列表与详情页面，从 Harness Client Runtime 展示 Workspace 选择、Header、问题与审批、Conversation 历史和纯文本排队输入。原生 Owner 可以从 Host 已注册 Workspace 调用 `connectWorkspace()`，在 Runtime 创建或复用的空白 Session 中发送第一条消息；浏览器 Owner 仍会转交官方客户端，Viewer 显示只读提示。单列页面把待处理 Interaction 放在历史之前。

Workspace、Session、历史、运行状态和等待队列只读取上游 Runtime Snapshot，不保存业务状态副本。创建成功后才打开 Host 返回的 Session；Prompt 草稿在组件内保留可重试的 Operation id，Host 接受后才清空。停止操作调用 `SessionFace.cancel()`，界面继续等待 Host Snapshot 结束运行。Interaction 通过 `PendingWait.respond()` 发送，只有 Host 持久提交后的 resolved Frame 或新基线能移除；权限撤销、竞争和陈旧请求显示不同错误。

手机 Session 详情占用顶栏和底部导航之间的可用高度。待办和对话记录在各自区域滚动，排队输入始终保留在底部导航上方；桌面布局继续按文档流展示完整页面。
