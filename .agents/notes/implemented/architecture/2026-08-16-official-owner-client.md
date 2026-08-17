# Agent Note: Owner 设备转交官方客户端

Status: implemented

## Problem

Companion 自己实现了 Session、对话、输入和设置界面。即使继续增加远程控制权限，这套界面也无法自动获得 Harness 官方客户端新增的命令、模型、Workspace、Settings 和插件功能，最终会形成需要长期同步的第二套客户端。

## Decision

Companion 只为 `viewer` 和未配对浏览器提供配对、只读与设备管理入口。当前认证设备是 `owner` 时，启动流程在装载 Harness Session Runtime 前导航到官方根客户端。官方入口由 Harness 验证同一个 HttpOnly Cookie，并启动 Host 当前选择的官方插件图。

回环设备管理页把两项细粒度授权开关替换为一个“完整控制”开关。开启前显示二次确认，明确说明该手机可以运行命令、修改 Workspace、创建和控制 Session、处理审批，以及更改设置与 Credential。关闭后设备回到只读 Companion；Harness 的授权替换负责断开旧连接，Companion 不推断授权已经生效。

现有 Companion Session UI 暂时保留给 `viewer`，直到官方客户端完成移动布局插件。移动布局实现后，Companion 删除重复的 Session、Inbox 和 Settings 产品界面，只保留配对、PWA、通知与原生平台适配。

## Alternatives considered

**继续扩展 Companion UI。** 每项 Harness 功能都需要再实现一次协议消费、状态投影、错误状态和移动测试，维护成本随官方插件图增长。

**复制第三方 Harness 客户端主题。** 第三方代码可以提供交互参考，但不能替代官方 Runtime 和插件职责；复制会产生另一份状态与升级路径。

**所有已配对设备直接进入官方客户端。** 新配对手机会立即拥有高风险操作，不再存在可安全检查会话的只读级别。

## Verification

- Companion Playwright 覆盖未配对引导、Viewer 只读界面和 Owner 导航到官方根路径。
- Device-trust 单元测试覆盖 Owner 能力派生与 `viewer`／`owner` 访问级别协议。
- Harness 聚焦测试覆盖旧 API 策略的类型穷尽、Viewer／Owner 拒绝、Host Event 过滤、访问级别替换与撤销。
- Harness Web 入口测试覆盖回环、未安装设备信任、未配对、Viewer、Owner 和不兼容响应。

## Consequences

第一阶段的官方客户端沿用桌面布局，手机体验可能不够紧凑。该限制由后续移动布局插件解决，不在 Companion 中建立另一套临时官方 UI。

新配对手机继续获得可检查 Session 的 Viewer 体验；完整控制始终需要电脑本机单独确认。Owner Cookie 具有远程操作 Harness 的高权限，降级、撤销与有限凭据寿命不能替代可信浏览器 Profile 和私有 HTTPS 部署。
