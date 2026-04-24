// CelebrationOverlay — Polsia reference port.
// Uses .celebration-overlay / .celebration-panel / .celebration-fireworks
// from src/styles/polsia-shell.css. Auto-dismisses after 3.5s.

'use client';

import { useEffect, useState } from 'react';

interface CelebrationOverlayProps {
  taskTitle: string;
  onDismiss: () => void;
}

export function CelebrationOverlay({ taskTitle, onDismiss }: CelebrationOverlayProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 250);
    }, 3500);
    return () => clearTimeout(t);
  }, [onDismiss]);

  if (!visible) return null;

  return (
    <div
      className="celebration-overlay"
      onClick={() => {
        setVisible(false);
        setTimeout(onDismiss, 250);
      }}
      role="dialog"
      aria-live="polite"
    >
      <div className="celebration-fireworks celebration-fireworks--left" />
      <div className="celebration-fireworks celebration-fireworks--right" />
      <div className="celebration-panel">
        <div className="celebration-badge">✓</div>
        <strong>Task complete</strong>
        <h3 className="serif">{taskTitle}</h3>
        <p style={{ fontSize: 12, color: '#6f6f6f' }}>
          CEO: Great work. Let&apos;s keep compounding this momentum.
        </p>
      </div>
    </div>
  );
}
