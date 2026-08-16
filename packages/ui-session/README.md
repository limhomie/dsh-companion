# Session UI

注册 Session 列表与详情页面，从 Harness Client Runtime 展示 Header、只读 Conversation 历史、问题和审批。历史只读取上游 `ConversationSnapshot`，不保存消息副本；提交通过 `PendingWait.respond()` 发送，HTTP receipt 只表示载体接受，只有 Host 的 resolved Frame 或新基线能移除 Interaction。
