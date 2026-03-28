'use client';

import { useState } from 'react';
import { Target, Check, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import type { Commitment } from '@/types/database';
import { getDueLabel, getCommitmentTypeLabel } from '@/lib/utils';
import { SnoozePicker } from '@/components/ui/snooze-picker';

interface NextUpCardProps {
  commitment: Commitment | null;
  onComplete: (id: string) => void;
  onSnooze: (id: string, date: string) => void;
}

export function NextUpCard({ commitment, onComplete, onSnooze }: NextUpCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);

  if (!commitment) {
    return (
      <div className="bg-card rounded-xl p-6 border border-border">
        <div className="flex items-center gap-2 text-success">
          <Check className="w-5 h-5" />
          <span className="font-semibold">All Clear</span>
        </div>
        <p className="text-muted mt-1 text-sm">No pending commitments. Nice work.</p>
      </div>
    );
  }

  const dueLabel = getDueLabel(commitment.due_date, commitment.status);
  const isOverdue = commitment.due_date && new Date(commitment.due_date) < new Date();

  return (
    <>
      <div className="rounded-xl p-5 relative" style={{ background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.06), rgba(129, 140, 248, 0.03))' }}>
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-gradient">Next Up</span>
        </div>

        <h3 className="text-lg font-semibold leading-tight">{commitment.title}</h3>

        <div className="flex flex-wrap items-center gap-2 mt-2 text-sm">
          {commitment.category === 'personal' && (
            <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 text-[11px] font-medium uppercase tracking-wide">Personal</span>
          )}
          {commitment.organization && (
            <span className="text-muted">{commitment.organization.name}</span>
          )}
          <span className="text-muted">&middot;</span>
          <span className="text-muted">{getCommitmentTypeLabel(commitment.commitment_type)}</span>
          {dueLabel && (
            <>
              <span className="text-muted">&middot;</span>
              <span className={isOverdue ? 'text-danger font-medium' : 'text-muted'}>
                {dueLabel}
              </span>
            </>
          )}
        </div>

        {showDetails && commitment.description && (
          <p className="mt-3 text-sm text-muted leading-relaxed">{commitment.description}</p>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => onComplete(commitment.id)}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium text-white btn-gradient"
          >
            <Check className="w-4 h-4" />
            Done
          </button>
          <button
            onClick={() => setShowSnooze(true)}
            className="flex-1 flex items-center justify-center gap-2 bg-warning/15 text-warning hover:bg-warning/25 rounded-lg py-2.5 text-sm font-medium transition-all border border-warning/20 hover:border-warning/30"
          >
            <Clock className="w-4 h-4" />
            Snooze
          </button>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="px-3 py-2.5 bg-background hover:bg-card-hover rounded-lg text-muted transition-colors"
          >
            {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {showSnooze && (
        <SnoozePicker
          onSnooze={(date) => {
            onSnooze(commitment.id, date);
            setShowSnooze(false);
          }}
          onClose={() => setShowSnooze(false)}
        />
      )}
    </>
  );
}
