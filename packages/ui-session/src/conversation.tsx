import { useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode, UIEvent } from 'react'
import {
  Bot,
  Brain,
  CircleAlert,
  Clock3,
  Command,
  History,
  Image,
  LoaderCircle,
  MessageSquareText,
  PackageOpen,
  TerminalSquare,
  UserRound,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type {
  AssistantBlock,
  ConversationNode,
  ConversationSnapshot,
  RunningToolCall,
  SessionFace,
} from '@deepseek-ai/dsh-client-runtime/client'

function timeLabel(timestamp: number | undefined): string | undefined {
  if (timestamp === undefined || timestamp === 0) return undefined
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

function formatArguments(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function ToolCall({ name, argsRaw, state }: { name: string; argsRaw: string; state?: string }) {
  return (
    <details className="transcript-tool">
      <summary><Wrench aria-hidden="true" size={15} /><strong>{name}</strong>{state !== undefined && <span>{state}</span>}</summary>
      <pre>{formatArguments(argsRaw)}</pre>
    </details>
  )
}

function ContentBlocks({ blocks }: { blocks: readonly ContentBlock[] }) {
  return <div className="message-content">{blocks.map((block, index) => {
    switch (block.type) {
      case 'text':
        return block.text === '' ? null : <p key={index}>{block.text}</p>
      case 'reasoning':
        return (
          <details className="reasoning-block" key={index}>
            <summary><Brain aria-hidden="true" size={14} />思考过程</summary>
            <pre>{block.text}</pre>
          </details>
        )
      case 'image':
        return <div className="attachment-placeholder" key={index}><Image aria-hidden="true" size={16} />图片附件</div>
      case 'tool-call':
        return <ToolCall argsRaw={block.arguments} key={index} name={block.name} />
      case 'tool-result':
        return (
          <details className="transcript-tool" key={index}>
            <summary><TerminalSquare aria-hidden="true" size={15} /><strong>工具结果</strong>{block.isError === true && <span>失败</span>}</summary>
            <ContentBlocks blocks={block.content} />
          </details>
        )
      default:
        return <div className="unknown-content" key={index}>暂不支持的内容块：{String((block as { type?: unknown }).type)}</div>
    }
  })}</div>
}

function AssistantBlocks({ blocks }: { blocks: readonly AssistantBlock[] }) {
  return <div className="message-content">{blocks.map((block, index) => {
    switch (block.kind) {
      case 'text':
        return block.text === '' ? null : <p key={index}>{block.text}</p>
      case 'reasoning':
        return (
          <details className="reasoning-block" key={index}>
            <summary><Brain aria-hidden="true" size={14} />思考过程</summary>
            <pre>{block.text}</pre>
          </details>
        )
      case 'image':
        return <div className="attachment-placeholder" key={index}><Image aria-hidden="true" size={16} />图片附件</div>
      case 'tool-call':
        return <ToolCall argsRaw={block.argsRaw} key={index} name={block.name} />
      case 'other':
        return <div className="unknown-content" key={index}>暂不支持的 Agent 内容块</div>
      default:
        return block satisfies never
    }
  })}</div>
}

function MessageRow({ role, icon: Icon, label, time, marker, children }: {
  role: 'user' | 'assistant' | 'tool' | 'system'
  icon: LucideIcon
  label: string
  time?: number
  marker?: string
  children: ReactNode
}) {
  return (
    <article className="message-row" data-role={role} data-testid="conversation-row">
      <span className="message-avatar"><Icon aria-hidden="true" size={17} /></span>
      <div className="message-body">
        <div className="message-meta"><strong>{label}</strong>{marker !== undefined && <span>{marker}</span>}{timeLabel(time) !== undefined && <time>{timeLabel(time)}</time>}</div>
        {children}
      </div>
    </article>
  )
}

function ConversationNodeRow({ node }: { node: ConversationNode }) {
  switch (node.kind) {
    case 'user':
      return <MessageRow icon={UserRound} label="你" role="user" time={node.time}><ContentBlocks blocks={node.content} /></MessageRow>
    case 'steering':
      return <MessageRow icon={UserRound} label="你" marker="中途指令" role="user" time={node.time}><ContentBlocks blocks={node.content} /></MessageRow>
    case 'assistant':
      return (
        <MessageRow
          icon={Bot}
          label={node.provenance?.model ?? 'Agent'}
          marker={node.interrupted === true ? '已停止' : undefined}
          role="assistant"
          time={node.time}
        >
          <AssistantBlocks blocks={node.blocks} />
        </MessageRow>
      )
    case 'context':
      return (
        <MessageRow icon={PackageOpen} label={node.provenance.label ?? '系统上下文'} role="system" time={node.time}>
          <details className="context-block"><summary>查看上下文</summary><ContentBlocks blocks={node.content} /></details>
        </MessageRow>
      )
    case 'tool-result':
      return (
        <MessageRow
          icon={TerminalSquare}
          label={node.call?.name ?? `工具 ${node.callId}`}
          marker={node.isError ? '失败' : '已完成'}
          role="tool"
          time={node.time}
        >
          {node.call !== null && <ToolCall argsRaw={node.call.argsRaw} name={node.call.name} />}
          <ContentBlocks blocks={node.content} />
        </MessageRow>
      )
    case 'command':
      return (
        <MessageRow
          icon={Command}
          label={node.name === null ? '命令' : `/${node.name}`}
          marker={node.outcome === null ? '执行中' : node.outcome.kind === 'success' ? '已完成' : '失败'}
          role="system"
          time={node.time}
        >
          {node.args !== null && <pre className="command-args">{node.args.trim()}</pre>}
          {node.outcome?.text !== undefined && <p className="system-copy">{node.outcome.text}</p>}
        </MessageRow>
      )
    case 'model-retry':
      return (
        <MessageRow icon={Clock3} label="模型重试" marker={node.retryState} role="system" time={node.time}>
          <p className="system-copy">{node.failure.message}</p>
        </MessageRow>
      )
    case 'turn-error':
      return (
        <MessageRow icon={CircleAlert} label="Agent 执行失败" marker={node.code} role="system" time={node.time}>
          <p className="system-copy">{node.message}</p>
        </MessageRow>
      )
    case 'turn-max-tokens':
      return <MessageRow icon={CircleAlert} label="输出达到 Token 上限" role="system" time={node.time}><p className="system-copy">本轮输出已在模型上限处停止。</p></MessageRow>
    case 'compaction':
      return (
        <MessageRow icon={PackageOpen} label="上下文已压缩" role="system" time={node.time}>
          {node.summary === null
            ? <p className="system-copy">摘要不在当前历史窗口中。</p>
            : <details className="context-block"><summary>查看摘要</summary><p>{node.summary}</p></details>}
        </MessageRow>
      )
    case 'unknown':
      return <MessageRow icon={MessageSquareText} label="未知会话事件" marker={node.type} role="system" time={node.time}><p className="system-copy">当前客户端只提供只读占位。</p></MessageRow>
    default:
      return node satisfies never
  }
}

function RunningToolRow({ call }: { call: RunningToolCall }) {
  return (
    <MessageRow icon={TerminalSquare} label={call.name} marker="执行中" role="tool" time={call.time}>
      <ToolCall argsRaw={call.argsRaw} name={call.name} state="执行中" />
    </MessageRow>
  )
}

/** Render the Host-folded conversation window without owning a second message store. */
export function ConversationHistory({ session, snapshot }: { session: SessionFace; snapshot: ConversationSnapshot }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const followsTail = useRef(true)
  const heightBeforePrepend = useRef<number>()
  const representedCalls = useMemo(() => new Set(snapshot.nodes.flatMap(node => {
    if (node.kind === 'tool-result') return [node.callId]
    if (node.kind !== 'assistant') return []
    return node.blocks.flatMap(block => block.kind === 'tool-call' ? [block.callId] : [])
  })), [snapshot.nodes])
  const orphanRunningCalls = snapshot.runningCalls.filter(call => !representedCalls.has(call.callId))

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller === null) return
    if (!snapshot.loadingOlder && heightBeforePrepend.current !== undefined) {
      scroller.scrollTop += scroller.scrollHeight - heightBeforePrepend.current
      heightBeforePrepend.current = undefined
      return
    }
    if (followsTail.current) scroller.scrollTop = scroller.scrollHeight
  }, [snapshot.loadingOlder, snapshot.nodes.length, snapshot.partial, snapshot.runningCalls.length])

  const noteScroll = (event: UIEvent<HTMLDivElement>) => {
    const scroller = event.currentTarget
    followsTail.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 56
  }

  const loadOlder = () => {
    const scroller = scrollRef.current
    if (scroller === null || snapshot.loadingOlder) return
    heightBeforePrepend.current = scroller.scrollHeight
    followsTail.current = false
    void session.loadOlder()
  }

  const empty = snapshot.nodes.length === 0 && snapshot.partial === null && orphanRunningCalls.length === 0
  return (
    <section className="conversation-section" data-testid="conversation-history">
      <div className="conversation-titlebar">
        <div><span>Session 历史</span><h2>对话记录</h2></div>
        <span>{snapshot.nodes.length} 条</span>
      </div>
      <div className="conversation-scroll" data-testid="conversation-scroll" onScroll={noteScroll} ref={scrollRef}>
        {snapshot.hasMore && (
          <button className="load-older-button" disabled={snapshot.loadingOlder} onClick={loadOlder} type="button">
            {snapshot.loadingOlder
              ? <><LoaderCircle className="spin" aria-hidden="true" size={16} />正在加载</>
              : <><History aria-hidden="true" size={16} />加载更早的对话</>}
          </button>
        )}
        <div className="conversation" aria-live="polite">
          {snapshot.nodes.map(node => <ConversationNodeRow key={`${node.kind}:${node.seq}`} node={node} />)}
          {snapshot.partial !== null && (
            <MessageRow icon={Bot} label="Agent" marker="正在回复" role="assistant">
              <AssistantBlocks blocks={snapshot.partial.blocks} />
            </MessageRow>
          )}
          {orphanRunningCalls.map(call => <RunningToolRow call={call} key={call.callId} />)}
          {empty && <div className="conversation-empty"><MessageSquareText aria-hidden="true" size={24} /><span>暂无对话内容</span></div>}
        </div>
      </div>
    </section>
  )
}
