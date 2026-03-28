'use client';

import { Clock, ArrowRight, Check } from 'lucide-react';
import type { Commitment } from '@/types/database';
import { getDueLabel } from '@/lib/utils';

interface WaitingOnListProps {
  commitments: Commitment[];
  onReceived: (id: string) => void;
}

export function WaitingOnList({ commitments, onReceived }: WaitingOnListProps) {
  if (commitments.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
        Waiting On ({commitments.length})
      </h2>

      <div className="space-y-1">
        {commitments.map((c) => {
          const dueLabel = getDueLabel(c.due_date, c.status);
          return (
            <div
              key={c.id}
              className="bg-card rounded-lg px-4 py-3 flex items-center gap-3"
            >
              <Clock className="w-4 h-4 text-orange-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-tight">
                  {c.category === 'personal' && (
                    <span className="inline-block px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 text-[10px] font-medium uppercase tracking-wide mr-1.5 align-middle">Personal</span>
                  )}
                  <span className="font-medium">{c.other_party || 'Someone'}</span>
                  <span className="text-muted">: {c.title}</span>
                </p>
                {dueLabel && (
                  <span className="text-xs text-muted">{dueLabel}</span>
                )}
              </div>
              <button
                onClick={() => onReceived(c.id)}
                className="flex-shrink-0 p-1.5 text-success hover:bg-success/20 rounded-md transition-colors"
                title="Mark as received"
              >
                <Check className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
