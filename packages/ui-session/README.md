# Session UI

注册 Session 列表与详情页面，从 Harness Client Runtime 展示 Header、问题与审批、只读 Conversation 历史。单列页面把待处理 Interaction 放在历史之前；拥有 `interaction:answer` 的设备可以提交问题、计划审阅与一次性审批，其他设备显示只读提示。历史只读取上游 `ConversationSnapshot`，不保存消息副本。提交通过 `PendingWait.respond()` 发送，只有 Host 持久提交后的 resolved Frame 或新基线能移除 Interaction；权限撤销、竞争和陈旧请求显示不同错误。
