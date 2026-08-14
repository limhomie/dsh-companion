import {
  hostId,
  interactionId,
  messageId,
  resumeCursor,
  sessionId,
  type HostBaseline,
  type HostDescription,
} from '@dsh-companion/connection'

export const FIXTURE_HOST: HostDescription = {
  id: hostId('host-studio'),
  name: '工作室电脑',
  mode: 'fixture',
  protocolVersion: '0.1-fixture',
  capabilities: ['session.read', 'interaction.answer', 'connection.reconnect'],
}

/** Fresh baseline for one isolated preview run. */
export function createFixtureBaseline(): HostBaseline {
  return {
    cursor: resumeCursor('cursor-1'),
    sessions: [
      {
        id: sessionId('session-mobile-ui'),
        title: '移动端控制界面',
        workspace: 'dsh-companion',
        status: 'waiting',
        agent: 'Codex',
        model: 'DeepSeek Chat',
        summary: '等待你选择首版测试覆盖范围',
        updatedAt: '2026-08-15T01:42:00.000Z',
        unread: true,
        messages: [
          {
            id: messageId('message-user-1'),
            role: 'user',
            content: '先把手机端待处理工作流做出来，电脑浏览器也能预览。',
            createdAt: '2026-08-15T01:36:00.000Z',
          },
          {
            id: messageId('message-assistant-1'),
            role: 'assistant',
            content: '架构和插件职责已经整理完。我准备实现首条真实组装路径，需要确认首版测试范围。',
            createdAt: '2026-08-15T01:41:00.000Z',
          },
        ],
      },
      {
        id: sessionId('session-preview-release'),
        title: '准备首个预览版本',
        workspace: 'dsh-companion',
        status: 'waiting',
        agent: 'Codex',
        model: 'DeepSeek Chat',
        summary: '安装依赖前等待一次授权',
        updatedAt: '2026-08-15T01:39:00.000Z',
        unread: true,
        messages: [
          {
            id: messageId('message-tool-1'),
            role: 'tool',
            content: '准备安装已锁定的前端依赖。',
            createdAt: '2026-08-15T01:39:00.000Z',
            toolName: 'shell',
            toolStatus: 'running',
          },
        ],
      },
      {
        id: sessionId('session-plugin-docs'),
        title: '整理插件规范',
        workspace: 'deepseek-harness',
        status: 'completed',
        agent: 'Codex',
        model: 'DeepSeek Chat',
        summary: '已整理 Definition、Provider、Consumer 范式',
        updatedAt: '2026-08-15T01:24:00.000Z',
        unread: true,
        messages: [
          {
            id: messageId('message-assistant-2'),
            role: 'assistant',
            content: '插件能力三角色和编码前设计清单已经整理完成。',
            createdAt: '2026-08-15T01:24:00.000Z',
          },
        ],
      },
      {
        id: sessionId('session-remote-research'),
        title: '远程连接调研',
        workspace: 'dsh-companion',
        status: 'failed',
        agent: 'Codex',
        model: 'DeepSeek Chat',
        summary: '认证协议尚未就绪，已停止连接',
        updatedAt: '2026-08-15T01:18:00.000Z',
        unread: false,
        messages: [
          {
            id: messageId('message-system-1'),
            role: 'system',
            content: '远程认证能力尚未配置。Fixture 模式没有发起真实网络连接。',
            createdAt: '2026-08-15T01:18:00.000Z',
          },
        ],
      },
    ],
    interactions: [
      {
        id: interactionId('interaction-test-scope'),
        sessionId: sessionId('session-mobile-ui'),
        kind: 'question',
        title: '选择首版测试范围',
        prompt: '首个可运行版本优先覆盖哪一组验证？',
        options: ['核心流程与手机视口', '同时覆盖断线恢复'],
        source: 'Codex',
        status: 'pending',
        createdAt: '2026-08-15T01:42:00.000Z',
      },
      {
        id: interactionId('interaction-install'),
        sessionId: sessionId('session-preview-release'),
        kind: 'approval',
        title: '安装项目依赖',
        toolName: 'shell',
        command: 'pnpm install --frozen-lockfile',
        risk: 'medium',
        detail: '只修改 dsh-companion 的 node_modules，不访问 Harness 工作区。',
        source: 'Codex',
        status: 'pending',
        createdAt: '2026-08-15T01:39:00.000Z',
      },
    ],
  }
}
