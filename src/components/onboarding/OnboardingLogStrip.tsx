'use client';

// OnboardingLogStrip — terminal-style scrolling activity log.
// Pure presentational component. Activity lines + mood + stage label are passed
// in from the parent (the onboarding page), which owns the single SSE stream.
// Prior version opened its own EventSource; consolidated to one stream per page.

import { useEffect, useRef } from 'react';

export interface LogStripActivityLine {
  id: number;
  text: string;
  tool: string | null;
  stage: string | null;
  timestamp: number;
}

interface OnboardingLogStripProps {
  lines: LogStripActivityLine[];
  mood: string;
  currentStageLabel: string | null;
  done: boolean;
}

export function OnboardingLogStrip({
  lines,
  mood,
  currentStageLabel,
  done,
}: OnboardingLogStripProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div className="rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] p-4 font-mono text-xs text-[#d4d4d4]">
      <div className="mb-2 flex items-center justify-between border-b border-[#2a2a2a] pb-2">
        <span className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              done ? 'bg-green-500' : 'animate-pulse bg-[#F5A623]'
            }`}
          />
          <span className="text-[#888]">
            {done ? 'Done' : currentStageLabel ?? 'Starting...'}
          </span>
        </span>
        <span className="text-[10px] uppercase tracking-wider text-[#666]">
          mood: {mood}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="max-h-64 overflow-y-auto pr-2"
        style={{ scrollbarWidth: 'thin' }}
      >
        {lines.length === 0 ? (
          <div className="text-[#666]">Waiting for activity...</div>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="py-0.5">
              <span className="text-[#555]">
                [{new Date(line.timestamp).toLocaleTimeString([], { hour12: false })}]
              </span>{' '}
              {line.tool && (
                <span className="text-[#F5A623]">[{line.tool}]</span>
              )}{' '}
              <span>{line.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
