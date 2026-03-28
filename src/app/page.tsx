'use client';

import { useState, useMemo } from 'react';
import { Plus, Zap, Inbox, Users, FileText, Settings, MessageSquare } from 'lucide-react';
import Link from 'next/link';
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
import { CommandHubChat } from '@/components/chat/command-hub-chat';
import { ClientPulse } from '@/components/dashboard/client-pulse';
import { isToday, isThisWeek } from 'date-fns';

export default function FocusView() {
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

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

  // Compute stats
  const stats = useMemo(() => {
    const now = new Date();
    let overdue = 0;
    let dueToday = 0;
    let thisWeek = 0;

    for (const c of commitments) {
      if (!c.due_date) continue;
      const d = new Date(c.due_date);
      if (d < now && !isToday(d)) {
        overdue++;
      } else if (isToday(d)) {
        dueToday++;
      } else if (isThisWeek(d)) {
        thisWeek++;
      }
    }

    return { overdue, dueToday, thisWeek, waitingOn: waitingOn.length };
  }, [commitments, waitingOn]);

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
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold tracking-tight">COMMAND HUB</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/settings" className="text-muted hover:text-foreground transition-colors">
              <Settings className="w-5 h-5" />
            </Link>
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
      <main className="max-w-7xl mx-auto px-4 py-6 pb-24">
        {/* Stats bar - visible on desktop */}
        <div className="hidden lg:grid grid-cols-4 gap-2 mb-6">
          <div className="bg-card rounded-lg p-3 text-center border border-border/50">
            <p className="text-2xl font-bold text-danger">{stats.overdue}</p>
            <p className="text-xs text-muted">Overdue</p>
          </div>
          <div className="bg-card rounded-lg p-3 text-center border border-border/50">
            <p className="text-2xl font-bold text-warning">{stats.dueToday}</p>
            <p className="text-xs text-muted">Due Today</p>
          </div>
          <div className="bg-card rounded-lg p-3 text-center border border-border/50">
            <p className="text-2xl font-bold text-primary">{stats.thisWeek}</p>
            <p className="text-xs text-muted">This Week</p>
          </div>
          <div className="bg-card rounded-lg p-3 text-center border border-border/50">
            <p className="text-2xl font-bold text-orange-400">{stats.waitingOn}</p>
            <p className="text-xs text-muted">Waiting On</p>
          </div>
        </div>

        {/* Two-column layout on desktop, single column on mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left column (desktop) / Main flow (mobile) */}
          <div className="lg:col-span-3 space-y-6">
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
          </div>

          {/* Right column (desktop) / continues below on mobile */}
          <div className="lg:col-span-2 space-y-6">
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

            {/* Stats bar - mobile only */}
            <div className="grid grid-cols-4 gap-2 lg:hidden">
              <div className="bg-card rounded-lg p-3 text-center border border-border/50">
                <p className="text-2xl font-bold text-danger">{stats.overdue}</p>
                <p className="text-xs text-muted">Overdue</p>
              </div>
              <div className="bg-card rounded-lg p-3 text-center border border-border/50">
                <p className="text-2xl font-bold text-warning">{stats.dueToday}</p>
                <p className="text-xs text-muted">Due Today</p>
              </div>
              <div className="bg-card rounded-lg p-3 text-center border border-border/50">
                <p className="text-2xl font-bold text-primary">{stats.thisWeek}</p>
                <p className="text-xs text-muted">This Week</p>
              </div>
              <div className="bg-card rounded-lg p-3 text-center border border-border/50">
                <p className="text-2xl font-bold text-orange-400">{stats.waitingOn}</p>
                <p className="text-xs text-muted">Waiting On</p>
              </div>
            </div>

            {/* Inbox Review badge */}
            {reviewEmails.length > 0 && (
              <Link
                href="/review"
                className="flex items-center gap-3 bg-warning/10 border border-warning/30 rounded-lg px-4 py-3 hover:bg-warning/20 transition-colors"
              >
                <Inbox className="w-5 h-5 text-warning" />
                <div>
                  <p className="text-sm font-medium text-foreground">Inbox Review</p>
                  <p className="text-xs text-muted">{reviewEmails.length} items need review</p>
                </div>
              </Link>
            )}

            {/* Client Pulse */}
            <ClientPulse />

            {/* Waiting On */}
            <WaitingOnList
              commitments={waitingOn}
              onReceived={completeCommitment}
            />
          </div>
        </div>

        {/* Quick Links - full width */}
        <div className="grid grid-cols-2 gap-2 pt-6">
          <Link
            href="/clients"
            className="flex items-center gap-2 bg-card rounded-lg px-4 py-3 hover:bg-card-hover transition-colors"
          >
            <Users className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Clients</span>
          </Link>
          <Link
            href="/transcripts"
            className="flex items-center gap-2 bg-card rounded-lg px-4 py-3 hover:bg-card-hover transition-colors"
          >
            <FileText className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Transcripts</span>
          </Link>
        </div>

        {/* Ask Command Hub bar */}
        <div className="mt-6">
          <button
            onClick={() => setChatOpen(true)}
            className="w-full flex items-center gap-3 bg-card border border-border/50 rounded-lg px-4 py-3 hover:bg-card-hover transition-colors group"
          >
            <MessageSquare className="w-5 h-5 text-primary group-hover:text-primary" />
            <span className="text-sm text-muted group-hover:text-foreground transition-colors">
              Ask Command Hub...
            </span>
          </button>
        </div>
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

      {/* Chat Panel */}
      <CommandHubChat isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
