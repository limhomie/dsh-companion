# Agent Note: 原生断线重试保留配对

Status: implemented

## Problem

已配对 Android 设备在 Tailscale 暂时不可达时进入连接失败页。该页面当前只提供“重新配对”，点击后立即删除持久 Host Origin、设备 id 和 Android Keystore 私钥。用户只是尝试恢复网络连接，却被迫重新创建 Offer、核对并批准设备；界面没有区分 Reachability 失败与设备身份失效。

Host 重启后如果 Tailscale Origin 转发到普通 `dsh web`，原生认证端点会返回纯文本 `404` 或无 JSON 的拒绝响应。客户端把它显示为“Harness 返回了无法解析的响应”，没有说明当前地址并未运行 Companion Host。持久配对仍然存在，但该提示会让用户误以为设备记录随进程退出而丢失。

## Decision

原生启动页保留“是否加载到持久配对”这一组件展示状态。已保存设备认证失败时，主要操作只重新执行持钥认证，不修改 Android 持久状态；页面明确说明原配对仍然保留。“删除配对”作为独立危险操作，必须经过二次确认后才能调用原生 `reset()`。

尚未保存设备的 Claim 或 Poll 失败返回配对输入页，不删除 Keystore。Host 仍然是设备记录的权威来源，Android SharedPreferences 仍然只保存非敏感连接信息；本改动不修改协议、认证、权限或 Connection Provider。

原生 HTTP 解析器把反向代理的 `502`、`503` 和 `504` 非 JSON 响应归类为暂时不可达。其他非 JSON 响应归类为 Host 部署错误，并明确要求在保存的 Origin 上启动 Companion Host，而不是普通 `dsh web`。错误正文不进入日志或界面。一键启动器继续以 Companion Manifest 判断已有实例；端口被其他服务占用时，提示用户关闭普通 Harness 后重试，并说明配置目录中的配对记录不会因此删除。

## Alternatives considered

**连接失败后自动清空配对。** Reachability 与 Authentication 是不同失败类别；暂时关闭 VPN、切换网络或 Host 重启都不构成撤销设备身份的证据。

**仅把现有按钮改名为“重试连接”，继续执行 `reset()`。** 文案与副作用不一致，仍会造成不可恢复的数据删除。

**无限自动重试，不提供显式操作。** VPN 状态变化不保证可靠触发 WebView 网络事件，无界后台重试也会增加电量和生命周期复杂度；当前切片先提供确定性的用户重试入口。

**为设备记录增加 MySQL。** 当前 Host 是单机权威来源，Storage Domain 已把设备公钥、访问级别和撤销状态持久化到 `DSH_HOME`。外部数据库不会修复错误服务占用 Origin，还会增加凭据运维、迁移和可用性依赖。

## Consequences

Vitest 覆盖普通 Harness 的纯文本响应、暂时不可用的反向代理和内存会话过期后的重新认证。Playwright 通过 Android 真实入口覆盖 Host 网络失败、Origin 上运行普通 Harness、重试、取消删除和确认删除，并检查 390x844 视口没有横向溢出。使用现有 `DSH_HOME` 在备用回环端口启动真实 Companion Host 后，Manifest 返回预期应用身份，持久 Android 设备记录可以直接签发新的原生 Challenge，不要求重新配对。
