# Host Web 插件

把 `packages/host-web/web-dist` 注册到现有 Harness `webServer` 的 `/companion` named prefix。插件只接受 `127.0.0.1` Host，固定兼容 Harness `0.1.0-rc.5`，并复用 Harness Frontend Static 的文件包含、MIME 和 SPA fallback 行为。

该插件不创建 HTTP Server、不读取 Session，也不修改 `/api` 信任规则。Route 注册属于 Cordis effect，插件卸载时自动撤销。
