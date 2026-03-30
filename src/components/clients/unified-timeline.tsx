'use client';

import { useState, useMemo } from 'react';
import {
  Mail,
  Send,
  Calendar,
  FileText,
  Plus,
  Check,
  Inbox,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export interface TimelineItem {
  id: string;
  type:
    | 'email_received'
    | 'email_sent'
    | 'calendar'
    | 'transcript'
    | 'commitment_created'
    | 'commitment_completed';
  date: string;
  title: string;
  subtitle?: string;
  detail?: string;
  sentiment?: string;
  orgName?: string;
}

interface UnifiedTimelineProps {
  items: TimelineItem[];
  loading?: boolean;
}

type FilterKey = 'all' | 'emails' | 'meetings' | 'sessions' | 'commitments';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'emails', label: 'Emails' },
  { key: 'meetings', label: 'Meetings' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'commitments', label: 'Commitments' },
];

const TYPE_CONFIG: Record<
  TimelineItem['type'],
  { icon: typeof Mail; circleColor: string; label: string }
> = {
  email_received: {
    icon: Mail,
    circleColor: 'bg-blue-400',
    label: 'Email Received',
  },
  email_sent: {
    icon: Send,
    circleColor: 'bg-green-400',
    label: 'Email Sent',
  },
  calendar: {
    icon: Calendar,
    circleColor: 'bg-amber-400',
    label: 'Meeting',
  },
  transcript: {
    icon: FileText,
    circleColor: 'bg-indigo-400',
    label: 'Session',
  },
  commitment_created: {
    icon: Plus,
    circleColor: 'bg-primary',
    label: 'Commitment Created',
  },
  commitment_completed: {
    icon: Check,
    circleColor: 'bg-success',
    label: 'Completed',
  },
};

const FILTER_TYPE_MAP: Record<FilterKey, TimelineItem['type'][]> = {
  all: [],
  emails: ['email_received', 'email_sent'],
  meetings: ['calendar'],
  sessions: ['transcript'],
  commitments: ['commitment_created', 'commitment_completed'],
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'bg-success',
  negative: 'bg-danger',
  concerned: 'bg-warning',
};

export function UnifiedTimeline({ items, loading }: UnifiedTimelineProps) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');

  const filtered = useMemo(() => {
    const types = FILTER_TYPE_MAP[activeFilter];
    const list =
      activeFilter === 'all'
        ? items
        : items.filter((item) => types.includes(item.type));
    return list.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, [items, activeFilter]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 bg-card/50 rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setActiveFilter(f.key)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
              activeFilter === f.key
                ? 'bg-primary/20 text-primary'
                : 'text-muted hover:text-foreground'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted/60">
          <Inbox className="w-8 h-8 mb-2" />
          <p className="text-sm">No interactions recorded yet</p>
        </div>
      ) : (
        <div className="relative pl-6">
          {/* Vertical line */}
          <div className="absolute left-[9px] top-2 bottom-2 w-px bg-primary/30" />

          <div className="space-y-3">
            {filtered.map((item) => {
              const config = TYPE_CONFIG[item.type];
              const Icon = config.icon;
              const sentimentColor = item.sentiment
                ? SENTIMENT_COLORS[item.sentiment]
                : null;

              return (
                <div key={`${item.type}-${item.id}`} className="relative flex items-start gap-3">
                  {/* Circle on the timeline line */}
                  <div
                    className={cn(
                      'absolute -left-6 top-3 w-[11px] h-[11px] rounded-full border-2 border-background z-10',
                      config.circleColor
                    )}
                  />

                  {/* Content card */}
                  <div className="flex-1 bg-card/50 rounded-lg p-3 border border-border/50">
                    <div className="flex items-start gap-2">
                      <Icon className="w-3.5 h-3.5 text-muted flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium leading-tight truncate">
                            {item.title}
                          </p>
                          {sentimentColor && (
                            <span
                              className={cn(
                                'w-2 h-2 rounded-full flex-shrink-0',
                                sentimentColor
                              )}
                              title={`Sentiment: ${item.sentiment}`}
                            />
                          )}
                        </div>
                        {item.subtitle && (
                          <p className="text-xs text-muted mt-0.5 truncate">
                            {item.subtitle}
                          </p>
                        )}
                        {item.detail && (
                          <p className="text-xs text-muted/80 mt-1 line-clamp-2">
                            {item.detail}
                          </p>
                        )}
                      </div>
                      <span className="text-[10px] text-muted font-mono flex-shrink-0">
                        {format(new Date(item.date), 'MMM d, h:mm a')}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
