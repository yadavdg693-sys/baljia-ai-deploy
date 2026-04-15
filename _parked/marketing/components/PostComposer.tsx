'use client';

import { useState, useRef } from 'react';
import { Sparkles, Plus, X } from 'lucide-react';

interface PostComposerProps {
  companyId: string;
}

type Platform = 'linkedin' | 'x' | 'reddit' | 'product_hunt';
type PostType = 'single' | 'thread' | 'article' | 'discussion';
type Tone = 'technical' | 'visionary' | 'relatable' | 'warm';
type Phase = 'problem' | 'architecture' | 'proof' | 'invitation';

interface ThreadPart {
  id: string;
  content: string;
}

const PLATFORM_LIMITS = {
  x: 280,
  linkedin: 3000,
  reddit: 40000,
  product_hunt: 5000,
};

const PLATFORMS = [
  { id: 'linkedin', label: 'LinkedIn', icon: '🔗' },
  { id: 'x', label: 'X / Twitter', icon: '𝕏' },
  { id: 'reddit', label: 'Reddit', icon: '🔴' },
  { id: 'product_hunt', label: 'Product Hunt', icon: '🦌' },
];

export function PostComposer({ companyId }: PostComposerProps) {
  const [platform, setPlatform] = useState<Platform>('x');
  const [postType, setPostType] = useState<PostType>('single');
  const [content, setContent] = useState('');
  const [threadParts, setThreadParts] = useState<ThreadPart[]>([
    { id: '1', content: '' },
  ]);
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState<Tone>('warm');
  const [phase, setPhase] = useState<Phase>('problem');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('09:00');
  const [campaignTag, setCampaignTag] = useState('');
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const charLimit = PLATFORM_LIMITS[platform];
  const currentContent = postType === 'thread' ? threadParts.map((p) => p.content).join('\n\n') : content;
  const charCount = currentContent.length;

  function addThreadPart() {
    const newId = String(Math.max(...threadParts.map((p) => parseInt(p.id)), 0) + 1);
    setThreadParts([...threadParts, { id: newId, content: '' }]);
  }

  function removeThreadPart(id: string) {
    if (threadParts.length > 1) {
      setThreadParts(threadParts.filter((p) => p.id !== id));
    }
  }

  function updateThreadPart(id: string, newContent: string) {
    setThreadParts(
      threadParts.map((p) => (p.id === id ? { ...p, content: newContent } : p))
    );
  }

  async function handleGenerateWithAI() {
    if (!topic.trim()) {
      alert('Please enter a topic');
      return;
    }

    setGenerating(true);
    try {
      const response = await fetch('/api/marketing/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          topic,
          platform,
          postType,
          tone,
          phase,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (postType === 'thread' && data.parts) {
          setThreadParts(data.parts.map((content: string, i: number) => ({ id: String(i), content })));
        } else {
          setContent(data.content || '');
        }
      }
    } catch (error) {
      console.error('Error generating content:', error);
      alert('Failed to generate content');
    } finally {
      setGenerating(false);
    }
  }

  async function handlePublish(asDraft: boolean) {
    if (!currentContent.trim()) {
      alert('Please enter some content');
      return;
    }

    setPublishing(true);
    try {
      const response = await fetch('/api/marketing/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          platform,
          postType,
          content: postType === 'thread' ? threadParts : content,
          tone,
          phase,
          campaignTag,
          scheduledDate: asDraft ? null : scheduledDate,
          scheduledTime: asDraft ? null : scheduledTime,
          status: asDraft ? 'draft' : 'scheduled',
        }),
      });

      if (response.ok) {
        alert(asDraft ? 'Post saved as draft!' : 'Post scheduled successfully!');
        // Reset form
        setContent('');
        setThreadParts([{ id: '1', content: '' }]);
        setTopic('');
        setScheduledDate('');
        setCampaignTag('');
      }
    } catch (error) {
      console.error('Error publishing post:', error);
      alert('Failed to publish post');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Composer */}
      <div className="lg:col-span-2 space-y-6">
        {/* Platform Selector */}
        <div className="bg-surface-card border border-border-default rounded-lg p-6">
          <label className="block text-sm font-semibold text-text-primary mb-4">Platform</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id as Platform)}
                className={`p-3 rounded-lg border transition-all text-center font-medium ${
                  platform === p.id
                    ? 'border-baljia-gold bg-baljia-gold/10 text-text-primary'
                    : 'border-border-default bg-surface-primary text-text-secondary hover:text-text-primary'
                }`}
              >
                <div className="text-2xl mb-1">{p.icon}</div>
                <div className="text-xs">{p.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Post Type Selector */}
        <div className="bg-surface-card border border-border-default rounded-lg p-6">
          <label className="block text-sm font-semibold text-text-primary mb-4">Post Type</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {['single', 'thread', 'article', 'discussion'].map((type) => (
              <button
                key={type}
                onClick={() => setPostType(type as PostType)}
                className={`p-3 rounded-lg border transition-all font-medium capitalize ${
                  postType === type
                    ? 'border-baljia-gold bg-baljia-gold/10 text-text-primary'
                    : 'border-border-default bg-surface-primary text-text-secondary hover:text-text-primary'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Content Editor */}
        <div className="bg-surface-card border border-border-default rounded-lg p-6">
          <label className="block text-sm font-semibold text-text-primary mb-4">Content</label>

          {postType === 'thread' ? (
            <div className="space-y-3">
              {threadParts.map((part, index) => (
                <div key={part.id} className="relative">
                  <textarea
                    value={part.content}
                    onChange={(e) => updateThreadPart(part.id, e.target.value)}
                    placeholder={`Tweet ${index + 1}...`}
                    maxLength={charLimit}
                    className="w-full p-4 bg-surface-primary border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:border-baljia-gold focus:outline-none resize-none"
                    rows={3}
                  />
                  {threadParts.length > 1 && (
                    <button
                      onClick={() => removeThreadPart(part.id)}
                      className="absolute top-2 right-2 p-1 hover:bg-surface-hover rounded transition-colors"
                    >
                      <X className="w-4 h-4 text-text-muted" />
                    </button>
                  )}
                  <div className="text-xs text-text-muted mt-1 text-right">
                    {part.content.length} / {charLimit}
                  </div>
                </div>
              ))}
              <button
                onClick={addThreadPart}
                className="w-full p-3 border border-border-default rounded-lg text-baljia-gold hover:bg-surface-secondary transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Tweet
              </button>
            </div>
          ) : (
            <div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your post content here..."
                maxLength={charLimit}
                className="w-full p-4 bg-surface-primary border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:border-baljia-gold focus:outline-none resize-none"
                rows={6}
              />
              <div className={`text-sm text-right mt-2 ${charCount > charLimit * 0.9 ? 'text-status-error' : 'text-text-muted'}`}>
                {charCount} / {charLimit}
              </div>
            </div>
          )}
        </div>

        {/* AI Generation */}
        <div className="bg-surface-card border border-border-default rounded-lg p-6">
          <div className="flex gap-3">
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Enter a topic to generate content..."
              className="flex-1 px-4 py-2 bg-surface-primary border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:border-baljia-gold focus:outline-none"
            />
            <button
              onClick={handleGenerateWithAI}
              disabled={generating}
              className="px-4 py-2 bg-baljia-gold text-surface-primary rounded-lg font-medium hover:bg-baljia-gold-light transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              {generating ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </div>

        {/* Settings */}
        <div className="bg-surface-card border border-border-default rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-text-primary mb-2">Tone</label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as Tone)}
                className="w-full px-3 py-2 bg-surface-primary border border-border-default rounded-lg text-text-primary"
              >
                <option value="technical">Technical</option>
                <option value="visionary">Visionary</option>
                <option value="relatable">Relatable</option>
                <option value="warm">Warm</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-text-primary mb-2">Phase</label>
              <select
                value={phase}
                onChange={(e) => setPhase(e.target.value as Phase)}
                className="w-full px-3 py-2 bg-surface-primary border border-border-default rounded-lg text-text-primary"
              >
                <option value="problem">Problem</option>
                <option value="architecture">Architecture</option>
                <option value="proof">Proof</option>
                <option value="invitation">Invitation</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-text-primary mb-2">Schedule Date</label>
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full px-3 py-2 bg-surface-primary border border-border-default rounded-lg text-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-text-primary mb-2">Schedule Time</label>
              <input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="w-full px-3 py-2 bg-surface-primary border border-border-default rounded-lg text-text-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-text-primary mb-2">Campaign Tag</label>
            <input
              type="text"
              value={campaignTag}
              onChange={(e) => setCampaignTag(e.target.value)}
              placeholder="e.g., Launch, Engagement, Thought Leadership"
              className="w-full px-3 py-2 bg-surface-primary border border-border-default rounded-lg text-text-primary placeholder-text-muted"
            />
          </div>
        </div>
      </div>

      {/* Preview & Actions */}
      <div className="lg:col-span-1">
        {/* Preview Toggle */}
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="w-full mb-4 px-4 py-2 border border-border-default rounded-lg text-text-secondary hover:text-text-primary transition-colors font-medium"
        >
          {showPreview ? 'Hide Preview' : 'Show Preview'}
        </button>

        {/* Preview Panel */}
        {showPreview && (
          <div className="bg-surface-card border border-border-default rounded-lg p-6 mb-6 sticky top-4">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Preview</h3>
            <div className={`p-4 rounded-lg border border-border-default bg-surface-primary text-sm leading-relaxed ${
              platform === 'x' ? 'max-h-40 overflow-y-auto' : 'max-h-60 overflow-y-auto'
            }`}>
              {postType === 'thread' ? (
                <div className="space-y-3">
                  {threadParts.map((part, i) => (
                    <div key={part.id} className="pb-3 border-b border-border-default last:border-0">
                      <p className="text-text-primary text-xs font-semibold mb-1">Tweet {i + 1}</p>
                      <p className="text-text-secondary whitespace-pre-wrap text-xs break-words">
                        {part.content || '(empty)'}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-text-secondary whitespace-pre-wrap break-words">
                  {currentContent || '(preview will appear here)'}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3 sticky top-4">
          <button
            onClick={() => handlePublish(true)}
            disabled={publishing || !currentContent.trim()}
            className="w-full px-4 py-3 border border-border-default rounded-lg text-text-secondary hover:text-text-primary transition-colors font-medium disabled:opacity-50"
          >
            {publishing ? 'Saving...' : 'Save as Draft'}
          </button>
          <button
            onClick={() => handlePublish(false)}
            disabled={publishing || !currentContent.trim() || !scheduledDate}
            className="w-full px-4 py-3 bg-baljia-gold text-surface-primary rounded-lg font-medium hover:bg-baljia-gold-light transition-colors disabled:opacity-50"
          >
            {publishing ? 'Scheduling...' : 'Schedule Post'}
          </button>
        </div>
      </div>
    </div>
  );
}
