# Agent Note: 原生断线重试保留配对

Status: implemented

## Problem

已配对 Android 设备在 Tailscale 暂时不可达时进入连接失败页。该页面当前只提供“重新配对”，点击后立即删除持久 Host Origin、设备 id 和 Android Keystore 私钥。用户只是尝试恢复网络连接，却被迫重新创建 Offer、核对并批准设备；界面没有区分 Reachability 失败与设备身份失效。

## Decision

原生启动页保留“是否加载到持久配对”这一组件展示状态。已保存设备认证失败时，主要操作只重新执行持钥认证，不修改 Android 持久状态；页面明确说明原配对仍然保留。“删除配对”作为独立危险操作，必须经过二次确认后才能调用原生 `reset()`。

尚未保存设备的 Claim 或 Poll 失败返回配对输入页，不删除 Keystore。Host 仍然是设备记录的权威来源，Android SharedPreferences 仍然只保存非敏感连接信息；本改动不修改协议、认证、权限或 Connection Provider。

## Alternatives considered

**连接失败后自动清空配对。** Reachability 与 Authentication 是不同失败类别；暂时关闭 VPN、切换网络或 Host 重启都不构成撤销设备身份的证据。

**仅把现有按钮改名为“重试连接”，继续执行 `reset()`。** 文案与副作用不一致，仍会造成不可恢复的数据删除。

**无限自动重试，不提供显式操作。** VPN 状态变化不保证可靠触发 WebView 网络事件，无界后台重试也会增加电量和生命周期复杂度；当前切片先提供确定性的用户重试入口。

## Consequences

Playwright 通过 Android 真实入口模拟已保存设备的 Host 网络失败，覆盖首次失败、重试、取消删除和确认删除，并检查 390x844 与 430x932 视口没有横向溢出。已被 Host 撤销或 Keystore 已损坏的设备仍会停留在失败页，用户需要显式删除配对后重新建立身份；客户端不会根据一次错误自动销毁长期身份。
