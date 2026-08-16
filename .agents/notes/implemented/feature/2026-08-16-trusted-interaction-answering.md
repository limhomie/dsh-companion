# Agent Note: 可信手机处理问题与审批

Status: implemented

## Problem

经过配对的手机已经可以查看真实 Session 和待处理状态，但无法在离开电脑后回答 Agent 问题、确认计划或处理工具审批。Agent 因此仍会停在需要人工输入的位置，可信连接只解决了观察问题，没有完成最有时间价值的移动工作流。

直接允许现有 `/api/respond` 会留下三个缺口。第一，当前设备只有 `session:read`，缺少由电脑本机明确授予和撤销的修改权限。第二，载体认证得到的设备主体没有到达 Host 的 Interaction 提交点，持久 Session Event 无法说明决定来自哪台设备。第三，HTTP 响应丢失、多设备竞争和授权撤销可能发生在同一项待处理请求上，客户端点击状态不能代替 Host 的唯一提交结果。

## Proposal

### 用户工作流

电脑设置页在每台已配对设备下提供“允许处理问题与审批”权限。该权限默认关闭，只能从回环页面开启，并在确认对话框中明确说明：允许一次工具审批可能导致电脑执行所展示的操作。开启后，手机重新连接并显示问题、计划确认以及审批按钮；关闭权限或撤销设备后，这些控件立即失效。

手机提交后保持“等待 Host 确认”状态。只有 Host 发布已经持久提交的 resolved Frame 或新的权威基线，界面才移除待处理项。传输失败保留用户选择；过期、被另一设备抢先处理和权限被撤销使用不同错误状态。

本阶段不提供新建 Session、Prompt、排队输入、中途指令、中断、命令、文件浏览、设置修改或权限升级。手机不能通过业务 Payload 声明设备身份、Scope 或 Actor 来源。

### Scope 与设备管理

Harness 的设备信任词汇增加 `interaction:answer`。该 Scope 以 `session:read` 为前置条件，只允许回答 Host 已经发布的 approval、question 和 plan-review Interaction。配对仍只授予 `session:read`；修改 Scope 是独立的本机管理操作，不把高风险权限塞进扫码批准步骤。

设备信任 Service Definition 增加原子更新 Scope 的方法和提交后事件，本地 Provider 更新现有持久记录。Connection Consumer 提供两个经过运行时校验的端点：回环页面更新指定设备的 Scope；当前已认证设备读取自己的 UI 安全主体与 Scope。远程设备不能列出其他设备或修改任何授权。

Scope 更新提交后，Connection 终止该主体的下行流和进行中的修改请求。手机重连后重新读取当前 Scope，不依赖配对时返回的数据，也不在浏览器存储权限副本。授权撤销与 Interaction 提交竞争时，以 Host 持久事件的提交顺序为准：事件先提交则决定保留，Scope 更新先提交则修改请求被取消。

### 插件与状态所有权

| 单元 | 角色 | 职责 |
|---|---|---|
| Harness action-source vocabulary | 公共类型 | 定义可声明合并的持久 Actor 来源；内置本机用户来源，设备信任贡献 paired-device 来源 |
| Harness device-trust | Service Definition | Scope 词汇、当前主体、原子授权更新及更新事件 |
| Harness device-trust-local | Service Provider | 持久设备 Scope，认证时始终读取当前授权 |
| Harness device-trust-connection | 授权 Consumer | 把当前设备 Scope 映射到 Connection 请求能力，提供本机授权管理与远程当前主体端点 |
| Harness Connection | 认证载体 | 把不可由 Payload 伪造的主体和撤销 Signal 传到已解码请求，并执行已注册的能力判定；不解释 Interaction 业务字段或设备 Scope |
| Harness API Proxy | 请求分类与提交协调 | 用 Host 待处理表识别 rpcId 的 Interaction 类型，向 Connection 请求对应能力判定并协调唯一提交 |
| Harness user-approval | 持久事件所有者 | 在 `approval/decided` 中记录决定来源 |
| Harness user-questions | 持久事件所有者 | 记录与 Host 问题请求 id 关联的 `question/answered` 来源，再把答案交给 Tool |
| Companion device-trust-web | 客户端能力 | 读取当前 Scope，供 UI 订阅；本机页面调用授权管理端点 |
| Companion ui-settings | UI Consumer | 显示 Scope、二次确认、开启和关闭权限 |
| Companion ui-inbox/ui-session | UI Consumer | 只在当前主体拥有 Scope 时显示应答控件，提交后等待 Host 权威结果 |

Harness 继续拥有 Session、待处理 Interaction、设备授权和持久 Actor 来源。Companion 不建立第二份待处理列表；`PendingWait` 保存 operationId，UI 只保存表单选择、提交状态和最近错误，并在对应 Interaction resolved 后卸载。

### 认证、授权与载体

Connection 的远程认证分为两步。第一步在读取大请求体前验证 Cookie、当前设备记录和目标路径。第二步在结构化解析 `/api/respond` 后，把认证主体交给 Host API Proxy；API Proxy 根据自己的待处理注册表判断 rpcId 属于 approval 或 question，再向 Connection 请求 `interaction:answer` 能力判定。device-trust-connection 用 Host 当前持久 Scope 回答该判定；API Proxy 不依赖具体身份 Provider。未知或以后新增的响应类型默认拒绝，不能因为复用 `/api/respond` 自动获得权限。

Mux 下行仍只包含 Harness 已有的 Session 与 Interaction Frame。`host/remote-event` 保持全部过滤；本阶段不会开放 Host 原生对话框或任意 Remote Event。API Proxy 只接受与原待处理项匹配的 sessionId、approvalId、问题集合和闭合 outcome 词汇。

每个提交携带客户端生成的 operationId，Host 以“认证主体 + operationId”缓存结果，并以稳定 rpcId 绑定原待处理项。相同 operationId 的传输重试返回原结果，不再次决定；不同设备或 operationId 竞争同一 rpcId 时，第一项持久提交获胜，其余得到稳定的 stale/conflict 结果。缓存只保存操作关联和结果，不保存 Credential 或完整答案。

### 持久提交与恢复

远程 Actor 使用 `{ kind: 'paired-device', deviceId }`，本机交互使用 `{ kind: 'user' }`。设备标签不写入 Session Log；展示时可用 deviceId 查询当前或已撤销的信任记录。原始 Cookie、摘要、Scope 列表和网络地址不得进入 Session Event。

审批的提交点是携带 Actor 来源的 `approval/decided` 事件完成 append。问题与计划确认增加一个与 Host 问题请求 id 关联的 log-only `question/answered` 事件；该事件在答案进入模型可见 `tool/result` 前提交，只记录 Actor 来源和关联 id，不复制答案内容。任一 Actor 事件 append 失败时，Host 不返回 accepted，也不把答案交给 Agent。

API Proxy 只在对应持久事件提交后发布 resolved Frame 并完成成功 receipt。断线重连重放同一 rpcId；已提交项不再出现在新基线，未提交项仍可用原 operationId 重试。客户端收到成功 HTTP receipt 仍等待 resolved Frame，以同一规则处理响应丢失和多客户端竞争。

### 失败与生命周期

| 条件 | Host 结果 | 手机行为 |
|---|---|---|
| 没有 `interaction:answer` | 403，修改逻辑不运行 | 保持只读并提示需要电脑授权 |
| rpcId 不存在或已经处理 | stale/not-pending | 重新同步；不建议重复选择 |
| Payload 与原请求不匹配 | bad-response | 保留表单并显示请求已失效 |
| 相同 operationId 重试 | 返回首次稳定结果 | 继续等待 resolved 或重新同步 |
| 另一设备先提交 | conflict | 显示已由其他位置处理并刷新 |
| Scope 关闭或设备撤销 | 中止进行中请求并关闭下行流 | 重新连接后回到只读状态 |
| 断线发生在提交结果未知时 | 不推断成功或失败 | 使用原 operationId 重试或等待基线 |
| 插件卸载或 Host 关闭 | 中止请求并等待处理任务结束 | 显示离线，保留未提交选择 |

## Alternatives considered

**同时开放 Prompt、排队、追加指令和停止。** 这些操作拥有不同的持久事件、并发规则和恢复语义，也需要更细的 Scope。与 Interaction 应答一起实现会让第一项远程修改无法得到聚焦的安全证据。

**只把 `/api/respond` 加入 HTTP 白名单。** URL 不能说明 rpcId 当前代表的 Host 请求类型，也不能为未来新增响应类型维持默认拒绝；同时无法把认证设备写入权威事件。

**重新配对时一次授予读写权限。** 扫码批准的主要目标是建立设备身份，把高风险授权混在其中会弱化最小权限，也迫使现有只读设备撤销后重配。

**由 Companion 在 Payload 中发送 deviceId 和 Scope。** 浏览器可以伪造这些字段。Actor 与权限必须来自验证 Cookie 后的 Host Connection 上下文。

**HTTP 成功后立即从 UI 删除 Interaction。** receipt 只能证明载体收到了请求，不能证明 Session Event 已经持久提交；响应丢失和多设备竞争会产生错误的已完成状态。

## Acceptance criteria

- 新配对设备仍只有 `session:read`，手机没有权限升级入口。
- 电脑可以单独为一台设备开启和关闭 `interaction:answer`，更新持久化并使该设备重新认证。
- 获得 Scope 的手机可以在 390x844 和 430x932 视口回答普通问题、确认计划、允许一次或拒绝审批；没有 Scope 的同一界面保持只读。
- 未认证、已撤销、Scope 不足、未知响应类型、伪造 Actor、Payload 不匹配和跨 Origin 请求在状态改变前被拒绝。
- 相同 operationId 的重试只产生一个持久结果；两个设备竞争时只有一个结果事件，失败方得到可区分的冲突。
- `approval/decided` 和 `question/answered` 保留认证设备 id，本机操作保留本机用户来源；Secret 和答案副本不进入来源事件。
- resolved Frame 只在持久事件提交后发布；断线恢复不会重复问题、重复执行审批或丢失已经提交的结果。
- Scope 关闭或撤销会终止该主体的活动 WebSocket 与尚未提交的 HTTP 修改请求，下一次连接回到只读。
- Harness 聚焦测试覆盖设备授权 Provider、Connection 主体传递、API Proxy 分类、持久提交、幂等、多设备竞争和撤销竞态；真实组装 Snapshot 展示手机应答形成的权威 transcript。
- Companion 单元测试覆盖权限派生和错误映射，Playwright 通过真实 Harness Client Runtime 覆盖授权、提交中、resolved、冲突、撤销和移动视口无溢出。

## Risks

- `approval/decided` 和新增 `question/answered` 会改变 Session Event 词汇，必须同步事件 JSDoc、Invariant、已知事件目录、持久化读取策略、Projection 和无密钥 Snapshot；是否属于结构格式变化按 Session 版本规则判断，不能由 Companion 自行决定。
- `/api/respond` 当前先结算进程内 pending 再让领域服务追加事件。实现必须调整这一时序，使持久 append 成为唯一提交点，不能只在外围补一条审计事件。
- Scope 更新与进行中请求需要共享同一个主体生命周期 Signal。只关闭 WebSocket 而不取消已认证 HTTP 请求会留下撤销后的提交窗口。
- 问题答案可能包含敏感文本。幂等缓存只保存 receipt 与关联 id，完整答案只经过现有结构化校验并进入其权威 `tool/result`，不写入设备信任数据或诊断日志。
