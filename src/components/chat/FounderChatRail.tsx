// FounderChatRail — Polsia-styled CEO chat column.
// Lives in the 4-column dashboard grid at column 4 (variable width).
// Source reference: polsia/baljia-frontend/src/components/dashboard-shell.tsx:12-136
// Styles: .dashboard-column--chat / .chat-pane / .warning-list / .how-it-works
// / .chat-thread / .chat-composer / .founder-bubble / .thought-row.

'use client';

import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react';
import type { ChatMessage as ChatMessageType, ChatAction, CEOStreamEvent } from '@/types';

interface FounderChatRailProps {
  companyId: string;
  warnings?: string[];
}

const HOW_IT_WORKS_STEPS = [
  'You describe what you want done on a website',
  'Agent opens a real browser session',
  'Navigates, clicks, fills, extracts — step by step',
  'Takes screenshots to verify it\'s on the right page',
  'Saves any credentials or data it creates',
  'Delivers results as a report',
];

export function FounderChatRail({ companyId, warnings = [] }: FounderChatRailProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const res = await fetch(`/api/chat?company_id=${encodeURIComponent(companyId)}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          if (data.messages?.length > 0) setMessages(data.messages);
        }
      } catch {
        // non-blocking
      }
    }
    loadHistory();
    return () => { cancelled = true; };
  }, [companyId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText]);

  const handleSend = useCallback(async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const message = draft.trim();
    if (!message || isStreaming) return;

    const userMsg: ChatMessageType = {
      id: `user-${Date.now()}`, session_id: '', role: 'user',
      content: message, created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setDraft('');
    setIsStreaming(true);
    setStreamingText('');

    const actions: ChatAction[] = [];
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, message }),
      });
      if (!res.ok || !res.body) throw new Error('chat failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const ev: CEOStreamEvent = JSON.parse(data);
            if (ev.type === 'text') { fullText += ev.content; setStreamingText(fullText); }
            else if (ev.type === 'action') actions.push(ev.action);
          } catch { /* ignore */ }
        }
      }

      const assistantMsg: ChatMessageType = {
        id: `assistant-${Date.now()}`, session_id: '', role: 'assistant',
        content: fullText, actions: actions.length > 0 ? actions : undefined,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [...prev, {
        id: `error-${Date.now()}`, session_id: '', role: 'assistant',
        content: 'Sorry, I had trouble processing that. Please try again.',
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setIsStreaming(false);
      setStreamingText('');
    }
  }, [companyId, draft, isStreaming]);

  if (collapsed) {
    return (
      <section className="dashboard-column dashboard-column--chat dashboard-column--chat-collapsed">
        <button
          className="chat-reopen-tab"
          onClick={() => setCollapsed(false)}
          type="button"
        >
          CEO
        </button>
      </section>
    );
  }

  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <section className="dashboard-column dashboard-column--chat">
      <div className="chat-pane">
        <div className="chat-pane__header">
          <span>CEO</span>
          <button
            className="chat-pane__close"
            onClick={() => setCollapsed(true)}
            type="button"
            aria-label="Collapse chat"
          >
            ×
          </button>
        </div>

        <div className="chat-pane__scroll" ref={scrollRef}>
          {warnings.length > 0 && (
            <div className="warning-list">
              {warnings.map((w) => (
                <div className="warning-row" key={w}>
                  <span className="warning-row__icon">×</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {isEmpty && (
            <div className="how-it-works">
              <h3 className="serif">How It Works</h3>
              <ol>
                {HOW_IT_WORKS_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p>Each task = 1 credit, max 4 hours per session. Pretty powerful for founder tasks.</p>
            </div>
          )}

          {messages.length > 0 && (
            <div className="chat-thread">
              {messages.map((msg) => (
                msg.role === 'user' ? (
                  <div className="founder-bubble" key={msg.id}>{msg.content}</div>
                ) : (
                  <div className="thought-row" key={msg.id}>
                    <small>CEO</small>
                    <p>{msg.content}</p>
                  </div>
                )
              ))}
              {isStreaming && streamingText && (
                <div className="thought-row">
                  <small>CEO</small>
                  <p>{streamingText}</p>
                </div>
              )}
              {isStreaming && !streamingText && (
                <div className="thought-row">
                  <small>CEO</small>
                  <p style={{ opacity: 0.6 }}>thinking...</p>
                </div>
              )}
            </div>
          )}
        </div>

        <form className="chat-composer" onSubmit={handleSend}>
          <span className="chat-composer__icon">o</span>
          <input
            className="chat-composer__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask Baljia anything..."
            disabled={isStreaming}
          />
          <button className="chat-composer__send" type="submit" aria-label="Send">
            {'->'}
          </button>
        </form>
      </div>
    </section>
  );
}
