'use client';

import { Clock, ArrowRight, Check } from 'lucide-react';
import type { Commitment } from '@/types/database';
import { getDueLabel } from '@/lib/utils';

interface WaitingOnListProps {
  commitments: Commitment[];
  onReceived: (id: string) => void;
}

export function WaitingOnList({ commitments, onReceived }: WaitingOnListProps) {
  if (commitments.length === 0) {
    return (
      <div>
        <h2 className="section-title mb-3">Waiting On</h2>
        <div className="flex flex-col items-center py-6 text-center">
          <Check className="w-8 h-8 text-success/40 mb-2" />
          <p className="text-sm text-muted">Nothing pending from others.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="section-title mb-3">
        Waiting On ({commitments.length})
      </h2>

      <div className="space-y-1">
        {commitments.map((c) => {
          const dueLabel = getDueLabel(c.due_date, c.status);
          return (
            <div
              key={c.id}
              className="bg-card rounded-lg px-4 py-3 flex items-center gap-3 hover:bg-card-hover transition-all border border-transparent hover:border-border"
            >
              <Clock className="w-4 h-4 text-orange-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-tight">
                  {c.category === 'personal' && (
                    <span className="inline-block px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-medium mr-1.5 align-middle">Personal</span>
                  )}
                  {c.category === 'internal' && (
                    <span className="inline-block px-1 py-0.5 rounded bg-violet-500/15 text-violet-400 text-[10px] font-medium mr-1.5 align-middle">Internal</span>
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
