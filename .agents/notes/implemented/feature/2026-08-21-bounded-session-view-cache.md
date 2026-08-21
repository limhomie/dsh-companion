# Agent Note: 有界的 Session 视图缓存

Status: implemented

## Problem

Harness Client Runtime 会保留已打开 Session 的权威内存快照，但 Companion 在路由切换时曾卸载当前 `SessionConversation`。再次切回最近会话时，历史数据通常不需要重新请求，React 仍要重新创建整棵 Markdown、Reasoning 和 Tool 对话树，并丢失滚动位置与未提交草稿。长会话在手机上因此存在可感知的切换停顿。

缓存完整 Session Event Log、持久化正文，或复制一份可独立更新的 Conversation 状态都会引入第二权威来源，并扩大手机泄露后的敏感内容范围。首次打开尚未加载的 Session 仍必须等待 Host 基线，不能用本地猜测替代。

## Decision

`ui-session` 在 Session Route 存活期间维护容量为 3 的最近访问视图 LRU。缓存项只保留已组装的 React 视图及其组件私有展示状态；`ConversationSnapshot` 始终直接读取对应的 Harness `SessionFace`，不序列化、不写入浏览器或原生存储。

非活动缓存项通过 `hidden` 离开可访问性树，并暂停 Session Snapshot 订阅；重新激活时从相同 `SessionFace.getSnapshot()` 同步最新权威快照，再恢复订阅。缓存命中不改变 DOM 顺序，因此已渲染对话、滚动位置和草稿保持不变。LRU 淘汰会卸载整棵视图，使组件 Effect、监听器和草稿一同释放；Session 从 Host 列表移除或 Session Route 卸载时同样释放对应缓存。

首次访问继续使用 `sessions.open()` 的 Host 历史加载与错误状态。缓存只优化在同一应用运行期间切回最近会话，不改变 Connection、权限、审批、Prompt 幂等、重连或历史分页语义。

## Alternatives considered

**把 ConversationSnapshot 或 Event Log 写入本地存储。** 这会增加敏感正文驻留时间，还需要加密、版本迁移、恢复游标和断线一致性协议；当前只优化一次运行中的会话切换，不扩大安全与协议范围。

**只依赖 Harness Client Runtime 的 Session 对象缓存。** 它已经避免大多数重复网络请求，但 React 对话树仍会在每次切换时重建，无法保留滚动位置和草稿，不能解决长历史的主要切换成本。

**预加载所有 Session 历史。** 公开 Runtime 只为当前 Session 打开历史窗口；预取会增加 Host 流量和手机内存，并要求新的公开扩展点。最近视图缓存保持这一边界。

## Verification

- LRU 单元测试覆盖稳定 DOM 顺序、最近访问淘汰、Host 删除、Route 清理和非法容量。
- 官方 Harness Fixture 的真实 App Entry 执行 A→B→A，证明原始 Conversation DOM、滚动位置和草稿被复用，且活动视图不出现重新加载阶段。
- 上述流程在 390x844、430x932 和 1280x800 三种视口通过。
- `pnpm run check` 通过类型检查、lint、33 个 Vitest 测试和生产构建。
- `pnpm run test:web` 通过 51 个 Playwright 场景，另有 3 个按视口条件跳过；原有审批、Session 创建、Prompt、停止、Viewer/Owner 与 Android Shell 场景保持通过。

## Consequences

同一次 Session Route 生命周期中，最近三个会话会在内存里保留已渲染正文和未发送草稿，换取更快的往返切换。隐藏视图不接收持续 Snapshot 通知，激活时仍以 Harness Runtime 的当前快照为准。第四个不同会话淘汰最久未访问项；退出 Session 顶层页面也会清空缓存。跨重启或跨页面持久缓存仍不存在，若以后需要，必须另行设计平台加密与恢复一致性。
