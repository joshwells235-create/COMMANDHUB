'use client';

import { useState, useRef } from 'react';
import { Check, CheckSquare, X, Edit2, Mail, Save, Pencil, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import type { ReviewEmail, CommitmentType } from '@/types/database';
import { getCommitmentTypeLabel, getCommitmentTypeColor, cn } from '@/lib/utils';
import { format } from 'date-fns';

interface EmailReviewCardProps {
  email: ReviewEmail;
  onAcceptAll: (emailId: string, edits?: Record<number, { title?: string; commitment_type?: string; suggested_due?: string | null }>) => void;
  onAcceptSelected: (emailId: string, indices: number[], edits?: Record<number, { title?: string; commitment_type?: string; suggested_due?: string | null }>) => void;
  onDismiss: (emailId: string) => void;
  compact?: boolean;
}

const COMMITMENT_TYPES: { value: CommitmentType; label: string }[] = [
  { value: 'promise_made', label: 'Promise Made' },
  { value: 'ask_received', label: 'Ask Received' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'waiting_on', label: 'Waiting On' },
  { value: 'deliverable', label: 'Deliverable' },
  { value: 'prep', label: 'Prep' },
  { value: 'internal', label: 'Internal' },
  { value: 'note_to_self', label: 'Note to Self' },
];

export function EmailReviewCard({
  email,
  onAcceptAll,
  onAcceptSelected,
  onDismiss,
  compact = false,
}: EmailReviewCardProps) {
  const commitments = email.ai_extraction?.commitments ?? [];
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, { title: string; commitment_type: string; suggested_due: string }>>({});
  const [swipeX, setSwipeX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isHorizontalSwipe = useRef(false);

  const toggleSelection = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isHorizontalSwipe.current = false;
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping) return;
    const deltaX = e.touches[0].clientX - touchStartX.current;
    const deltaY = e.touches[0].clientY - touchStartY.current;

    // Determine swipe direction on first significant movement
    if (!isHorizontalSwipe.current && Math.abs(deltaX) > 10) {
      isHorizontalSwipe.current = Math.abs(deltaX) > Math.abs(deltaY);
    }

    if (isHorizontalSwipe.current) {
      setSwipeX(deltaX);
    }
  };

  const handleTouchEnd = () => {
    setIsSwiping(false);
    if (swipeX > 100) {
      onAcceptAll(email.id);
    } else if (swipeX < -100) {
      onDismiss(email.id);
    }
    setSwipeX(0);
  };

  const bodyPreview =
    email.body_preview.length > 100
      ? email.body_preview.slice(0, 100) + '...'
      : email.body_preview;

  const swipeProgress = Math.min(Math.abs(swipeX) / 100, 1);

  if (compact) {
    const isReceived = !!(email.sender && email.sender_email);
    return (
      <div className="flex items-center gap-3 px-3 py-2 text-sm">
        <div className="flex-shrink-0">
          {isReceived ? (
            <ArrowDownLeft className="w-3.5 h-3.5 text-primary/60" />
          ) : (
            <ArrowUpRight className="w-3.5 h-3.5 text-muted/60" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted truncate">
              {email.sender || 'Unknown'}
            </span>
            <span className="text-xs text-muted/60">
              {format(new Date(email.received_at), 'MMM d, h:mm a')}
            </span>
          </div>
          <p className="text-xs text-muted/80 truncate">{email.subject}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="swipe-container rounded-lg overflow-hidden relative">
      {/* Swipe background indicators */}
      {swipeX > 0 && (
        <div
          className="absolute inset-0 bg-success/20 flex items-center px-6"
          style={{ opacity: swipeProgress }}
        >
          <Check className="w-8 h-8 text-success" />
          <span className="ml-2 text-success font-medium">Accept All</span>
        </div>
      )}
      {swipeX < 0 && (
        <div
          className="absolute inset-0 bg-danger/20 flex items-center justify-end px-6"
          style={{ opacity: swipeProgress }}
        >
          <span className="mr-2 text-danger font-medium">Dismiss</span>
          <X className="w-8 h-8 text-danger" />
        </div>
      )}

      {/* Card content */}
      <div
        className={cn(
          'bg-card border border-border rounded-lg p-4 relative z-10',
          !isSwiping && 'swipe-content'
        )}
        style={{
          transform: swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Email header */}
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <Mail className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">
                {email.sender || 'Unknown'}
              </span>
              {email.organization && (
                <span className="text-xs text-muted bg-card-hover px-1.5 py-0.5 rounded">
                  {email.organization.name}
                </span>
              )}
            </div>
            <p className="text-sm text-foreground font-medium mt-0.5 truncate">
              {email.subject}
            </p>
            <p className="text-xs text-muted mt-1">{bodyPreview}</p>
          </div>
        </div>

        {/* AI-extracted commitments */}
        {commitments.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              AI found:
            </p>
            <div className="space-y-1.5">
              {commitments.map((c, i) => {
                const edited = edits[i];
                const displayTitle = edited?.title ?? c.title;
                const displayType = edited?.commitment_type ?? c.commitment_type;
                const displayDue = edited?.suggested_due ?? c.suggested_due;
                const isEditing = editingIdx === i;

                if (isEditing) {
                  return (
                    <div key={i} className="bg-background rounded-md p-2 space-y-1.5 border border-border">
                      <input
                        type="text"
                        value={edited?.title ?? c.title}
                        onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], title: e.target.value, commitment_type: edits[i]?.commitment_type ?? c.commitment_type, suggested_due: edits[i]?.suggested_due ?? c.suggested_due ?? '' } })}
                        className="w-full bg-card border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                      />
                      <div className="flex gap-2">
                        <select
                          value={edited?.commitment_type ?? c.commitment_type}
                          onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], title: edits[i]?.title ?? c.title, commitment_type: e.target.value, suggested_due: edits[i]?.suggested_due ?? c.suggested_due ?? '' } })}
                          className="flex-1 bg-card border border-border rounded px-2 py-1 text-xs"
                        >
                          {COMMITMENT_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                        <input
                          type="date"
                          value={(edited?.suggested_due ?? c.suggested_due ?? '').split('T')[0]}
                          onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], title: edits[i]?.title ?? c.title, commitment_type: edits[i]?.commitment_type ?? c.commitment_type, suggested_due: e.target.value } })}
                          className="flex-1 bg-card border border-border rounded px-2 py-1 text-xs"
                        />
                      </div>
                      <button
                        onClick={() => setEditingIdx(null)}
                        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
                      >
                        <Save className="w-3 h-3" /> Done
                      </button>
                    </div>
                  );
                }

                return (
                  <label
                    key={i}
                    className="flex items-start gap-2 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={() => toggleSelection(i)}
                      className="mt-1 rounded border-border accent-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={cn('text-sm group-hover:text-foreground transition-colors', edited && 'text-primary')}>
                          {displayTitle}
                        </span>
                        <span
                          className={cn(
                            'text-xs px-1.5 py-0.5 rounded-full bg-card-hover',
                            getCommitmentTypeColor(displayType)
                          )}
                        >
                          {getCommitmentTypeLabel(displayType)}
                        </span>
                        <button
                          onClick={(e) => { e.preventDefault(); setEditingIdx(i); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-muted hover:text-primary transition-all"
                          title="Edit before accepting"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                      {displayDue && (
                        <span className="text-xs text-muted">
                          Due {format(new Date(displayDue), 'MMM d')}
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => onAcceptAll(email.id, Object.keys(edits).length > 0 ? edits : undefined)}
            className="flex items-center gap-1 px-3 py-1.5 bg-success/20 text-success rounded-md text-xs font-medium hover:bg-success/30 transition-colors"
          >
            <Check className="w-3 h-3" /> Accept All
          </button>
          <button
            onClick={() => onAcceptSelected(email.id, Array.from(selected), Object.keys(edits).length > 0 ? edits : undefined)}
            disabled={selected.size === 0}
            className={cn(
              'flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              selected.size > 0
                ? 'bg-primary/20 text-primary hover:bg-primary/30'
                : 'bg-card-hover text-muted cursor-not-allowed'
            )}
          >
            <CheckSquare className="w-3 h-3" /> Accept Selected
            {selected.size > 0 && ` (${selected.size})`}
          </button>
          <button
            onClick={() => onDismiss(email.id)}
            className="flex items-center gap-1 px-3 py-1.5 bg-danger/20 text-danger rounded-md text-xs font-medium hover:bg-danger/30 transition-colors ml-auto"
          >
            <X className="w-3 h-3" /> Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
