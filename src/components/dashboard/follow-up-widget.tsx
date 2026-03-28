'use client';

import { useState, useEffect } from 'react';
import { PhoneForwarded, Check } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface FollowUpItem {
  org_id: string;
  org_name: string;
  score: number;
  urgency: 'high' | 'medium' | 'low';
  reason: string;
  suggested_action: string;
  draft_message: string;
  overdue_count: number;
  waiting_count: number;
  days_since_contact: number;
}

const urgencyDotColor = {
  high: 'bg-danger',
  medium: 'bg-warning',
  low: 'bg-primary',
};

export function FollowUpWidget() {
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchQueue() {
      try {
        const res = await fetch('/api/ai/follow-up-queue');
        if (!res.ok) throw new Error('Failed to fetch');
        const data: FollowUpItem[] = await res.json();
        setFollowUps(data);
      } catch (err) {
        console.error('Follow-up widget fetch error:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchQueue();
  }, []);

  if (loading) {
    return (
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          Follow Up
        </h2>
        <div className="bg-card rounded-lg p-4 animate-pulse">
          <div className="h-4 bg-card-hover rounded w-2/3 mb-2" />
          <div className="h-4 bg-card-hover rounded w-1/2" />
        </div>
      </div>
    );
  }

  const top3 = followUps.slice(0, 3);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Follow Up
        </h2>
        {followUps.length > 3 && (
          <Link
            href="/follow-ups"
            className="text-xs text-primary hover:text-primary-hover transition-colors"
          >
            View All ({followUps.length})
          </Link>
        )}
      </div>

      {top3.length === 0 ? (
        <div className="bg-card rounded-lg border border-border/50 p-4">
          <div className="flex items-center gap-2 text-success">
            <Check className="w-4 h-4" />
            <span className="text-sm font-medium">All caught up</span>
          </div>
          <p className="text-xs text-muted mt-1">
            No follow-ups needed right now.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {top3.map((item) => (
            <Link
              key={item.org_id}
              href={`/follow-ups`}
              className="flex items-center gap-3 bg-card rounded-lg px-4 py-2.5 hover:bg-card-hover transition-colors"
            >
              {/* Urgency dot */}
              <span
                className={cn(
                  'w-2.5 h-2.5 rounded-full flex-shrink-0',
                  urgencyDotColor[item.urgency]
                )}
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {item.org_name}
                </p>
                <p className="text-xs text-muted truncate">{item.reason}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
