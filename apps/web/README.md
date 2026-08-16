# Web App

真实 Companion App Entry。它创建 Cordis Context，按 Harness 的公开依赖顺序装载 Typert Registry、Client Connection、API Gateway、Remotes 与 Client Runtime，再装载 Companion UI 插件并挂载 `AppShell`。入口不包含收件箱、Session 或 Interaction 业务分支。

生产构建输出到 `packages/host-web/web-dist`，由 Harness 同源提供。根目录 `pnpm dev` 只用于 `?fixture` 无密钥预览；真实入口通过 `pnpm host` 启动。
