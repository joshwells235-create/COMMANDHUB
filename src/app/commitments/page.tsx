'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Zap, Filter } from 'lucide-react';
import { useCommitments } from '@/lib/hooks/use-commitments';
import { useOrganizations } from '@/lib/hooks/use-organizations';
import { CommitmentList } from '@/components/commitments/commitment-list';
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

export default function CommitmentsPage() {
  const [statusFilter, setStatusFilter] = useState('pending,in_progress');
  const [typeFilter, setTypeFilter] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');

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

  const { organizations } = useOrganizations();

  const filtered = useMemo(() => {
    if (!typeFilter) return commitments;
    return commitments.filter((c) => c.commitment_type === typeFilter);
  }, [commitments, typeFilter]);

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
              <h1 className="text-lg font-bold tracking-tight">All Commitments</h1>
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
        ) : (
          <div className="bg-card rounded-xl border border-border p-4">
            <CommitmentList
              commitments={filtered}
              title={`${STATUS_OPTIONS.find((s) => s.value === statusFilter)?.label || 'Commitments'}`}
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
