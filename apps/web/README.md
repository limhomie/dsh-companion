# Web App

真实 Stage 0 App Entry。它只负责创建 Cordis Context、按顺序装载插件图、挂载 `AppShell` 和展示启动失败，不包含收件箱、Session 或 Interaction 业务分支。

开发服务器通过根目录 `pnpm dev` 启动。当前装配使用 Fixture Connection Provider，不连接真实 Harness。
