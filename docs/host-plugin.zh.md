# Companion Host Bundle 安装与生命周期

`@dsh-companion/host` 是由 DSH Companion 仓库发布的标准 Harness Bundle。它通过官方 profile 插件机制加载，不修改 Harness 安装目录，也不要求用户维护 Harness 源码分支。Bundle 包含 `/companion/` 静态入口、设备信任 Service Definition、本地持久 Provider 和认证 Connection Consumer；Session、Agent、Interaction、权限和持久事件仍由 Harness 持有。

## 当前兼容状态

| Harness 基线 | 状态 | 原因 |
|---|---|---|
| 本地迁移基线 `0.1.0-rc.5` / `f652a3263943a26ebfa3f0945230c1f40884637d` | 可用于开发验证 | 已包含 Companion 所需的通用认证主体、Endpoint 访问级别、撤销生命周期、ActionSource 和幂等提交能力 |
| 官方 `0.1.0-rc.8` | 不兼容 | 官方 Connection 文档仍明确没有认证层，也没有向 API Proxy 传播认证主体的公开契约 |
| 后续官方版本 | 待上游能力发布并完成组装验证 | 不能只按 semver 推断兼容；必须通过 Bundle 的版本与能力检查 |

因此，当前代码已经消除了临时 `--patch` 和 Companion 专用 Provider 位于 Harness 仓库中的分发方式，但还不能宣称现有官方 Harness 可以承载 APK 的 Owner 工作流。不兼容 Host 会在认证 Consumer 加载和远程入口开放前失败，并指出检测版本或缺少的公开能力。

## 开发基线安装

当前源码开发仍要求相邻的迁移基线 checkout。先构建，再让官方 `dsh plugin` 命令把本地 Bundle 链接进 `web` profile：

```powershell
pnpm run build
pnpm run host:plugin:install
pnpm run host:plugin:verify
```

`host:plugin:verify` 使用 `dsh --profile web --dump-config` 检查 `companion-web`、`companion-device-trust` 和 `companion-device-trust-connection` 三行。`pnpm host` 会自动执行构建与安装，然后使用普通 `dsh web` 启动，不再生成或传入 `--patch`。

## 官方版本发布后的安装

兼容版本发布并在本页兼容表中列出后，其他测试者只需在自己的 Harness 环境运行一条安装命令：

```powershell
dsh plugin --profile web add @dsh-companion/host@<已验证版本>
```

安装完成后核对真实组合：

```powershell
dsh --profile web --dump-config
```

输出必须包含 `@dsh-companion/host` 的三个 Companion 行。安装包只包含代码、声明、`cordis.patch.yml`、网页静态资源和文档；不会包含发布者或安装者的 `DSH_HOME`、设备记录、配对材料、Credential、模型密钥或 Workspace 内容。

## 启动与配对

Harness 继续只绑定回环地址，Tailscale Serve 只负责私有 HTTPS 可达性：

```powershell
$env:DSH_COMPANION_PUBLIC_ORIGIN = 'https://computer-name.tailnet-name.ts.net'
dsh web --trusted-host computer-name.tailnet-name.ts.net
```

电脑打开 `http://127.0.0.1:3080/companion/` 创建配对 Offer；手机或 APK 使用完整 HTTPS 配对链接，双方核对六位码后才批准。新设备默认是 Viewer，只有电脑回环设置页可以把它提升为 Owner。完整手机流程见[手机安装、连接与 Android 构建](mobile.zh.md)。

## 升级

先确认目标 Bundle 与 Harness 版本在兼容表中，再执行：

```powershell
dsh plugin --profile web update @dsh-companion/host
dsh --profile web --dump-config
```

重启 `dsh web` 后，Bundle 会再次执行版本和能力检查。升级不会迁移数据到手机；设备信任记录继续属于当前电脑的 `DSH_HOME`。

## 卸载

```powershell
dsh plugin --profile web remove @dsh-companion/host
```

卸载会从 `web` profile 移除 Bundle，Cordis 生命周期会撤销路由、访问 Guard、监听器和连接资源。它不会删除 `storages/device_trust.json`，以免一次软件卸载变成不可恢复的设备信任数据删除；永久清理必须是另一个明确的本机管理操作。

## 安全边界

Tailscale、LAN 地址和 `trustedHosts` 只建立 Reachability 与 DNS rebinding 防护，不代表设备已经认证。每个远程请求仍需由 Connection 产生认证主体，并经过 Viewer、Owner 或 local-only 的默认拒绝策略。修改 Host 状态的请求使用稳定操作 id，只有 Harness 权威事件提交后才成功；降级、撤销或断线会终止该主体的在途操作和下行连接。

APK 只持久化 Host Origin、设备 id、显示名称和 Android Keystore 中不可导出的私钥。Harness 配置、模型 Credential、Workspace 内容、原生短会话和 WebSocket Ticket 不进入 APK、URL、通知或日志。
