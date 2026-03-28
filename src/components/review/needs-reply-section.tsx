'use client';

import { useState } from 'react';
import { MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';
import type { ReviewEmail, ReplyUrgency } from '@/types/database';
import { cn } from '@/lib/utils';

interface NeedsReplySectionProps {
  emails: ReviewEmail[];
}

const urgencyOrder: Record<ReplyUrgency, number> = {
  today: 0,
  this_week: 1,
  no_rush: 2,
};

const urgencyConfig: Record<ReplyUrgency, { label: string; className: string }> = {
  today: { label: 'Today', className: 'bg-danger/20 text-danger' },
  this_week: { label: 'This Week', className: 'bg-warning/20 text-warning' },
  no_rush: { label: 'No Rush', className: 'bg-card-hover text-muted' },
};

export function NeedsReplySection({ emails }: NeedsReplySectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sorted = [...emails].sort((a, b) => {
    const urgA = a.ai_extraction?.reply_urgency ?? 'no_rush';
    const urgB = b.ai_extraction?.reply_urgency ?? 'no_rush';
    return urgencyOrder[urgA] - urgencyOrder[urgB];
  });

  if (sorted.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
        Reply Needed ({sorted.length})
      </h2>

      <div className="space-y-1">
        {sorted.map((email) => {
          const urgency = email.ai_extraction?.reply_urgency ?? 'no_rush';
          const config = urgencyConfig[urgency];
          const isExpanded = expandedId === email.id;
          const subjectTruncated =
            email.subject.length > 50
              ? email.subject.slice(0, 50) + '...'
              : email.subject;

          return (
            <div key={email.id} className="bg-card rounded-lg hover:bg-card-hover transition-colors">
              <button
                onClick={() => setExpandedId(isExpanded ? null : email.id)}
                className="w-full text-left px-4 py-3 flex items-start gap-3"
              >
                <div className="flex-shrink-0 mt-0.5">
                  <MessageSquare className="w-4 h-4 text-primary" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {email.sender || 'Unknown'}
                    </span>
                    <span
                      className={cn(
                        'text-xs px-1.5 py-0.5 rounded-full font-medium',
                        config.className
                      )}
                    >
                      {config.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-0.5 truncate">
                    {subjectTruncated}
                  </p>
                </div>

                <div className="flex-shrink-0 mt-1 text-muted">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-3 pl-11">
                  <p className="text-sm font-medium mb-1">{email.subject}</p>
                  <p className="text-xs text-muted leading-relaxed">
                    {email.body_preview}
                  </p>
                  {email.ai_extraction?.summary && (
                    <p className="text-xs text-primary/80 mt-2 italic">
                      {email.ai_extraction.summary}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
