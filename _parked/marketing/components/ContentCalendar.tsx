'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Post {
  id: string;
  title: string;
  platform: 'linkedin' | 'x' | 'reddit' | 'product_hunt';
  status: 'draft' | 'scheduled' | 'posted' | 'failed';
  scheduledDate: string;
}

interface ContentCalendarProps {
  companyId: string;
}

const PLATFORMS = [
  { id: 'linkedin', name: 'LinkedIn', color: 'bg-blue-900' },
  { id: 'x', name: 'X / Twitter', color: 'bg-black' },
  { id: 'reddit', name: 'Reddit', color: 'bg-orange-900' },
  { id: 'product_hunt', name: 'Product Hunt', color: 'bg-orange-600' },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: 'bg-text-muted text-surface-primary' },
  scheduled: { label: 'Scheduled', color: 'bg-baljia-gold text-surface-primary' },
  posted: { label: 'Posted', color: 'bg-status-success text-surface-primary' },
  failed: { label: 'Failed', color: 'bg-status-error text-surface-primary' },
};

export function ContentCalendar({ companyId }: ContentCalendarProps) {
  const [currentWeek, setCurrentWeek] = useState<Date>(new Date());
  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWeekPosts();
  }, [currentWeek, companyId]);

  async function loadWeekPosts() {
    try {
      setLoading(true);
      const startDate = getWeekStart(currentWeek).toISOString().split('T')[0];
      const endDate = new Date(getWeekStart(currentWeek).getTime() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const response = await fetch(
        `/api/marketing/posts?companyId=${companyId}&startDate=${startDate}&endDate=${endDate}`
      );

      if (response.ok) {
        const data = await response.json();
        setPosts(data.posts || []);
      }
    } catch (error) {
      console.error('Error loading posts:', error);
    } finally {
      setLoading(false);
    }
  }

  function getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  }

  function getPostsForDay(day: number, platform: string): Post[] {
    const targetDate = new Date(getWeekStart(currentWeek));
    targetDate.setDate(targetDate.getDate() + day);
    const dateStr = targetDate.toISOString().split('T')[0];

    return posts.filter(
      (p) => p.platform === platform && p.scheduledDate.startsWith(dateStr)
    );
  }

  function handlePrevWeek() {
    setCurrentWeek((prev) => new Date(prev.getTime() - 7 * 24 * 60 * 60 * 1000));
  }

  function handleNextWeek() {
    setCurrentWeek((prev) => new Date(prev.getTime() + 7 * 24 * 60 * 60 * 1000));
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary">Loading calendar...</p>
      </div>
    );
  }

  const weekStart = getWeekStart(currentWeek);
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="bg-surface-card border border-border-default rounded-lg overflow-hidden">
      {/* Week Navigation */}
      <div className="flex items-center justify-between p-4 border-b border-border-default">
        <button
          onClick={handlePrevWeek}
          className="p-2 hover:bg-surface-hover rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h3 className="text-lg font-semibold text-text-primary">
          {weekStart.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}{' '}
          -{' '}
          {weekDates[6].toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </h3>
        <button
          onClick={handleNextWeek}
          className="p-2 hover:bg-surface-hover rounded-lg transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-default">
              <th className="px-4 py-3 text-left text-text-secondary font-semibold bg-surface-secondary w-32">
                Platform
              </th>
              {DAYS.map((day, i) => (
                <th
                  key={day}
                  className="px-4 py-3 text-center text-text-secondary font-semibold bg-surface-secondary min-w-48"
                >
                  <div>{day}</div>
                  <div className="text-xs text-text-muted mt-1">
                    {weekDates[i].toLocaleDateString('en-US', {
                      month: 'numeric',
                      day: 'numeric',
                    })}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLATFORMS.map((platform) => (
              <tr key={platform.id} className="border-b border-border-default hover:bg-surface-hover">
                <td className="px-4 py-3 font-semibold text-text-secondary bg-surface-secondary">
                  {platform.name}
                </td>
                {Array.from({ length: 7 }).map((_, dayIndex) => {
                  const dayPosts = getPostsForDay(dayIndex, platform.id);
                  return (
                    <td
                      key={`${platform.id}-${dayIndex}`}
                      className="px-4 py-3 align-top min-w-48"
                    >
                      {dayPosts.length === 0 ? (
                        <div className="text-text-muted text-xs opacity-50">—</div>
                      ) : (
                        <div className="space-y-2">
                          {dayPosts.map((post) => (
                            <button
                              key={post.id}
                              onClick={() => {
                                setSelectedPost(post);
                                setEditModalOpen(true);
                              }}
                              className="block w-full text-left p-2 rounded border border-border-default bg-surface-primary hover:border-baljia-gold transition-all group"
                            >
                              <p className="text-xs font-medium text-text-primary truncate group-hover:text-baljia-gold">
                                {post.title}
                              </p>
                              <div className="mt-1">
                                <span
                                  className={`inline-block text-[10px] px-2 py-1 rounded font-semibold ${
                                    STATUS_CONFIG[post.status].color
                                  }`}
                                >
                                  {STATUS_CONFIG[post.status].label}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {editModalOpen && selectedPost && (
        <EditPostModal
          post={selectedPost}
          onClose={() => setEditModalOpen(false)}
          onSave={() => {
            setEditModalOpen(false);
            loadWeekPosts();
          }}
        />
      )}
    </div>
  );
}

function EditPostModal({
  post,
  onClose,
  onSave,
}: {
  post: Post;
  onClose: () => void;
  onSave: () => void;
}) {
  const [isUpdating, setIsUpdating] = useState(false);

  async function handleSave() {
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/marketing/posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: post.title,
          status: post.status,
        }),
      });

      if (response.ok) {
        onSave();
      }
    } catch (error) {
      console.error('Error saving post:', error);
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card border border-border-default rounded-xl max-w-md w-full p-6">
        <h2 className="text-lg font-bold text-text-primary mb-4">Edit Post</h2>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">Title</label>
            <input
              type="text"
              value={post.title}
              readOnly
              className="w-full px-3 py-2 bg-surface-primary border border-border-default rounded-lg text-text-primary text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">Status</label>
            <select
              value={post.status}
              className="w-full px-3 py-2 bg-surface-primary border border-border-default rounded-lg text-text-primary text-sm"
            >
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="posted">Posted</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-border-default rounded-lg text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isUpdating}
            className="flex-1 px-4 py-2 bg-baljia-gold text-surface-primary rounded-lg font-medium hover:bg-baljia-gold-light transition-colors disabled:opacity-50"
          >
            {isUpdating ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
