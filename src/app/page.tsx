'use client';

import { useState, useMemo } from 'react';
import { Plus, Zap, Inbox, Users, FileText, Settings, MessageSquare, PhoneForwarded, Search } from 'lucide-react';
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
import { FollowUpWidget } from '@/components/dashboard/follow-up-widget';
import { IntelligencePanel } from '@/components/dashboard/intelligence-panel';
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
    <div className="min-h-screen bg-background pb-16 lg:pb-0">
      {/* Header (sticky) */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold tracking-tight hidden sm:block">COMMAND HUB</h1>
          </div>

          {/* Ask Command Hub search bar */}
          <button
            onClick={() => setChatOpen(true)}
            className="flex-1 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 hover:bg-card-hover transition-colors group max-w-md mx-auto"
          >
            <Search className="w-4 h-4 text-muted group-hover:text-primary transition-colors" />
            <span className="text-sm text-muted group-hover:text-foreground transition-colors">
              Ask Command Hub...
            </span>
          </button>

          {/* Right actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
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
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add</span>
            </button>
            <Link href="/settings" className="text-muted hover:text-foreground transition-colors">
              <Settings className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-4">
        {/* MOBILE LAYOUT */}
        <div className="lg:hidden space-y-4">
          {/* 1. Next Up Card */}
          <div className="bg-card rounded-xl border border-border border-l-2 border-l-primary p-4">
            <NextUpCard
              commitment={nextUp}
              onComplete={async (id) => { await completeCommitment(id); }}
              onSnooze={async (id, date) => { await snoozeCommitment(id, date); }}
            />
          </div>

          {/* 2. Stats Bar */}
          <div className="grid grid-cols-4 gap-2">
            <button className="bg-card rounded-xl border border-border p-3 text-center">
              <p className="text-2xl font-bold text-danger">{stats.overdue}</p>
              <p className="text-xs text-muted">Overdue</p>
            </button>
            <button className="bg-card rounded-xl border border-border p-3 text-center">
              <p className="text-2xl font-bold text-warning">{stats.dueToday}</p>
              <p className="text-xs text-muted">Due Today</p>
            </button>
            <button className="bg-card rounded-xl border border-border p-3 text-center">
              <p className="text-2xl font-bold text-primary">{stats.thisWeek}</p>
              <p className="text-xs text-muted">This Week</p>
            </button>
            <button className="bg-card rounded-xl border border-border p-3 text-center">
              <p className="text-2xl font-bold text-orange-400">{stats.waitingOn}</p>
              <p className="text-xs text-muted">Waiting On</p>
            </button>
          </div>

          {/* 3. Today's Calendar */}
          <div className="bg-card rounded-xl border border-border p-4">
            <TodayEvents events={events} connected={connected} loading={calendarLoading} />
          </div>

          {/* 4. Needs Attention */}
          <div className="bg-card rounded-xl border border-border p-4">
            <CommitmentList
              commitments={needsAttention}
              title="Needs Attention"
              emptyMessage="Queue is clear after your next task."
              onComplete={completeCommitment}
              onSnooze={snoozeCommitment}
              onCancel={cancelCommitment}
            />
          </div>

          {/* 5. Waiting On */}
          <div className="bg-card rounded-xl border border-border p-4">
            <WaitingOnList commitments={waitingOn} onReceived={completeCommitment} />
          </div>

          {/* 6. Follow-up Queue */}
          <div className="bg-card rounded-xl border border-border p-4">
            <FollowUpWidget />
          </div>

          {/* 7. Needs Reply */}
          <div className="bg-card rounded-xl border border-border p-4">
            <NeedsReplySection emails={needsReplyEmails} />
          </div>

          {/* 8. Alerts & Health (combined) */}
          <IntelligencePanel />

          {/* 9. Client Pulse */}
          <div className="bg-card rounded-xl border border-border p-4">
            <ClientPulse />
          </div>
        </div>

        {/* DESKTOP LAYOUT */}
        <div className="hidden lg:grid lg:grid-cols-5 gap-4">
          {/* Left column - "Your Day" */}
          <div className="lg:col-span-3 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Your Day</h2>

            {/* Next Up Card (hero) */}
            <div className="bg-card rounded-xl border border-border border-l-2 border-l-primary p-4">
              <NextUpCard
                commitment={nextUp}
                onComplete={async (id) => { await completeCommitment(id); }}
                onSnooze={async (id, date) => { await snoozeCommitment(id, date); }}
              />
            </div>

            {/* Today's Calendar */}
            <div className="bg-card rounded-xl border border-border p-4">
              <TodayEvents events={events} connected={connected} loading={calendarLoading} />
            </div>

            {/* Needs Attention */}
            <div className="bg-card rounded-xl border border-border p-4">
              <CommitmentList
                commitments={needsAttention}
                title="Needs Attention"
                emptyMessage="Queue is clear after your next task."
                onComplete={completeCommitment}
                onSnooze={snoozeCommitment}
                onCancel={cancelCommitment}
              />
            </div>

            {/* Needs Reply */}
            <div className="bg-card rounded-xl border border-border p-4">
              <NeedsReplySection emails={needsReplyEmails} />
            </div>
          </div>

          {/* Right column - "Intelligence" */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Intelligence</h2>

            {/* Stats Bar */}
            <div className="grid grid-cols-4 gap-2">
              <button className="bg-card rounded-xl border border-border p-3 text-center">
                <p className="text-2xl font-bold text-danger">{stats.overdue}</p>
                <p className="text-xs text-muted">Overdue</p>
              </button>
              <button className="bg-card rounded-xl border border-border p-3 text-center">
                <p className="text-2xl font-bold text-warning">{stats.dueToday}</p>
                <p className="text-xs text-muted">Due Today</p>
              </button>
              <button className="bg-card rounded-xl border border-border p-3 text-center">
                <p className="text-2xl font-bold text-primary">{stats.thisWeek}</p>
                <p className="text-xs text-muted">This Week</p>
              </button>
              <button className="bg-card rounded-xl border border-border p-3 text-center">
                <p className="text-2xl font-bold text-orange-400">{stats.waitingOn}</p>
                <p className="text-xs text-muted">Waiting On</p>
              </button>
            </div>

            {/* Follow-up Queue */}
            <div className="bg-card rounded-xl border border-border p-4">
              <FollowUpWidget />
            </div>

            {/* Waiting On */}
            <div className="bg-card rounded-xl border border-border p-4">
              <WaitingOnList commitments={waitingOn} onReceived={completeCommitment} />
            </div>

            {/* Alerts & Health (tabbed) */}
            <IntelligencePanel />

            {/* Client Pulse */}
            <div className="bg-card rounded-xl border border-border p-4">
              <ClientPulse />
            </div>
          </div>
        </div>
      </main>

      {/* Mobile Footer (sticky tab bar) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-background/95 backdrop-blur-sm border-t border-border">
        <div className="flex items-center justify-around py-2 px-4">
          <Link href="/clients" className="flex flex-col items-center gap-0.5 px-3 py-1 text-muted hover:text-foreground transition-colors">
            <Users className="w-5 h-5" />
            <span className="text-[10px] font-medium">Clients</span>
          </Link>
          <Link href="/transcripts" className="flex flex-col items-center gap-0.5 px-3 py-1 text-muted hover:text-foreground transition-colors">
            <FileText className="w-5 h-5" />
            <span className="text-[10px] font-medium">Transcripts</span>
          </Link>
          <Link href="/follow-ups" className="flex flex-col items-center gap-0.5 px-3 py-1 text-muted hover:text-foreground transition-colors">
            <PhoneForwarded className="w-5 h-5" />
            <span className="text-[10px] font-medium">Follow-ups</span>
          </Link>
          <Link href="/settings" className="flex flex-col items-center gap-0.5 px-3 py-1 text-muted hover:text-foreground transition-colors">
            <Settings className="w-5 h-5" />
            <span className="text-[10px] font-medium">Settings</span>
          </Link>
        </div>
      </nav>

      {/* Quick Add Modal */}
      <QuickAdd
        organizations={organizations}
        onSubmit={async (input) => {
          await createCommitment(input);
        }}
      />

      {/* Chat Panel */}
      <CommandHubChat isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
