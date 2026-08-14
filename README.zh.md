# DSH Companion

[English](README.md) | 中文

DSH Companion 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的移动优先 Web 与原生伴侣客户端。用户可以离开运行 Harness 的电脑后，继续监控运行中的 Session、回答问题、处理审批、向任务追加指令以及延续对话。

项目当前提供 Fixture 驱动的 Stage 0 响应式 Web 应用，可以在电脑浏览器中使用手机视口查看并完成待处理事项流程。它不连接真实 Harness；交互和连接协议稳定后，再接入认证直连并进行 iOS 与 Android 原生打包。

## 产品方向

- Harness 继续作为 Agent、Session、Tool、Workspace、权限和持久事件的事实来源。
- Companion 是客户端界面，不是另一套 Agent 运行时或 Session 数据库。
- 手机端首先处理需要用户关注的事项：待审批、问题、计划审阅、失败和已完成任务的优先级高于通用聊天界面。
- Host 能力与客户端功能均通过插件组合。
- 远程访问必须经过设备认证和明确授权；网络可达不等于身份可信。

## 架构

系统边界、插件模型、线协议要求、安全模型和交付阶段参见 [docs/architecture.zh.md](docs/architecture.zh.md)。

工程修改遵循 [AGENTS.md](AGENTS.md) 和 [设计与开发流程](docs/design-workflow.zh.md)。首个已实现的纵向切片是 [以待处理事项为中心的移动工作流](.agents/notes/implemented/feature/2026-08-15-attention-workflow-first-slice.md)。

## 本地预览

需要 Node.js 22.19 以上版本、pnpm 和现代浏览器：

```sh
pnpm install
pnpm dev
```

打开 `http://127.0.0.1:5173/`。`pnpm run check` 运行类型、Lint、单元测试和生产构建；`pnpm run test:web` 使用已安装的 Chrome 运行三种目标视口。

## 计划交付

1. 使用 Fixture 驱动的响应式 Web 外壳和交互演示。
2. 通过局域网或 Tailscale 等私有网络，经过认证后直连 Harness。
3. 支持安装的 PWA，并在回到前台时重新同步；运行环境允许时支持 Web Push。
4. 使用 Capacitor 打包 iOS 与 Android，提供安全存储、二维码扫描、相机附件和原生推送。
5. 对于无法接受入站连接的 Host，提供可选的端到端加密中继。

## 当前状态

本仓库只实现 Fixture Web 预览，尚未实现生产可用的 Harness 连接或认证。测试本项目时，不要把 Harness HTTP 端点暴露到不可信网络。
