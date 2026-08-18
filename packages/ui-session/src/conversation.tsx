import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, UIEvent } from 'react'
import {
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Command,
  Copy,
  History,
  Image,
  LoaderCircle,
  MessageSquareText,
  PackageOpen,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type {
  AssistantBlock,
  ConversationNode,
  ConversationSnapshot,
  RunningToolCall,
  SessionFace,
} from '@deepseek-ai/dsh-client-runtime/client'

type ToolState = 'pending' | 'running' | 'completed' | 'error'
const MARKDOWN_CODE_LABELS = { copyLabel: '复制', copiedLabel: '已复制' } as const

function timeLabel(timestamp: number | undefined): string | undefined {
  if (timestamp === undefined || timestamp === 0) return undefined
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/, 1)[0] ?? ''
}

function formatArguments(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function argumentPreview(raw: string): string | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value === 'string') return firstLine(value)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    for (const key of ['command', 'cmd', 'file_path', 'path', 'query', 'pattern', 'url']) {
      const candidate = record[key]
      if (typeof candidate === 'string' && candidate.trim() !== '') return firstLine(candidate)
    }
    const candidate = Object.values(record).find(item => typeof item === 'string' && item.trim() !== '')
    return typeof candidate === 'string' ? firstLine(candidate) : undefined
  } catch {
    const preview = firstLine(raw)
    return preview === '' ? undefined : preview
  }
}

function contentText(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap(block => {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        return block.text === '' ? [] : [block.text]
      case 'tool-call':
        return [block.name]
      default:
        return []
    }
  }).join('\n')
}

function assistantText(blocks: readonly AssistantBlock[]): string {
  return blocks.flatMap(block => block.kind === 'text' && block.text !== '' ? [block.text] : []).join('\n')
}

function MessageActions({ text, time }: { text: string; time?: number }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const resetTimer = useRef<number>()

  useEffect(() => () => {
    if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current)
  }, [])

  const copy = (): void => {
    if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current)
    void navigator.clipboard.writeText(text).then(() => {
      setCopyState('copied')
      resetTimer.current = window.setTimeout(() => { setCopyState('idle') }, 1_500)
    }).catch(() => {
      setCopyState('failed')
      resetTimer.current = window.setTimeout(() => { setCopyState('idle') }, 1_500)
    })
  }

  return (
    <div className="message-actions">
      {timeLabel(time) !== undefined && <time>{timeLabel(time)}</time>}
      <button type="button" aria-label="复制消息" title="复制消息" disabled={text === ''} onClick={copy}>
        {copyState === 'copied' ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
      </button>
      <span className="sr-only" aria-live="polite">
        {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : ''}
      </span>
    </div>
  )
}

function ReasoningBlock({ text, running = false }: { text: string; running?: boolean }) {
  return (
    <details className="reasoning-block" data-state={running ? 'running' : 'completed'}>
      <summary>
        <Brain aria-hidden="true" size={14} />
        <strong>Think</strong>
        <span className="trajectory-separator" aria-hidden="true" />
        <span className="trajectory-preview">{firstLine(text)}</span>
        <ChevronDown className="trajectory-chevron" aria-hidden="true" size={14} />
      </summary>
      <div className="reasoning-content">{text}</div>
    </details>
  )
}

function toolStateLabel(state: ToolState): string {
  switch (state) {
    case 'pending': return '等待结果'
    case 'running': return '执行中'
    case 'completed': return '已完成'
    case 'error': return '失败'
    default: return state satisfies never
  }
}

function ToolTrajectory({
  name,
  argsRaw,
  callId,
  state,
  result,
}: {
  name: string
  argsRaw: string
  callId?: string
  state: ToolState
  result?: readonly ContentBlock[]
}) {
  const preview = argumentPreview(argsRaw)
  return (
    <details className="transcript-tool" data-call-id={callId} data-state={state} data-testid="tool-trajectory">
      <summary>
        <span className="trajectory-status" aria-hidden="true" />
        <Wrench aria-hidden="true" size={14} />
        <strong>{name}</strong>
        {preview !== undefined && (
          <>
            <span className="trajectory-separator" aria-hidden="true" />
            <span className="trajectory-preview">{preview}</span>
          </>
        )}
        <span className="trajectory-state">{toolStateLabel(state)}</span>
        <ChevronDown className="trajectory-chevron" aria-hidden="true" size={14} />
      </summary>
      <div className="trajectory-detail">
        <span>参数</span>
        <pre>{formatArguments(argsRaw)}</pre>
        {result !== undefined && result.length > 0 && (
          <div className="trajectory-result">
            <span>结果</span>
            <ContentBlocks blocks={result} />
          </div>
        )}
      </div>
    </details>
  )
}

function ContentBlocks({ blocks }: { blocks: readonly ContentBlock[] }) {
  return <div className="message-content">{blocks.map((block, index) => {
    switch (block.type) {
      case 'text':
        return block.text === '' ? null : <p key={index}>{block.text}</p>
      case 'reasoning':
        return <ReasoningBlock key={index} text={block.text} />
      case 'image':
        return <div className="attachment-placeholder" key={index}><Image aria-hidden="true" size={16} />图片附件</div>
      case 'tool-call':
        return <ToolTrajectory argsRaw={block.arguments} callId={String(block.id)} key={index} name={block.name} state="pending" />
      case 'tool-result':
        return (
          <ToolTrajectory
            argsRaw="{}"
            key={index}
            name="工具结果"
            result={block.content}
            state={block.isError === true ? 'error' : 'completed'}
          />
        )
      default:
        return <div className="unknown-content" key={index}>暂不支持的内容块：{String((block as { type?: unknown }).type)}</div>
    }
  })}</div>
}

function AssistantBlocks({
  blocks,
  streaming = false,
  settledCallIds,
  runningCallIds,
}: {
  blocks: readonly AssistantBlock[]
  streaming?: boolean
  settledCallIds: ReadonlySet<string>
  runningCallIds: ReadonlySet<string>
}) {
  return <div className="message-content assistant-content">{blocks.map((block, index) => {
    switch (block.kind) {
      case 'text':
        return block.text === ''
          ? null
          : <MarkdownText codeLabels={MARKDOWN_CODE_LABELS} key={index} streaming={streaming} text={block.text} />
      case 'reasoning':
        return <ReasoningBlock key={index} running={streaming && index === blocks.length - 1} text={block.text} />
      case 'image':
        return <div className="attachment-placeholder" key={index}><Image aria-hidden="true" size={16} />图片附件</div>
      case 'tool-call':
        if (settledCallIds.has(block.callId)) return null
        return (
          <ToolTrajectory
            argsRaw={block.argsRaw}
            callId={block.callId}
            key={index}
            name={block.name}
            state={runningCallIds.has(block.callId) ? 'running' : 'pending'}
          />
        )
      case 'other':
        return <div className="unknown-content" key={index}>暂不支持的 Agent 内容块</div>
      default:
        return block satisfies never
    }
  })}</div>
}

function MessageRow({ role, icon: Icon, label, time, marker, copyText, children }: {
  role: 'user' | 'assistant' | 'tool' | 'system'
  icon?: LucideIcon
  label: string
  time?: number
  marker?: string
  copyText?: string
  children: ReactNode
}) {
  return (
    <article className="message-row" data-role={role} data-testid="conversation-row" aria-label={marker === undefined ? label : `${label}，${marker}`}>
      <div className="message-body">
        {role === 'system' && (
          <div className="message-meta">
            {Icon !== undefined && <Icon aria-hidden="true" size={15} />}
            <strong>{label}</strong>
            {marker !== undefined && <span>{marker}</span>}
            {timeLabel(time) !== undefined && <time>{timeLabel(time)}</time>}
          </div>
        )}
        {children}
        {copyText !== undefined && copyText !== '' && <MessageActions text={copyText} time={time} />}
      </div>
    </article>
  )
}

function ConversationNodeRow({
  node,
  settledCallIds,
  runningCallIds,
}: {
  node: ConversationNode
  settledCallIds: ReadonlySet<string>
  runningCallIds: ReadonlySet<string>
}) {
  switch (node.kind) {
    case 'user':
      return <MessageRow copyText={contentText(node.content)} label="你" role="user" time={node.time}><ContentBlocks blocks={node.content} /></MessageRow>
    case 'steering':
      return <MessageRow copyText={contentText(node.content)} label="你" marker="中途指令" role="user" time={node.time}><ContentBlocks blocks={node.content} /></MessageRow>
    case 'assistant':
      if (!node.blocks.some(block => block.kind !== 'tool-call' || !settledCallIds.has(block.callId))) return null
      return (
        <MessageRow
          copyText={assistantText(node.blocks)}
          label={node.provenance?.model ?? 'Agent'}
          marker={node.interrupted === true ? '已停止' : undefined}
          role="assistant"
          time={node.time}
        >
          <AssistantBlocks blocks={node.blocks} runningCallIds={runningCallIds} settledCallIds={settledCallIds} />
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
        <MessageRow label={node.call?.name ?? `工具 ${node.callId}`} role="tool" time={node.time}>
          <ToolTrajectory
            argsRaw={node.call?.argsRaw ?? '{}'}
            callId={node.callId}
            name={node.call?.name ?? `工具 ${node.callId}`}
            result={node.content}
            state={node.isError ? 'error' : 'completed'}
          />
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
    <MessageRow label={call.name} marker="执行中" role="tool" time={call.time}>
      <ToolTrajectory argsRaw={call.argsRaw} callId={call.callId} name={call.name} state="running" />
    </MessageRow>
  )
}

/** Render the Host-folded conversation window without owning a second message store. */
export function ConversationHistory({ session, snapshot }: { session: SessionFace; snapshot: ConversationSnapshot }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const followsTail = useRef(true)
  const heightBeforePrepend = useRef<number>()
  const [atTail, setAtTail] = useState(true)
  const settledCallIds = useMemo(() => new Set(snapshot.nodes.flatMap(node => node.kind === 'tool-result' ? [node.callId] : [])), [snapshot.nodes])
  const runningCallIds = useMemo(() => new Set(snapshot.runningCalls.map(call => call.callId)), [snapshot.runningCalls])
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
    if (followsTail.current) {
      scroller.scrollTop = scroller.scrollHeight
      setAtTail(true)
    }
  }, [snapshot.loadingOlder, snapshot.nodes.length, snapshot.partial, snapshot.runningCalls.length])

  const noteScroll = (event: UIEvent<HTMLDivElement>) => {
    const scroller = event.currentTarget
    const next = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 56
    followsTail.current = next
    setAtTail(current => current === next ? current : next)
  }

  const scrollToTail = (): void => {
    const scroller = scrollRef.current
    if (scroller === null) return
    followsTail.current = true
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
    setAtTail(true)
  }

  const loadOlder = () => {
    const scroller = scrollRef.current
    if (scroller === null || snapshot.loadingOlder) return
    heightBeforePrepend.current = scroller.scrollHeight
    followsTail.current = false
    setAtTail(false)
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
          {snapshot.nodes.map(node => (
            <ConversationNodeRow
              key={`${node.kind}:${node.seq}`}
              node={node}
              runningCallIds={runningCallIds}
              settledCallIds={settledCallIds}
            />
          ))}
          {snapshot.partial !== null && (
            <MessageRow copyText={assistantText(snapshot.partial.blocks)} label="Agent" marker="正在回复" role="assistant">
              <AssistantBlocks
                blocks={snapshot.partial.blocks}
                runningCallIds={runningCallIds}
                settledCallIds={settledCallIds}
                streaming
              />
            </MessageRow>
          )}
          {orphanRunningCalls.map(call => <RunningToolRow call={call} key={call.callId} />)}
          {empty && <div className="conversation-empty"><MessageSquareText aria-hidden="true" size={24} /><span>暂无对话内容</span></div>}
        </div>
      </div>
      {!atTail && (
        <button className="conversation-to-bottom" aria-label="返回最新消息" title="返回最新消息" type="button" onClick={scrollToTail}>
          <ChevronDown aria-hidden="true" size={17} />
        </button>
      )}
    </section>
  )
}
