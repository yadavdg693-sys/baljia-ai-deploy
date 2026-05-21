// FounderChatRail — Baljia chat panel (DOCKED SIDEBAR).
// Resizable sidebar docked to the right of the dashboard grid.
// Drag handle on left edge lets the user widen or narrow it.
// Always visible — no overlay, no blur, no slide-in animation.

'use client';

import { useState, useRef, useEffect, useCallback, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { ChatMessage as ChatMessageType, ChatAction, CEOStreamEvent } from '@/types';
import { MarkdownBody } from '@/components/ui/MarkdownBody';

interface FounderChatRailProps {
  companyId: string;
  warnings?: string[];
  /** Fired for every CEO action event (task_proposal, task_approved, etc.) so
   *  the dashboard can refresh immediately rather than wait for the 30s poll. */
  onAction?: (action: ChatAction) => void;
}

const HOW_IT_WORKS_STEPS = [
  'Tell Baljia what you want — a task, a question, or a strategy discussion',
  'Baljia scopes the work and estimates credits',
  'Approve the task — Baljia assigns the right AI agent',
  'The agent executes autonomously (up to 4 hours per task)',
  'A verifier checks the output before marking it complete',
  'Results appear as reports, documents, or deployed code',
];

const MIN_WIDTH = 260;
const MAX_WIDTH = 760;
const DEFAULT_WIDTH = 380;

export function FounderChatRail({ companyId, warnings = [], onAction }: FounderChatRailProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_WIDTH);

  // Load chat history
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

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText]);

  // Drag-to-resize handler
  const handleDragStart = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startWidthRef.current = panelWidth;

    const handleMove = (ev: globalThis.PointerEvent) => {
      // Dragging left → wider (since panel is on the right)
      const delta = startXRef.current - ev.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta));
      setPanelWidth(newWidth);
    };

    const handleUp = () => {
      setIsDragging(false);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  }, [panelWidth]);

  // Send message
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
            else if (ev.type === 'action') {
              actions.push(ev.action);
              onAction?.(ev.action);
            }
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
  }, [companyId, draft, isStreaming, onAction]);

  const isEmpty = messages.length === 0 && !isStreaming;

  // Collapsed state: just show a thin bar with a toggle
  if (isCollapsed) {
    return (
      <section
        className="chat-sidebar chat-sidebar--collapsed"
        aria-label="Baljia Chat (collapsed)"
      >
        <button
          className="chat-sidebar__expand-btn"
          onClick={() => { setIsCollapsed(false); setIsFullscreen(false); }}
          type="button"
          aria-label="Expand chat"
        >
          <span className="chat-sidebar__expand-icon">💬</span>
          <span className="chat-sidebar__expand-label">Chat</span>
        </button>
      </section>
    );
  }

  return (
    <section
      ref={panelRef}
      className={`chat-sidebar ${isDragging ? 'is-dragging' : ''}${isFullscreen ? ' chat-sidebar--fullscreen' : ''}`}
      style={isFullscreen ? undefined : { width: panelWidth, minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH }}
      aria-label="Baljia Chat"
    >
      {/* Drag handle on left edge */}
      {!isFullscreen && (
        <button
          className="chat-sidebar__drag-handle"
          onPointerDown={handleDragStart}
          type="button"
          aria-label="Resize chat panel"
        >
          <span className="chat-sidebar__drag-dots" />
        </button>
      )}

      <div className="chat-sidebar__inner">
        {/* Header */}
        <div className="chat-sidebar__header">
          <span className="chat-sidebar__title-group">
            <img
              src="/mascot.png"
              alt=""
              className="chat-sidebar__mascot"
            />
            <span className="chat-sidebar__title">Baljia Chat</span>
          </span>
          <span className="chat-sidebar__header-right">
            <span className="chat-sidebar__status">
              <span className="chat-sidebar__status-dot" />
              ONLINE
            </span>
            <button
              className="chat-sidebar__collapse-btn chat-sidebar__mode-btn"
              onClick={() => setIsFullscreen((value) => !value)}
              type="button"
              aria-label={isFullscreen ? 'Dock chat panel' : 'Expand chat panel'}
              title={isFullscreen ? 'Dock chat' : 'Full screen'}
            >
              {isFullscreen ? 'Dock' : 'Full'}
            </button>
            <button
              className="chat-sidebar__collapse-btn"
              onClick={() => setIsCollapsed(true)}
              type="button"
              aria-label="Collapse chat panel"
              title="Collapse"
            >
              ⟫
            </button>
          </span>
        </div>

        {/* Scrollable message area */}
        <div className="chat-sidebar__messages" ref={scrollRef}>
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
            <div className="chat-sidebar__empty">
              <h3 className="serif">How It Works</h3>
              <p className="chat-sidebar__subtitle">
                Message Baljia to manage your company.
              </p>
              <ol className="chat-sidebar__steps">
                {HOW_IT_WORKS_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="chat-sidebar__credit-note">Each task = 1 credit, max 4 hours per session.</p>
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
                      Baljia
                    </small>
                    {/* Markdown render — was raw <p>{content}</p> which left ** literal */}
                    <MarkdownBody size="sm">{msg.content}</MarkdownBody>
                  </div>
                )
              ))}
              {isStreaming && streamingText && (
                <div className="thought-row">
                  <small>Baljia</small>
                  <MarkdownBody size="sm">{streamingText}</MarkdownBody>
                </div>
              )}
              {isStreaming && !streamingText && (
                <div className="thought-row">
                  <small>Baljia</small>
                  <p style={{ opacity: 0.6, fontStyle: 'italic' }}>thinking...</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <form className="chat-sidebar__composer" onSubmit={handleSend}>
          <span className="chat-sidebar__composer-icon">💬</span>
          <input
            className="chat-sidebar__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask Baljia anything..."
            disabled={isStreaming}
          />
          <button className="chat-sidebar__send" type="submit" aria-label="Send">
            →
          </button>
        </form>
      </div>
    </section>
  );
}
