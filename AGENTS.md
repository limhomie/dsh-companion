# AGENTS.md

DSH Companion 是 DeepSeek Harness 的移动优先伴侣客户端。开始修改前先阅读 [中文架构](docs/architecture.zh.md)；非机械性工作遵循 [设计与开发流程](docs/design-workflow.zh.md)。

## 当前阶段

项目尚未发布。优先建立正确的职责和协议，不增加兼容垫片；调整设计时一次更新所有引用。没有实现证据的选择保留为 Proposed Agent Note，不写成既成事实。

## 一切皆插件

- App Shell 只负责启动 Loader、根渲染和启动失败界面，不直接实现业务功能。
- 每项可替换能力都考虑 Service Definition、Service Provider、Consumer；只有当前存在独立演进需要时才拆包。
- 功能插件依赖能力接口和 UI Slot，不依赖具体网络载体或 Capacitor API。
- 每项注册都绑定插件生命周期并返回 disposer；卸载后不得残留监听器、请求或 UI Contribution。
- 新行为接入已记录的扩展点。修改 Harness Agent Loop 不是 Companion 功能的实现方式。

## 设计先于实现

- 非机械性改动必须新增或更新一个 Agent Note；优先更新已经拥有该决策的 Note，禁止为同一决策重复建档。
- 编码前明确：用户可观察问题、状态所有者、权威数据源、能力三角色、失败位置、生命周期、协议或持久化影响、验证路径。
- Proposed Note 必须记录真实备选方案和可观察的验收条件。会改变包边界、数据所有权或安全模型的开放问题解决前，不开始实现。
- 不为假想 Provider、Consumer、配置项、状态副本或兼容需求创建抽象。当前需求不足以选择时，保持显式或推迟决定。

## 状态与生命周期

- Harness 是 Session、Agent、Interaction、权限和持久事件的权威来源；客户端缓存必须可以从 Host 基线和事件流重建。
- 每项状态只有一个所有者。UI 不复制 Runtime 业务状态；派生视图从同一个不可变快照读取。
- 状态只在操作的提交点发布。审批或问题点击后可以显示本地进行中状态，但只能在 Host 权威结果或新基线确认后标记已解决。
- 一个异步操作由一个 lifecycle controller 或 transaction 管理。取消、重连、超时和销毁使用同一个完成点。
- `dispose()` 必须等待任务停止并关闭监听器，不得只发出 abort 后立即返回。

## 协议与安全

- 同进程 TypeScript 边界信任静态类型；配置、存储、二维码、网络、Worker、原生桥接和模型数据边界必须运行时验证。
- 认证主体由已认证 Connection 提供；业务 Payload 不接受调用方自行声明的设备身份或 Scope。
- 每个修改 Host 状态的请求携带幂等键。响应丢失后的重试不能重复执行 Prompt、审批或命令。
- Reachability、authentication、authorization 分别设计。局域网可达和 Tailscale 地址都不等于已授权。
- Secret、私钥、Bearer Credential 和完整 Session 内容不得进入日志、通知 Payload、URL 或错误遥测。
- 配置自身可以判断的错误在加载时失败，其余错误在最早拥有完整信息的位置失败；禁止静默跳过错误配置。

## TypeScript 与界面

- TypeScript 使用 ESM、`strict: true` 和显式的 Package 公共接口。跨 Package 使用 Package 导出，不穿透导入内部文件。
- 部署相关数值通过经过验证的配置提供；协议常量和安全不变量可以固定。
- 手机端首先保证 390x844 与 430x932 视口可用，再扩展平板和桌面布局。
- 业务状态放在 React-free Runtime；父级已知状态使用 Props；组件私有展示状态留在组件；跨入口或需要跨卸载保留的 UI 状态由明确的 Store 所有。
- 未知能力只允许安全的只读通用展示；不能根据未知 Schema 自动生成修改操作。

## 验证

- 测试描述行为和失败结果，不写“验证实现正确”之类的名字。
- Service Definition 测试契约和拒绝路径；Provider 测试外部边界与生命周期；Consumer 测试用户或模型可见映射。
- 产品可见插件必须有真实组装测试，通过实际 App Entry 和插件清单启动；手工拼接 Context 的单元测试不能替代它。
- 用户可见流程使用 Playwright 覆盖手机和桌面视口，并检查加载、空、错误、断线、进行中和完成状态。
- 根据变更面运行最小充分检查。协议、安全、重连或共享 Runtime 变更扩大验证范围；文档变更至少检查链接、格式和中英文入口。

## 文档职责

- `AGENTS.md` 保存长期执行规则；`docs/architecture.zh.md` 描述当前系统；Agent Note 保存原因、备选方案和代价；Package README 描述局部接口；JSDoc 描述调用者必须知道的本地契约；测试执行可检查的约束。
- 一项事实只有一个权威位置，其他文档使用相对链接引用。
- 注释和 JSDoc 写行为、失败、时序、所有权和安全用法，不复述代码，不保留评审过程或思考记录。
- 中文是当前工程设计文档的工作语言。已有中英文产品文档修改时保持语义一致；Agent Note 在需要外部协作前再增加英文镜像。
- 文件使用 LF，并以一个换行结束。不得提交密钥、配对材料、设备身份或本地环境文件。
