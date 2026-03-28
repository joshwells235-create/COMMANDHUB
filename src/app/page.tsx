'use client';

import { useState } from 'react';
import { Plus, Zap, Inbox, Mail } from 'lucide-react';
import { useCommitments } from '@/lib/hooks/use-commitments';
import { useOrganizations } from '@/lib/hooks/use-organizations';
import { useCalendarEvents } from '@/lib/hooks/use-calendar';
import { useReviewQueue } from '@/lib/hooks/use-review-queue';
import { useNeedsReply } from '@/lib/hooks/use-needs-reply';
import { NextUpCard } from '@/components/commitments/next-up-card';
import { CommitmentList } from '@/components/commitments/commitment-list';
import { WaitingOnList } from '@/components/commitments/waiting-on-list';
import { QuickAdd } from '@/components/commitments/quick-add';
import { TodayEvents } from '@/components/calendar/today-events';
import { NeedsReplySection } from '@/components/review/needs-reply-section';

export default function FocusView() {
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  const {
    commitments,
    loading: commitmentsLoading,
    createCommitment,
    completeCommitment,
    snoozeCommitment,
    cancelCommitment,
  } = useCommitments({ status: 'pending,in_progress', limit: 50 });

  const { commitments: waitingOn } = useCommitments({
    status: 'waiting',
    owner: 'other',
    limit: 20,
  });

  const { organizations } = useOrganizations();
  const { events, loading: calendarLoading, connected } = useCalendarEvents();
  const { emails: reviewEmails } = useReviewQueue();
  const { emails: needsReplyEmails } = useNeedsReply();

  // The #1 item by priority
  const joshCommitments = commitments.filter((c) => c.owner === 'josh');
  const nextUp = joshCommitments[0] || null;
  const needsAttention = joshCommitments.slice(1);

  if (commitmentsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted">
          <Zap className="w-5 h-5 text-primary animate-pulse" />
          <span>Loading Command Hub...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold tracking-tight">COMMAND HUB</h1>
          </div>
          <div className="flex items-center gap-2">
            {reviewEmails.length > 0 && (
              <a
                href="/review"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-warning/20 text-warning rounded-lg text-sm font-medium hover:bg-warning/30 transition-colors"
              >
                <Inbox className="w-4 h-4" />
                <span>{reviewEmails.length}</span>
              </a>
            )}
            <button
              onClick={() => setShowQuickAdd(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-24">
        {/* Next Up Card */}
        <NextUpCard
          commitment={nextUp}
          onComplete={async (id) => {
            await completeCommitment(id);
          }}
          onSnooze={async (id, date) => {
            await snoozeCommitment(id, date);
          }}
        />

        {/* Today's Calendar */}
        <TodayEvents
          events={events}
          connected={connected}
          loading={calendarLoading}
        />

        {/* Needs Attention */}
        <CommitmentList
          commitments={needsAttention}
          title="Needs Attention"
          emptyMessage="Queue is clear after your next task."
          onComplete={completeCommitment}
          onSnooze={snoozeCommitment}
          onCancel={cancelCommitment}
        />

        {/* Needs Reply */}
        <NeedsReplySection emails={needsReplyEmails} />

        {/* Waiting On */}
        <WaitingOnList
          commitments={waitingOn}
          onReceived={completeCommitment}
        />
      </main>

      {/* Quick Add FAB (mobile) + Modal */}
      <QuickAdd
        organizations={organizations}
        onSubmit={async (input) => {
          await createCommitment(input);
        }}
      />

      {/* Desktop Quick Add hint */}
      <div className="hidden sm:block fixed bottom-4 right-4 text-xs text-muted/50">
        Press <kbd className="px-1.5 py-0.5 bg-card rounded border border-border text-muted">Ctrl+K</kbd> to quick add
      </div>
    </div>
  );
}
