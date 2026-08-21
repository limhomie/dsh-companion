# `@dsh-companion/host`

DSH Companion 的标准 Harness Bundle。`dsh plugin --profile web add @dsh-companion/host` 会把 `cordis.patch.yml` 加入 `web` profile，并注册设备信任 Provider、认证 Connection Consumer 与 `/companion/` 静态入口。

当前开发包只接受带最小认证扩展的 Harness `0.1.0-rc.5` 迁移基线。官方 `0.1.0-rc.8` 尚缺少认证主体传播和远程提交扩展点，插件会在暴露远程入口前明确拒绝加载。

安装包只含代码、声明、Patch、网页静态资源和文档，不含 `DSH_HOME`、设备记录、凭据、模型密钥或 Workspace 内容。
