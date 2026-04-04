'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const MAX_CHARS = 5000;

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`; // max 4 lines
    }
  }, [message]);

  const handleSend = useCallback(() => {
    const trimmed = message.trim();
    if (trimmed && !disabled) {
      onSend(trimmed);
      setMessage('');
    }
  }, [message, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="px-4 py-3 border-t border-border-default">
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'CEO is thinking...' : 'Message your CEO...'}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-surface-secondary rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted border border-border-default focus:outline-none focus:border-border-active resize-none transition-colors disabled:opacity-50"
          aria-label="Chat message input"
          id="chat-input"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !message.trim()}
          className="px-3 py-2 bg-baljia-gold text-surface-primary rounded-lg text-sm font-semibold disabled:opacity-40 hover:bg-baljia-gold-light transition-colors shrink-0"
          aria-label="Send message"
          id="chat-send-btn"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
      {message.length > MAX_CHARS * 0.9 && (
        <p className="text-xs text-text-muted mt-1 text-right animate-fade-in">
          {message.length}/{MAX_CHARS}
        </p>
      )}
    </div>
  );
}
