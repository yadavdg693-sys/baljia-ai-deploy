'use client';

// OnboardingLogStrip — terminal-style scrolling log for the onboarding waiting page.
// Subscribes to the status SSE endpoint and renders activity lines in real time.
// Auto-scrolls to bottom as new lines arrive.

import { useEffect, useRef, useState } from 'react';

interface ActivityLine {
  id: number;
  text: string;
  tool: string | null;
  stage: string | null;
  timestamp: number;
}

interface StageUpdate {
  stage: string;
  status: 'running' | 'done' | 'skipped' | 'error';
  label: string;
}

interface MoodUpdate {
  mood: string;
  stage: string | null;
}

export function OnboardingLogStrip({ companyId }: { companyId: string }) {
  const [lines, setLines] = useState<ActivityLine[]>([]);
  const [currentStage, setCurrentStage] = useState<string | null>(null);
  const [mood, setMood] = useState<string>('listening');
  const [done, setDone] = useState(false);
  const lineIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const eventSource = new EventSource(`/api/onboarding/status?company_id=${companyId}`);

    eventSource.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'activity') {
          setLines((prev) => [
            ...prev,
            {
              id: ++lineIdRef.current,
              text: String(data.text ?? ''),
              tool: data.tool ?? null,
              stage: data.stage ?? null,
              timestamp: Number(data.timestamp ?? Date.now()),
            },
          ]);
        } else if (data.type === 'stage') {
          const stageUpdate = data as StageUpdate;
          if (stageUpdate.status === 'running') {
            setCurrentStage(stageUpdate.label);
          }
        } else if (data.type === 'mood') {
          const moodUpdate = data as MoodUpdate;
          setMood(moodUpdate.mood);
        } else if (data.type === 'completed' || data.type === 'failed' || data.type === 'timeout') {
          setDone(true);
          eventSource.close();
        }
      } catch {
        // Non-fatal parse error
      }
    };

    eventSource.onerror = () => {
      // Browser will retry automatically
    };

    return () => {
      eventSource.close();
    };
  }, [companyId]);

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
            {done ? 'Done' : currentStage ?? 'Starting...'}
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
