'use client';

import { useState, useEffect } from 'react';
import { Send, SkipForward } from 'lucide-react';

interface EngagementQueueProps {
  companyId: string;
}

type Platform = 'linkedin' | 'x' | 'reddit' | 'product_hunt';

interface EngagementItem {
  id: string;
  platform: Platform;
  author: string;
  postSnippet: string;
  relevanceScore: number;
  suggestedReply?: string;
}

export function EngagementQueue({ companyId }: EngagementQueueProps) {
  const [items, setItems] = useState<EngagementItem[]>([]);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [generatingReply, setGeneratingReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    loadEngagementQueue();
  }, [companyId, selectedPlatform]);

  async function loadEngagementQueue() {
    try {
      setLoading(true);
      const platformParam = selectedPlatform === 'all' ? '' : `&platform=${selectedPlatform}`;
      const response = await fetch(`/api/marketing/engagement?companyId=${companyId}${platformParam}`);
      if (response.ok) {
        const data = await response.json();
        setItems(data.items || []);
        setCurrentItemIndex(0);
        setReplyText('');
      }
    } catch (error) {
      console.error('Error loading engagement queue:', error);
    } finally {
      setLoading(false);
    }
  }

  async function generateReply() {
    const currentItem = items[currentItemIndex];
    if (!currentItem) return;

    setGeneratingReply(true);
    try {
      const response = await fetch('/api/marketing/suggest-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          postSnippet: currentItem.postSnippet,
          author: currentItem.author,
          platform: currentItem.platform,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setReplyText(data.suggestedReply || '');
      }
    } catch (error) {
      console.error('Error generating reply:', error);
    } finally {
      setGeneratingReply(false);
    }
  }

  async function sendReply() {
    const currentItem = items[currentItemIndex];
    if (!currentItem || !replyText.trim()) return;

    setReplying(true);
    try {
      const response = await fetch('/api/marketing/post-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          itemId: currentItem.id,
          platform: currentItem.platform,
          replyContent: replyText,
        }),
      });

      if (response.ok) {
        moveToNext();
      }
    } catch (error) {
      console.error('Error sending reply:', error);
      alert('Failed to send reply');
    } finally {
      setReplying(false);
    }
  }

  function moveToNext() {
    if (currentItemIndex < items.length - 1) {
      setCurrentItemIndex(currentItemIndex + 1);
      setReplyText('');
    } else {
      loadEngagementQueue();
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary">Loading engagement queue...</p>
      </div>
    );
  }

  const filteredItems = selectedPlatform === 'all' ? items : items.filter((item) => item.platform === selectedPlatform);
  const currentItem = filteredItems[currentItemIndex];

  return (
    <div className="space-y-6">
      {/* Platform Filter */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'x', 'linkedin', 'reddit', 'product_hunt'] as const).map((platform) => (
          <button
            key={platform}
            onClick={() => {
              setSelectedPlatform(platform);
              setCurrentItemIndex(0);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedPlatform === platform
                ? 'bg-baljia-gold text-surface-primary'
                : 'border border-border-default text-text-secondary hover:text-text-primary'
            }`}
          >
            {platform === 'all' ? 'All Platforms' : platform.replace('_', ' ').toUpperCase()}
          </button>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <div className="bg-surface-card border border-border-default rounded-lg p-8 text-center">
          <p className="text-text-secondary">No engagement opportunities at the moment</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Progress */}
          <div className="text-sm text-text-muted">
            Item {currentItemIndex + 1} of {filteredItems.length}
          </div>

          {/* Current Item */}
          {currentItem && (
            <div className="bg-surface-card border border-border-default rounded-lg p-6 space-y-6">
              {/* Header */}
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">
                    {currentItem.platform === 'x' && '𝕏'}
                    {currentItem.platform === 'linkedin' && '🔗'}
                    {currentItem.platform === 'reddit' && '🔴'}
                    {currentItem.platform === 'product_hunt' && '🦌'}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-text-primary">@{currentItem.author}</p>
                    <p className="text-xs text-text-muted">
                      Relevance: {(currentItem.relevanceScore * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>

                {/* Post Snippet */}
                <p className="text-text-secondary bg-surface-primary p-4 rounded-lg border border-border-default">
                  "{currentItem.postSnippet}"
                </p>
              </div>

              {/* Reply Editor */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-text-primary">Your Reply</label>
                  <button
                    onClick={generateReply}
                    disabled={generatingReply}
                    className="text-xs px-3 py-1 bg-surface-primary border border-border-default rounded text-baljia-gold hover:bg-surface-hover transition-colors disabled:opacity-50"
                  >
                    {generatingReply ? 'Generating...' : 'Generate with AI'}
                  </button>
                </div>

                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type your reply here..."
                  className="w-full p-4 bg-surface-primary border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:border-baljia-gold focus:outline-none resize-none"
                  rows={4}
                />

                {currentItem.platform === 'x' && (
                  <p className="text-xs text-text-muted">
                    Character count: {replyText.length} / 280
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={sendReply}
                  disabled={replying || !replyText.trim()}
                  className="flex-1 px-4 py-3 bg-baljia-gold text-surface-primary rounded-lg font-medium hover:bg-baljia-gold-light transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  {replying ? 'Sending...' : 'Send Reply'}
                </button>
                <button
                  onClick={moveToNext}
                  disabled={replying}
                  className="flex-1 px-4 py-3 border border-border-default rounded-lg text-text-secondary hover:text-text-primary transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <SkipForward className="w-4 h-4" />
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* Queue List */}
          {filteredItems.length > 1 && (
            <div className="bg-surface-card border border-border-default rounded-lg p-6">
              <h3 className="text-sm font-semibold text-text-primary mb-4">Queue</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {filteredItems.map((item, idx) => (
                  <button
                    key={item.id}
                    onClick={() => setCurrentItemIndex(idx)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      idx === currentItemIndex
                        ? 'bg-baljia-gold/10 border-baljia-gold'
                        : 'border-border-default hover:border-baljia-gold/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-text-primary">@{item.author}</p>
                        <p className="text-xs text-text-muted truncate mt-1">{item.postSnippet}</p>
                      </div>
                      <span className="text-xs text-baljia-gold font-semibold flex-shrink-0">
                        {(item.relevanceScore * 100).toFixed(0)}%
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
