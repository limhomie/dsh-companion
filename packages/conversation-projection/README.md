# Conversation Projection

在 Harness Client Runtime 启动后注册上游标准 Conversation Event Definition 与 `chat` View Definition。插件不保存 Session Event 或消息副本；`ui-session` 只消费 Runtime 生成的 `ConversationSnapshot`。

当前固定 Harness 版本仅通过显式的 `./src/*` Package Export 提供注册入口。本 Package 隔离该预发布依赖；独立发布 Companion 前改用 Harness 的编译后公共子路径。
