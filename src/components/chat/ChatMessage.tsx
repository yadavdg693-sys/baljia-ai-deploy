'use client';

import type { ChatMessage as ChatMessageType, ChatAction } from '@/types';
import { TaskProposalCard } from './TaskProposalCard';
import { CreditQuoteCard } from './CreditQuoteCard';
import { MarkdownBody } from '@/components/ui/MarkdownBody';

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`}
      id={`chat-msg-${message.id}`}
    >
      <div
        className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-baljia-gold/15 text-text-primary border border-baljia-gold/20'
            : 'bg-surface-secondary text-text-primary border border-border-default'
        }`}
      >
        {/* Message text — rendered as markdown (headings, lists, bold, links, code) */}
        <MarkdownBody size="sm">{message.content}</MarkdownBody>

        {/* Embedded actions */}
        {message.actions && message.actions.length > 0 && (
          <div className="mt-2 space-y-2">
            {message.actions.map((action, i) => (
              <ChatActionRenderer key={i} action={action} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatActionRenderer({ action }: { action: ChatAction }) {
  switch (action.type) {
    case 'task_proposal':
      return <TaskProposalCard proposal={action.data} />;
    case 'credit_quote':
      return <CreditQuoteCard balance={action.data.balance} />;
    default:
      return null;
  }
}

// Typing indicator shown while streaming
export function TypingIndicator() {
  return (
    <div className="flex justify-start animate-fade-in">
      <div className="bg-surface-secondary rounded-xl px-4 py-3 border border-border-default">
        <div className="flex gap-1.5 items-center">
          <div className="w-2 h-2 rounded-full bg-baljia-gold animate-bounce [animation-delay:0ms]" />
          <div className="w-2 h-2 rounded-full bg-baljia-gold animate-bounce [animation-delay:150ms]" />
          <div className="w-2 h-2 rounded-full bg-baljia-gold animate-bounce [animation-delay:300ms]" />
          <span className="text-xs text-text-muted ml-2">Baljia is thinking...</span>
        </div>
      </div>
    </div>
  );
}
