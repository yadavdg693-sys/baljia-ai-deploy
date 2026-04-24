'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage as ChatMessageType, ChatAction, CEOStreamEvent } from '@/types';
import { ChatMessage, TypingIndicator } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { MarkdownBody } from '@/components/ui/MarkdownBody';
import { BaljiaMascot } from '@/components/mascot/BaljiaMascot';

interface ChatPanelProps {
  companyId: string;
  warnings?: string[];
}

const HOW_IT_WORKS_STEPS = [
  'Tell the CEO what you want done — in plain English.',
  'The CEO scopes it, quotes credits, and proposes a task.',
  'You approve — workers execute, verify, and report back.',
  'Chat is always free. Only task execution costs credits.',
];

export function ChatPanel({ companyId, warnings = [] }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hydrate chat history from backend on mount
  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const res = await fetch(`/api/chat?company_id=${encodeURIComponent(companyId)}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data.messages?.length > 0) {
            setMessages(data.messages);
          }
        }
      } catch {
        // Non-blocking — start with empty chat if fetch fails
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    }
    loadHistory();
    return () => { cancelled = true; };
  }, [companyId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streamingText]);

  const handleSend = useCallback(async (message: string) => {
    // Add user message
    const userMsg: ChatMessageType = {
      id: `user-${Date.now()}`,
      session_id: '',
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setStreamingText('');

    const actions: ChatAction[] = [];

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, message }),
      });

      if (!res.ok || !res.body) {
        throw new Error('Chat request failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const event: CEOStreamEvent = JSON.parse(data);

            if (event.type === 'text') {
              fullText += event.content;
              setStreamingText(fullText);
            } else if (event.type === 'action') {
              actions.push(event.action);
            }
          } catch {
            // Ignore malformed events
          }
        }
      }

      // Add assistant message with accumulated text and actions
      const assistantMsg: ChatMessageType = {
        id: `assistant-${Date.now()}`,
        session_id: '',
        role: 'assistant',
        content: fullText,
        actions: actions.length > 0 ? actions : undefined,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error) {
      // Add error message
      const errorMsg: ChatMessageType = {
        id: `error-${Date.now()}`,
        session_id: '',
        role: 'assistant',
        content: 'Sorry, I had trouble processing that. Please try again.',
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      console.error('[ChatPanel] Stream error:', error instanceof Error ? error.message : error);
    } finally {
      setIsStreaming(false);
      setStreamingText('');
    }
  }, [companyId]);

  const isEmpty = messages.length === 0 && !isStreaming && historyLoaded;

  return (
    <div className="rounded-xl bg-surface-card border border-border-default flex flex-col h-[500px]" id="chat-panel">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-default flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-baljia-gold animate-pulse' : 'bg-green-500'}`} />
        <h2 className="font-semibold text-sm">CEO Chat</h2>
        <span className="text-xs text-text-muted ml-auto">Free</span>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Warnings — always visible at the top of the rail when present */}
        {warnings.length > 0 && (
          <div className="space-y-1.5">
            {warnings.map((w) => (
              <div
                key={w}
                className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200"
              >
                <span aria-hidden="true" className="mt-0.5 text-amber-400">⚠</span>
                <span className="leading-snug">{w}</span>
              </div>
            ))}
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col gap-4">
            <div className="text-center pt-2">
              <BaljiaMascot
                status={{ state: 'listening', label: 'Ready', detail: '' }}
                size="chat"
                showLabel={false}
                showDetail={false}
              />
            </div>
            <div className="rounded-lg border border-border-default bg-surface-secondary/40 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-2">
                How it works
              </h3>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-text-secondary leading-relaxed marker:text-baljia-gold marker:font-semibold">
                {HOW_IT_WORKS_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="text-[11px] text-text-muted mt-2 pt-2 border-t border-border-subtle">
                Each task = 1 credit &middot; up to 4 hours of work per run.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {/* Show streaming text */}
        {isStreaming && streamingText && (
          <div className="flex justify-start animate-fade-in">
            <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed bg-surface-secondary text-text-primary border border-border-default">
              <MarkdownBody size="sm">{streamingText}</MarkdownBody>
            </div>
          </div>
        )}

        {/* Typing indicator when streaming but no text yet */}
        {isStreaming && !streamingText && <TypingIndicator />}
      </div>

      {/* Input area */}
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}
