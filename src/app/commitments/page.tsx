'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Zap, Filter, X } from 'lucide-react';
import { useCommitments } from '@/lib/hooks/use-commitments';
import { useOrganizations } from '@/lib/hooks/use-organizations';
import { CommitmentList } from '@/components/commitments/commitment-list';
import { WaitingOnList } from '@/components/commitments/waiting-on-list';
import { isToday, isThisWeek } from 'date-fns';
import type { CommitmentType, CommitmentStatus } from '@/types/database';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'pending,in_progress', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'snoozed', label: 'Snoozed' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Types' },
  { value: 'promise_made', label: 'Promise Made' },
  { value: 'ask_received', label: 'Ask Received' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'waiting_on', label: 'Waiting On' },
  { value: 'deliverable', label: 'Deliverable' },
  { value: 'prep', label: 'Prep' },
  { value: 'internal', label: 'Internal' },
  { value: 'note_to_self', label: 'Note to Self' },
];

const VIEW_LABELS: Record<string, string> = {
  overdue: 'Overdue',
  today: 'Due Today',
  week: 'This Week',
  waiting: 'Waiting On',
};

export default function CommitmentsPage() {
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view') || '';

  // Set initial filters based on view param
  const [statusFilter, setStatusFilter] = useState(() => {
    if (viewParam === 'waiting') return 'waiting';
    return 'pending,in_progress';
  });
  const [typeFilter, setTypeFilter] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState(() => {
    if (viewParam === 'waiting') return 'other';
    return '';
  });
  const [activeView, setActiveView] = useState(viewParam);

  const {
    commitments,
    loading,
    completeCommitment,
    snoozeCommitment,
    cancelCommitment,
    updateCommitment,
  } = useCommitments({
    status: statusFilter,
    org_id: orgFilter || undefined,
    owner: ownerFilter || undefined,
    limit: 200,
  });

  const { commitments: waitingCommitments, completeCommitment: completeWaiting } = useCommitments({
    status: 'waiting',
    owner: 'other',
    limit: 200,
  });

  const { organizations } = useOrganizations();

  const filtered = useMemo(() => {
    let result = commitments;

    // Apply type filter
    if (typeFilter) {
      result = result.filter((c) => c.commitment_type === typeFilter);
    }

    // Apply date-based view filter
    if (activeView === 'overdue') {
      const now = new Date();
      result = result.filter((c) => {
        if (!c.due_date) return false;
        const d = new Date(c.due_date);
        return d < now && !isToday(d);
      });
    } else if (activeView === 'today') {
      result = result.filter((c) => {
        if (!c.due_date) return false;
        return isToday(new Date(c.due_date));
      });
    } else if (activeView === 'week') {
      const now = new Date();
      result = result.filter((c) => {
        if (!c.due_date) return false;
        const d = new Date(c.due_date);
        return isThisWeek(d) && !isToday(d) && d >= now;
      });
    }

    return result;
  }, [commitments, typeFilter, activeView]);

  const clearView = () => {
    setActiveView('');
    setStatusFilter('pending,in_progress');
    setOwnerFilter('');
    window.history.replaceState(null, '', '/commitments');
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl header-gradient-border">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-muted hover:text-foreground transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-bold tracking-tight">
                {activeView && VIEW_LABELS[activeView] ? VIEW_LABELS[activeView] : 'All Commitments'}
              </h1>
              {activeView && (
                <button
                  onClick={clearView}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs bg-primary/20 text-primary rounded-full hover:bg-primary/30 transition-colors"
                >
                  Filtered
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-4 space-y-4 animate-fade-in">
        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="w-4 h-4 text-muted" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-card border border-border rounded-lg px-2.5 py-1.5 text-sm"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-card border border-border rounded-lg px-2.5 py-1.5 text-sm"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className="bg-card border border-border rounded-lg px-2.5 py-1.5 text-sm"
          >
            <option value="">All Clients</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="bg-card border border-border rounded-lg px-2.5 py-1.5 text-sm"
          >
            <option value="">All Owners</option>
            <option value="josh">Josh</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* Results */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted gap-2">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Loading...
          </div>
        ) : activeView === 'waiting' ? (
          <div className="bg-card rounded-xl border border-border p-4">
            <WaitingOnList commitments={waitingCommitments} onReceived={completeWaiting} />
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border p-4">
            <CommitmentList
              commitments={filtered}
              title={activeView && VIEW_LABELS[activeView] ? VIEW_LABELS[activeView] : (STATUS_OPTIONS.find((s) => s.value === statusFilter)?.label || 'Commitments')}
              emptyMessage="No commitments match these filters."
              onComplete={completeCommitment}
              onSnooze={snoozeCommitment}
              onCancel={cancelCommitment}
              onUpdate={updateCommitment}
              showActions={!['completed', 'cancelled'].includes(statusFilter)}
            />
          </div>
        )}
      </main>
    </div>
  );
}
