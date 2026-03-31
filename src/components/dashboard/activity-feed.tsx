'use client';

import { useState, useEffect } from 'react';
import { Check, Clock, X, FileText, Plus, ArrowRight, Activity } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface FeedItem {
  id: string;
  type: string;
  action: string;
  title: string;
  org_name: string | null;
  timestamp: string;
  detail?: string;
}

const ACTION_ICONS: Record<string, { icon: typeof Check; color: string }> = {
  completed: { icon: Check, color: 'text-success' },
  created: { icon: Plus, color: 'text-primary' },
  snoozed: { icon: Clock, color: 'text-warning' },
  cancelled: { icon: X, color: 'text-danger' },
  processed: { icon: FileText, color: 'text-primary' },
  uploaded: { icon: FileText, color: 'text-muted' },
};

const ACTION_LABELS: Record<string, string> = {
  completed: 'Completed',
  created: 'Created',
  snoozed: 'Snoozed',
  cancelled: 'Cancelled',
  processed: 'Processed',
  uploaded: 'Uploaded',
};

export function ActivityFeed({ limit = 12 }: { limit?: number }) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchFeed() {
      try {
        const res = await fetch(`/api/activity?limit=${limit}`);
        if (res.ok) {
          const data = await res.json();
          setItems(data);
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    fetchFeed();
  }, []);

  if (loading) {
    return (
      <div>
        <h2 className="section-title mb-3">Recent Activity</h2>
        <div className="flex items-center gap-2 text-muted text-sm py-4">
          <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        <h2 className="section-title mb-3">Recent Activity</h2>
        <div className="flex flex-col items-center py-6 text-muted">
          <Activity className="w-8 h-8 mb-2 opacity-30" />
          <p className="text-sm">No activity yet. Start by adding a commitment or uploading a transcript.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="section-title mb-3">Recent Activity</h2>
      <div className="space-y-0.5">
        {items.map((item) => {
          const config = ACTION_ICONS[item.action] || { icon: ArrowRight, color: 'text-muted' };
          const Icon = config.icon;
          const label = ACTION_LABELS[item.action] || item.action;
          const timeAgo = formatDistanceToNow(new Date(item.timestamp), { addSuffix: true });

          return (
            <div key={item.id} className="flex items-start gap-2.5 py-1.5 group">
              <div className={`flex-shrink-0 mt-0.5 ${config.color}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs leading-snug">
                  <span className="text-muted">{label}</span>{' '}
                  <span className="font-medium text-foreground truncate">{item.title}</span>
                  {item.org_name && (
                    <span className="text-muted"> · {item.org_name}</span>
                  )}
                  {item.detail && (
                    <span className="text-muted"> {item.detail}</span>
                  )}
                </p>
                <p className="text-[10px] text-muted/60 mt-0.5">{timeAgo}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
