// FounderChatRail — CEO chat column (FIXED).
// FIXES: Corrected "How It Works" copy to describe Baljia, not browser agent.

'use client';

import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react';
import type { ChatMessage as ChatMessageType, ChatAction, CEOStreamEvent } from '@/types';

interface FounderChatRailProps {
  companyId: string;
  warnings?: string[];
}

// FIX: Correct How It Works to describe Baljia, not browser sessions
const HOW_IT_WORKS_STEPS = [
  'Tell Baljia what you want — a task, a question, or a strategy discussion',
  'Your AI CEO scopes the work and estimates credits',
  'Approve the task — Baljia assigns the right AI agent',
  'The agent executes autonomously (up to 4 hours per task)',
  'A verifier checks the output before marking it complete',
  'Results appear as reports, documents, or deployed code',
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
          CEO Chat
        </button>
      </section>
    );
  }

  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <section className="dashboard-column dashboard-column--chat">
      <div className="chat-pane">
        <div className="chat-pane__header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img
              src="/mascot.png"
              alt=""
              style={{
                width: 20, height: 20, objectFit: 'contain',
                filter: 'drop-shadow(0 0 4px rgba(225,177,44,0.3))',
              }}
            />
            <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '.3px', textTransform: 'uppercase' as const }}>CEO Chat</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: '#16A34A' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', boxShadow: '0 0 6px #16A34A', display: 'inline-block' }} />
              ONLINE
            </span>
            <button
              className="chat-pane__close"
              onClick={() => setCollapsed(true)}
              type="button"
              aria-label="Collapse chat"
            >
              ×
            </button>
          </span>
        </div>

        <div className="chat-pane__scroll" ref={scrollRef}>
          {warnings.length > 0 && (
            <div className="warning-list">
              {warnings.map((w) => (
                <div className="warning-row" key={w}>
                  <span className="warning-row__icon">⚠</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {isEmpty && (
            <div className="how-it-works">
              <h3 className="serif">How It Works</h3>
              <p style={{ fontSize: 13, color: 'var(--dash-muted, #6f6f6f)', marginBottom: 8 }}>
                Chat with your AI CEO to manage your company.
              </p>
              <ol>
                {HOW_IT_WORKS_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p>Each task = 1 credit, max 4 hours per session.</p>
            </div>
          )}

          {messages.length > 0 && (
            <div className="chat-thread">
              {messages.map((msg) => (
                msg.role === 'user' ? (
                  <div className="founder-bubble" key={msg.id}>{msg.content}</div>
                ) : (
                  <div className="thought-row" key={msg.id}>
                    <small style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <img
                        src="/mascot.png"
                        alt=""
                        style={{
                          width: 14, height: 14, objectFit: 'contain',
                          filter: 'drop-shadow(0 0 3px rgba(225,177,44,0.2))',
                        }}
                      />
                      CEO
                    </small>
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
                  <p style={{ opacity: 0.6, fontStyle: 'italic' }}>thinking...</p>
                </div>
              )}
            </div>
          )}
        </div>

        <form className="chat-composer" onSubmit={handleSend}>
          <span className="chat-composer__icon">💬</span>
          <input
            className="chat-composer__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask Baljia anything..."
            disabled={isStreaming}
          />
          <button className="chat-composer__send" type="submit" aria-label="Send">
            →
          </button>
        </form>
      </div>
    </section>
  );
}
