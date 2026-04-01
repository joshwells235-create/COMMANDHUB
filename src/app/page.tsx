'use client';

import { useState, useMemo, useEffect } from 'react';
import { Plus, Zap, Inbox, Users, FileText, Settings, PhoneForwarded, Search, Target, User, DollarSign, ChevronDown, ChevronRight, Briefcase, BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { useCommitments } from '@/lib/hooks/use-commitments';
import { useOrganizations } from '@/lib/hooks/use-organizations';
import { useCalendarEvents } from '@/lib/hooks/use-calendar';
import { useReviewQueue } from '@/lib/hooks/use-review-queue';
import { useNeedsReply } from '@/lib/hooks/use-needs-reply';
import { ContextStrip } from '@/components/dashboard/context-strip';
import { NextUpCard } from '@/components/commitments/next-up-card';
import { CommitmentList } from '@/components/commitments/commitment-list';
import { WaitingOnList } from '@/components/commitments/waiting-on-list';
import { QuickAdd } from '@/components/commitments/quick-add';
import { TodayEvents } from '@/components/calendar/today-events';
import { NeedsReplySection } from '@/components/review/needs-reply-section';
import { CommandHubChat } from '@/components/chat/command-hub-chat';
import { ProactiveNudges } from '@/components/dashboard/proactive-nudges';
import { DaySummary } from '@/components/dashboard/day-summary';
import { ClientPulse } from '@/components/dashboard/client-pulse';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { FollowUpWidget } from '@/components/dashboard/follow-up-widget';
import { IntelligencePanel } from '@/components/dashboard/intelligence-panel';
import { CommandPalette } from '@/components/ui/command-palette';
import { KeyboardShortcuts } from '@/components/ui/keyboard-shortcuts';
import { isToday, isThisWeek } from 'date-fns';

export default function FocusView() {
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const {
    commitments,
    loading: commitmentsLoading,
    createCommitment,
    completeCommitment,
    snoozeCommitment,
    cancelCommitment,
    updateCommitment,
  } = useCommitments({ status: 'pending,in_progress', limit: 50 });

  const { commitments: waitingOn } = useCommitments({
    status: 'waiting',
    owner: 'other',
    limit: 20,
  });

  const { organizations } = useOrganizations();
  const { events, loading: calendarLoading, connected } = useCalendarEvents(undefined, 2);
  const { emails: reviewEmails } = useReviewQueue();
  const { emails: needsReplyEmails } = useNeedsReply();

  // Josh's commitments by context
  const joshCommitments = commitments.filter((c) => c.owner === 'josh');
  const nextUp = joshCommitments[0] || null;

  // Split commitments by context for separate lists
  const clientCommitments = useMemo(() =>
    joshCommitments.filter((c) => c.category === 'client' || (!c.category && c.category !== 'internal' && c.category !== 'personal')).slice(1),
    [joshCommitments]
  );
  const internalCommitments = useMemo(() =>
    joshCommitments.filter((c) => c.category === 'internal'),
    [joshCommitments]
  );

  // Compute stats by context
  const stats = useMemo(() => {
    const now = new Date();
    let clientOverdue = 0;
    let clientTotal = 0;
    let internalOverdue = 0;
    let internalTotal = 0;
    let internalDueToday = 0;
    let overdue = 0;
    let dueToday = 0;
    let thisWeek = 0;

    for (const c of commitments) {
      const isInternal = c.category === 'internal';
      const isClient = c.category === 'client' || (!c.category && c.category !== 'internal' && c.category !== 'personal');

      if (isClient) clientTotal++;
      if (isInternal) internalTotal++;

      if (!c.due_date) continue;
      const d = new Date(c.due_date);
      if (d < now && !isToday(d)) {
        overdue++;
        if (isClient) clientOverdue++;
        if (isInternal) internalOverdue++;
      } else if (isToday(d)) {
        dueToday++;
        if (isInternal) internalDueToday++;
      } else if (isThisWeek(d)) {
        thisWeek++;
      }
    }

    return {
      overdue, dueToday, thisWeek, waitingOn: waitingOn.length,
      client: { total: clientTotal, overdue: clientOverdue },
      internal: { total: internalTotal, overdue: internalOverdue, dueToday: internalDueToday },
    };
  }, [commitments, waitingOn]);

  const [completedToday, setCompletedToday] = useState(0);
  const [pipelineSnapshot, setPipelineSnapshot] = useState<{ quarter: string; closed: number; target: number; gap: number; pacePercent: number; renewals: number; renewalValue: number } | null>(null);

  useEffect(() => {
    fetch('/api/stats/trends').then(r => r.json()).then(d => { if (d?.completed) setCompletedToday(d.completed[d.completed.length - 1] || 0); }).catch(() => {});
    fetch('/api/stats/pipeline').then(r => r.json()).then(data => {
      if (data?.quarterlyPace) {
        setPipelineSnapshot({
          ...data.quarterlyPace,
          renewals: data.renewals?.upcoming60Days || 0,
          renewalValue: data.renewals?.value || 0,
        });
      }
    }).catch(() => {});
  }, []);

  const [showIntelligence, setShowIntelligence] = useState(false);

  // Compute org context for calendar events — client orgs only
  const ownBizOrgIds = useMemo(() => new Set(
    organizations.filter((o) => o.is_own_business).map((o) => o.id)
  ), [organizations]);

  const orgContext = useMemo(() => {
    const ctx: Record<string, { overdueCount: number; openCount: number }> = {};
    const now = new Date();
    for (const c of commitments) {
      if (!c.org_id || ownBizOrgIds.has(c.org_id)) continue;
      if (!ctx[c.org_id]) ctx[c.org_id] = { overdueCount: 0, openCount: 0 };
      ctx[c.org_id].openCount++;
      if (c.due_date && new Date(c.due_date) < now && !isToday(new Date(c.due_date))) {
        ctx[c.org_id].overdueCount++;
      }
    }
    return ctx;
  }, [commitments, ownBizOrgIds]);

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
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl header-gradient-border">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2 flex-shrink-0">
            <Zap className="w-5 h-5 text-primary pulse-alive" />
            <h1 className="text-lg font-semibold tracking-tight hidden sm:block text-gradient">COMMAND HUB</h1>
          </div>

          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="flex-1 flex items-center gap-2 glass rounded-lg px-3 py-2 hover:border-primary/30 group max-w-md mx-auto"
          >
            <Search className="w-4 h-4 text-muted group-hover:text-primary transition-colors" />
            <span className="text-sm text-muted group-hover:text-foreground transition-colors">
              Search or type a command...
            </span>
            <kbd className="hidden sm:inline-flex ml-auto items-center gap-0.5 px-1.5 py-0.5 bg-background border border-border rounded text-[10px] text-muted">
              ⌘K
            </kbd>
          </button>

          <div className="flex items-center gap-2 flex-shrink-0">
            <nav className="hidden lg:flex items-center gap-1 mr-2">
              <Link href="/clients" className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-muted hover:text-foreground transition-colors rounded-md hover:bg-card">
                <Users className="w-4 h-4" />
                Clients
              </Link>
              <Link href="/contacts" className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-muted hover:text-foreground transition-colors rounded-md hover:bg-card">
                <User className="w-4 h-4" />
                People
              </Link>
              <Link href="/transcripts" className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-muted hover:text-foreground transition-colors rounded-md hover:bg-card">
                <FileText className="w-4 h-4" />
                Transcripts
              </Link>
              <Link href="/follow-ups" className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-muted hover:text-foreground transition-colors rounded-md hover:bg-card">
                <PhoneForwarded className="w-4 h-4" />
                Follow-ups
              </Link>
              <Link href="/commitments" className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-muted hover:text-foreground transition-colors rounded-md hover:bg-card">
                <Target className="w-4 h-4" />
                Commitments
              </Link>
              <Link href="/analytics" className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-muted hover:text-foreground transition-colors rounded-md hover:bg-card">
                <BarChart3 className="w-4 h-4" />
                Analytics
              </Link>
            </nav>
            {reviewEmails.length > 0 && (
              <Link
                href="/review"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-warning/20 text-warning rounded-lg text-sm font-medium hover:bg-warning/30 transition-colors"
              >
                <Inbox className="w-4 h-4" />
                <span>{reviewEmails.length}</span>
              </Link>
            )}
            <button
              onClick={() => setShowQuickAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white btn-gradient"
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
      <main className="max-w-7xl mx-auto px-4 py-4 animate-fade-in">

        {/* ═══════════ MOBILE LAYOUT ═══════════ */}
        <div className="lg:hidden space-y-3 stagger-children">
          {/* 1. Day Summary */}
          <DaySummary
            commitments={joshCommitments}
            waitingOn={waitingOn}
            events={events}
            needsReplyCount={needsReplyEmails.length}
            completedToday={completedToday}
            pipelineSnapshot={pipelineSnapshot}
          />

          {/* 2. Three Worlds — Practice / Internal / Life */}
          <ContextStrip
            internalStats={stats.internal}
            clientStats={stats.client}
          />

          {/* 3. Next Up — the ONE thing to focus on */}
          <div className="bg-card rounded-xl border border-border next-up-border p-4 relative animated-gradient-border">
            <NextUpCard
              commitment={nextUp}
              onComplete={async (id) => { await completeCommitment(id); }}
              onSnooze={async (id, date) => { await snoozeCommitment(id, date); }}
              onCancel={async (id) => { await cancelCommitment(id); }}
              onUpdate={async (id, updates) => { await updateCommitment(id, updates); }}
            />
          </div>

          {/* 4. Proactive Nudges */}
          <ProactiveNudges />

          {/* 5. Today & Tomorrow */}
          <div className="bg-card rounded-xl border border-border p-4">
            <TodayEvents events={events} connected={connected} loading={calendarLoading} orgContext={orgContext} />
          </div>

          {/* 6. Client Commitments */}
          <div className="bg-card rounded-xl border border-border p-4">
            <CommitmentList
              commitments={clientCommitments.slice(0, 5)}
              title="Client Focus"
              emptyMessage="No client commitments in queue."
              onComplete={completeCommitment}
              onSnooze={snoozeCommitment}
              onCancel={cancelCommitment}
              onUpdate={updateCommitment}
              sortable
            />
            {clientCommitments.length > 5 && (
              <Link href="/commitments?category=client" className="block text-center text-xs text-primary hover:underline mt-2">
                View all {clientCommitments.length} client items
              </Link>
            )}
          </div>

          {/* 7. Internal Tasks */}
          {internalCommitments.length > 0 && (
            <div className="bg-card rounded-xl border border-violet-500/20 p-4">
              <CommitmentList
                commitments={internalCommitments.slice(0, 3)}
                title="Internal Tasks"
                emptyMessage="No internal tasks."
                onComplete={completeCommitment}
                onSnooze={snoozeCommitment}
                onCancel={cancelCommitment}
                onUpdate={updateCommitment}
              />
              {internalCommitments.length > 3 && (
                <Link href="/commitments?category=internal" className="block text-center text-xs text-violet-400 hover:underline mt-2">
                  View all {internalCommitments.length} internal items
                </Link>
              )}
            </div>
          )}

          {/* 8. Needs Reply */}
          <div className="bg-card rounded-xl border border-border p-4">
            <NeedsReplySection emails={needsReplyEmails.slice(0, 3)} />
            {needsReplyEmails.length > 3 && (
              <Link href="/review" className="block text-center text-xs text-primary hover:underline mt-2">
                View all {needsReplyEmails.length} emails
              </Link>
            )}
          </div>

          {/* 9. Waiting On */}
          <div className="bg-card rounded-xl border border-border p-4">
            <WaitingOnList commitments={waitingOn.slice(0, 3)} onReceived={completeCommitment} />
            {waitingOn.length > 3 && (
              <Link href="/commitments?view=waiting" className="block text-center text-xs text-primary hover:underline mt-2">
                View all {waitingOn.length} waiting items
              </Link>
            )}
          </div>

          {/* 10. Intelligence (collapsible) */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <button
              onClick={() => setShowIntelligence(!showIntelligence)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-card-hover transition-colors"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">Intelligence</span>
              {showIntelligence ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
            </button>
            {showIntelligence && (
              <div className="px-4 pb-4 space-y-4">
                <FollowUpWidget />
                <IntelligencePanel />
                <ClientPulse />
                <ActivityFeed limit={5} />
              </div>
            )}
          </div>
        </div>

        {/* ═══════════ DESKTOP LAYOUT ═══════════ */}
        <div className="hidden lg:block space-y-4">
          {/* Row 1: Day Summary (full width) */}
          <DaySummary
            commitments={joshCommitments}
            waitingOn={waitingOn}
            events={events}
            needsReplyCount={needsReplyEmails.length}
            completedToday={completedToday}
            pipelineSnapshot={pipelineSnapshot}
          />

          {/* Row 2: Three Worlds context strip */}
          <ContextStrip
            internalStats={stats.internal}
            clientStats={stats.client}
          />

          {/* Row 3: Two-column grid */}
          <div className="grid lg:grid-cols-5 gap-4">

            {/* ── Left column: Your Day ── */}
            <div className="lg:col-span-3 space-y-4">

              {/* Next Up — the ONE thing */}
              <div className="bg-card rounded-xl border border-border next-up-border p-4 relative animated-gradient-border">
                <NextUpCard
                  commitment={nextUp}
                  onComplete={async (id) => { await completeCommitment(id); }}
                  onSnooze={async (id, date) => { await snoozeCommitment(id, date); }}
                  onCancel={async (id) => { await cancelCommitment(id); }}
                  onUpdate={async (id, updates) => { await updateCommitment(id, updates); }}
                />
              </div>

              {/* Proactive Nudges */}
              <ProactiveNudges />

              {/* Today & Tomorrow */}
              <div className="bg-card rounded-xl border border-border p-4">
                <TodayEvents events={events} connected={connected} loading={calendarLoading} orgContext={orgContext} />
              </div>

              {/* Client Focus — client commitments only */}
              <div className="bg-card rounded-xl border border-border p-4">
                <CommitmentList
                  commitments={clientCommitments.slice(0, 5)}
                  title="Client Focus"
                  emptyMessage="No client commitments in queue."
                  onComplete={completeCommitment}
                  onSnooze={snoozeCommitment}
                  onCancel={cancelCommitment}
                  onUpdate={updateCommitment}
                  sortable
                />
                {clientCommitments.length > 5 && (
                  <Link href="/commitments?category=client" className="block text-center text-xs text-primary hover:underline mt-2">
                    View all {clientCommitments.length} client items
                  </Link>
                )}
              </div>

              {/* Internal Tasks — violet accent */}
              {internalCommitments.length > 0 && (
                <div className="bg-card rounded-xl border border-violet-500/20 p-4">
                  <CommitmentList
                    commitments={internalCommitments.slice(0, 3)}
                    title="Internal Tasks"
                    emptyMessage="No internal tasks."
                    onComplete={completeCommitment}
                    onSnooze={snoozeCommitment}
                    onCancel={cancelCommitment}
                    onUpdate={updateCommitment}
                  />
                  {internalCommitments.length > 3 && (
                    <Link href="/commitments?category=internal" className="block text-center text-xs text-violet-400 hover:underline mt-2">
                      View all {internalCommitments.length} internal items
                    </Link>
                  )}
                </div>
              )}

              {/* Needs Reply */}
              <div className="bg-card rounded-xl border border-border p-4">
                <NeedsReplySection emails={needsReplyEmails} />
              </div>
            </div>

            {/* ── Right column: Context & Intelligence ── */}
            <div className="lg:col-span-2 space-y-4">

              {/* Stats strip */}
              <div className="grid grid-cols-4 gap-2">
                <Link href="/commitments?view=overdue" className="glass rounded-xl p-2 text-center hover:border-border-hover transition-all">
                  <p className="text-xl font-bold text-danger">{stats.overdue}</p>
                  <p className="text-[10px] text-muted">Overdue</p>
                </Link>
                <Link href="/commitments?view=today" className="glass rounded-xl p-2 text-center hover:border-border-hover transition-all">
                  <p className="text-xl font-bold text-warning">{stats.dueToday}</p>
                  <p className="text-[10px] text-muted">Due Today</p>
                </Link>
                <Link href="/commitments?view=week" className="glass rounded-xl p-2 text-center hover:border-border-hover transition-all">
                  <p className="text-xl font-bold text-primary">{stats.thisWeek}</p>
                  <p className="text-[10px] text-muted">This Week</p>
                </Link>
                <Link href="/commitments?view=waiting" className="glass rounded-xl p-2 text-center hover:border-border-hover transition-all">
                  <p className="text-xl font-bold text-orange-400">{stats.waitingOn}</p>
                  <p className="text-[10px] text-muted">Waiting On</p>
                </Link>
              </div>

              {/* Waiting On */}
              <div className="bg-card rounded-xl border border-border p-4">
                <WaitingOnList commitments={waitingOn} onReceived={completeCommitment} />
              </div>

              {/* Follow-up Queue */}
              <div className="bg-card rounded-xl border border-border p-4">
                <FollowUpWidget />
              </div>

              {/* Revenue Pace */}
              {pipelineSnapshot && (
                <Link href="/analytics" className="bg-card rounded-xl border border-border p-3 block hover:border-border-hover transition-all">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-3.5 h-3.5 text-violet-400" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Revenue Pace</span>
                    </div>
                    <span className="text-sm font-bold">${(pipelineSnapshot.closed / 1000).toFixed(0)}K<span className="text-muted font-normal text-xs"> / ${(pipelineSnapshot.target / 1000).toFixed(0)}K</span></span>
                  </div>
                  <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${pipelineSnapshot.pacePercent >= 80 ? 'bg-success' : pipelineSnapshot.pacePercent >= 50 ? 'bg-warning' : 'bg-danger'}`}
                      style={{ width: `${Math.min(100, pipelineSnapshot.pacePercent)}%` }}
                    />
                  </div>
                </Link>
              )}

              {/* Deep Intelligence (collapsible) */}
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <button
                  onClick={() => setShowIntelligence(!showIntelligence)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-card-hover transition-colors"
                >
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">Deep Intelligence</span>
                  {showIntelligence ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
                </button>
                {showIntelligence && (
                  <div className="px-4 pb-4 space-y-4">
                    <IntelligencePanel />
                    <ClientPulse />
                    <ActivityFeed limit={5} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Mobile Footer */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-background/80 backdrop-blur-2xl header-gradient-border" style={{ borderBottom: 'none' }}>
        <div className="flex items-center justify-around py-2 px-4">
          <Link href="/clients" className="flex flex-col items-center gap-0.5 px-3 py-1 text-muted hover:text-foreground transition-colors">
            <Users className="w-5 h-5" />
            <span className="text-[10px] font-medium">Clients</span>
          </Link>
          <Link href="/contacts" className="flex flex-col items-center gap-0.5 px-3 py-1 text-muted hover:text-foreground transition-colors">
            <User className="w-5 h-5" />
            <span className="text-[10px] font-medium">People</span>
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
        isOpen={showQuickAdd}
        onClose={() => setShowQuickAdd(false)}
        onSubmit={async (input) => {
          await createCommitment(input);
        }}
      />

      {/* Chat Panel */}
      <CommandHubChat isOpen={chatOpen} onClose={() => setChatOpen(false)} />

      {/* Command Palette */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        organizations={organizations}
        onOpenChat={() => setChatOpen(true)}
        onOpenQuickAdd={() => setShowQuickAdd(true)}
      />
      <CmdKListener onOpen={() => setCommandPaletteOpen(true)} />
      <KeyboardShortcuts
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onOpenQuickAdd={() => setShowQuickAdd(true)}
        onOpenChat={() => setChatOpen(true)}
      />
    </div>
  );
}

function CmdKListener({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpen();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpen]);
  return null;
}
