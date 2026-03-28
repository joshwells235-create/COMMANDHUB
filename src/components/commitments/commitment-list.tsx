'use client';

import { useState } from 'react';
import { Check, Clock, X, AlertTriangle } from 'lucide-react';
import type { Commitment } from '@/types/database';
import { getDueLabel, getCommitmentTypeLabel, getEscalationIndicator, cn } from '@/lib/utils';
import { SnoozePicker } from '@/components/ui/snooze-picker';
import { formatDistanceToNow } from 'date-fns';

interface CommitmentListProps {
  commitments: Commitment[];
  title: string;
  emptyMessage?: string;
  onComplete: (id: string) => void;
  onSnooze: (id: string, date: string) => void;
  onCancel: (id: string) => void;
  showActions?: boolean;
}

export function CommitmentList({
  commitments,
  title,
  emptyMessage = 'Nothing here.',
  onComplete,
  onSnooze,
  onCancel,
  showActions = true,
}: CommitmentListProps) {
  const [snoozeTarget, setSnoozeTarget] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
        {title} ({commitments.length})
      </h2>

      {commitments.length === 0 ? (
        <p className="text-sm text-muted/60 py-3">{emptyMessage}</p>
      ) : (
        <div className="space-y-1">
          {commitments.map((c) => {
            const escalation = getEscalationIndicator(c.escalation_level);
            const dueLabel = getDueLabel(c.due_date, c.status);
            const isOverdue = c.due_date && new Date(c.due_date) < new Date();
            const isExpanded = expandedId === c.id;
            const ageLabel = !c.due_date
              ? `${formatDistanceToNow(new Date(c.created_at))} old`
              : '';

            return (
              <div
                key={c.id}
                className="bg-card rounded-lg hover:bg-card-hover transition-colors"
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  className="w-full text-left px-4 py-3 flex items-start gap-3"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {escalation ? (
                      <span className="text-danger font-bold text-xs">{escalation}</span>
                    ) : (
                      <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-muted/40" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight truncate">{c.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-muted">
                      {c.category === 'personal' && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 text-[10px] font-medium uppercase tracking-wide">Personal</span>
                      )}
                      {c.organization && <span>{c.organization.name}</span>}
                      {(c.organization || c.category === 'personal') && (dueLabel || ageLabel) && <span>&middot;</span>}
                      {dueLabel && (
                        <span className={cn(isOverdue && 'text-danger')}>{dueLabel}</span>
                      )}
                      {!dueLabel && ageLabel && <span>{ageLabel}</span>}
                    </div>
                  </div>

                  <span className={cn('text-xs mt-0.5 flex-shrink-0', isOverdue ? 'text-danger' : 'text-muted')}>
                    {getCommitmentTypeLabel(c.commitment_type)}
                  </span>
                </button>

                {isExpanded && showActions && (
                  <div className="px-4 pb-3 flex items-center gap-2">
                    {c.description && (
                      <p className="text-xs text-muted mb-2 w-full">{c.description}</p>
                    )}
                    <button
                      onClick={() => onComplete(c.id)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-success/20 text-success rounded-md text-xs font-medium hover:bg-success/30"
                    >
                      <Check className="w-3 h-3" /> Done
                    </button>
                    <button
                      onClick={() => setSnoozeTarget(c.id)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-warning/20 text-warning rounded-md text-xs font-medium hover:bg-warning/30"
                    >
                      <Clock className="w-3 h-3" /> Snooze
                    </button>
                    <button
                      onClick={() => onCancel(c.id)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-danger/20 text-danger rounded-md text-xs font-medium hover:bg-danger/30"
                    >
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {snoozeTarget && (
        <SnoozePicker
          onSnooze={(date) => {
            onSnooze(snoozeTarget, date);
            setSnoozeTarget(null);
          }}
          onClose={() => setSnoozeTarget(null)}
        />
      )}
    </div>
  );
}
