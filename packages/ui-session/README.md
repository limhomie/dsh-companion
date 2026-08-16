# Session UI

注册 Session 列表与详情页面，从 Harness Client Runtime 展示 Header、问题与审批、Conversation 历史和纯文本排队输入。单列页面把待处理 Interaction 放在历史之前；拥有 `interaction:answer` 的设备可以提交问题、计划审阅与一次性审批，拥有 `session:prompt` 的设备可以向已有普通 Session 排队消息，其他设备显示只读提示。

历史和等待队列只读取上游 `ConversationSnapshot`，不保存消息副本。Prompt 草稿在组件内保留可重试的 Operation id，Host 接受后才清空；网络失败时复用同一 id，避免未知提交结果产生重复消息。Interaction 通过 `PendingWait.respond()` 发送，只有 Host 持久提交后的 resolved Frame 或新基线能移除；权限撤销、竞争和陈旧请求显示不同错误。

手机 Session 详情占用顶栏和底部导航之间的可用高度。待办和对话记录在各自区域滚动，排队输入始终保留在底部导航上方；桌面布局继续按文档流展示完整页面。
