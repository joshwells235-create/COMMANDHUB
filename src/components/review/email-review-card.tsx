'use client';

import { useState, useRef } from 'react';
import { Check, CheckSquare, X, Edit2, Mail } from 'lucide-react';
import type { ReviewEmail } from '@/types/database';
import { getCommitmentTypeLabel, getCommitmentTypeColor, cn } from '@/lib/utils';
import { format } from 'date-fns';

interface EmailReviewCardProps {
  email: ReviewEmail;
  onAcceptAll: (emailId: string) => void;
  onAcceptSelected: (emailId: string, indices: number[]) => void;
  onDismiss: (emailId: string) => void;
}

export function EmailReviewCard({
  email,
  onAcceptAll,
  onAcceptSelected,
  onDismiss,
}: EmailReviewCardProps) {
  const commitments = email.ai_extraction?.commitments ?? [];
  const [selected, setSelected] = useState<Set<number>>(new Set());
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
              {commitments.map((c, i) => (
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
                      <span className="text-sm group-hover:text-foreground transition-colors">
                        {c.title}
                      </span>
                      <span
                        className={cn(
                          'text-xs px-1.5 py-0.5 rounded-full bg-card-hover',
                          getCommitmentTypeColor(c.commitment_type)
                        )}
                      >
                        {getCommitmentTypeLabel(c.commitment_type)}
                      </span>
                    </div>
                    {c.suggested_due && (
                      <span className="text-xs text-muted">
                        Due {format(new Date(c.suggested_due), 'MMM d')}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => onAcceptAll(email.id)}
            className="flex items-center gap-1 px-3 py-1.5 bg-success/20 text-success rounded-md text-xs font-medium hover:bg-success/30 transition-colors"
          >
            <Check className="w-3 h-3" /> Accept All
          </button>
          <button
            onClick={() => onAcceptSelected(email.id, Array.from(selected))}
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
            disabled
            className="flex items-center gap-1 px-3 py-1.5 bg-card-hover text-muted rounded-md text-xs font-medium cursor-not-allowed"
          >
            <Edit2 className="w-3 h-3" /> Edit
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
