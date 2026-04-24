'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage as ChatMessageType, ChatAction, CEOStreamEvent } from '@/types';
import { ChatMessage, TypingIndicator } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { MarkdownBody } from '@/components/ui/MarkdownBody';
import { BaljiaMascot } from '@/components/mascot/BaljiaMascot';

interface ChatPanelProps {
  companyId: string;
}

export function ChatPanel({ companyId }: ChatPanelProps) {
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
        {isEmpty && (
          <div className="flex-1 flex items-center justify-center h-full">
            <div className="text-center px-4">
              <BaljiaMascot
                status={{ state: 'listening', label: 'Ready', detail: '' }}
                size="chat"
                showLabel={false}
                showDetail={false}
              />
              <p className="text-text-muted text-xs mt-3">
                Chat with your AI CEO to plan tasks, check progress, and get strategic guidance.
              </p>
              <p className="text-text-muted text-xs mt-1 opacity-60">
                Chatting is always free. Only task execution costs credits.
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
