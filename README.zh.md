# DSH Companion

[English](README.md) | 中文

DSH Companion 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的移动优先伴侣界面。当前版本由 Harness 在同一 Origin 的 `/companion/` 提供，可以在电脑浏览器中查看真实 Session，并处理 Harness 发来的问题和审批。

当前实现只允许 `127.0.0.1` 回环访问。它用于验证真实 Harness 数据链路和手机布局，不是已经完成设备认证的远程手机端；局域网、Tailscale 和公网访问都必须等待下一阶段的设备配对、授权与撤销能力。

## 已实现

- 直接装载 Harness 的 Typert Registry、Client Connection、API Remotes 和 Client Runtime，不维护第二套 Session 或 Interaction 协议。
- 注册 Harness 标准 Conversation Definition，并展示 Runtime 所有的只读历史，包括消息、工具过程、流式片段和失败状态。
- 从 `ctx.sessions` 派生收件箱、Session 列表和待处理状态。
- 通过 Harness 的 `PendingWait.respond()` 回答问题或批准/拒绝工具调用；只有 Host 的 resolved Frame 才会移除事项。
- 独立 Cordis UI 插件贡献收件箱、Session 和设置页面，Shell 只负责路由、导航与连接提示。
- `dsh-companion-host-web` 插件把构建产物挂载到 Harness 的 `/companion` 前缀，并在非回环 Host 或 Harness 版本不一致时拒绝加载。
- 官方 Harness Fixture 驱动的无密钥浏览器测试覆盖 390x844、430x932 和 1280x800。

完整机制见 [架构文档](docs/architecture.zh.md)、[本机真实 Harness 切片决策](.agents/notes/implemented/architecture/2026-08-15-host-served-real-harness-slice.md) 和 [只读 Conversation 决策](.agents/notes/implemented/feature/2026-08-15-read-only-conversation-history.md)。工程修改遵循 [AGENTS.md](AGENTS.md) 与 [设计和开发流程](docs/design-workflow.zh.md)。

## 环境准备

当前预发布开发方式要求两个仓库位于同一父目录：

```text
workspace/
  deepseek-harness/
  dsh-companion/
```

Companion 锁定 DeepSeek Harness `0.1.0-rc.5` 和提交 `47f943859bef60e4160492346772ded9b24f765a`。需要 Node.js 22.19 以上版本、pnpm 10 和 Chrome。

首次准备 Harness：

```sh
cd deepseek-harness
pnpm install --frozen-lockfile
pnpm run build
```

安装并启动 Companion：

```sh
cd ../dsh-companion
pnpm install
pnpm host
```

打开 [http://127.0.0.1:3080/companion/](http://127.0.0.1:3080/companion/)。该页面读取同一 `dsh web` 进程中的真实 Session；Harness 原有页面仍位于根路径 `/`。

## 只看演示数据

不启动真实 Host 时，可以使用 Harness 官方 Fixture 查看问题和审批的完整流程：

```sh
pnpm dev
```

打开 [http://127.0.0.1:5173/companion/?fixture](http://127.0.0.1:5173/companion/?fixture)。不带 `?fixture` 的独立 Vite 页面没有同源 Harness API，不能作为真实连接入口。

## 验证

```sh
pnpm run check
pnpm run test:web
```

`check` 运行 Harness checkout 校验、类型检查、Lint、单元测试和生产构建；`test:web` 使用官方 Fixture 与真实 Client Runtime 运行三种视口的浏览器流程。

## 下一阶段

下一阶段在 Harness 中建立设备身份、二维码配对、Scope、撤销和明确的协议兼容信息，然后才允许非回环访问。PWA 安装、后台通知、Capacitor 原生壳和可选的端到端加密中继均建立在该安全能力之上。
