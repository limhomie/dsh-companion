import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { registerConversationNodes } from '@deepseek-ai/dsh-client-ui-conversation/src/client/conversation-nodes/register.ts'

export const name = 'companion-conversation-projection'
export const inject = ['conversationEvents', 'conversationViews']

/** Register Harness-owned Conversation definitions for this plugin's lifetime. */
export function apply(ctx: Context): void {
  registerConversationNodes(ctx)
}
