'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import type { Commitment, CommitmentCreateInput } from '@/types/database';

interface UseCommitmentsOptions {
  status?: string;
  org_id?: string;
  owner?: string;
  category?: string;
  limit?: number;
}

export function useCommitments(options: UseCommitmentsOptions = {}) {
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCommitments = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (options.status) params.set('status', options.status);
      if (options.org_id) params.set('org_id', options.org_id);
      if (options.owner) params.set('owner', options.owner);
      if (options.category) params.set('category', options.category);
      if (options.limit) params.set('limit', String(options.limit));

      const res = await fetch(`/api/commitments?${params}`);
      if (!res.ok) throw new Error('Failed to fetch commitments');
      const data = await res.json();
      setCommitments(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [options.status, options.org_id, options.owner, options.category, options.limit]);

  useEffect(() => {
    fetchCommitments();
  }, [fetchCommitments]);

  const createCommitment = async (input: CommitmentCreateInput) => {
    const res = await fetch('/api/commitments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) { toast.error('Failed to create commitment'); throw new Error('Failed to create commitment'); }
    const data = await res.json();
    toast.success('Commitment created');
    await fetchCommitments();
    return data;
  };

  const completeCommitment = async (id: string) => {
    const res = await fetch(`/api/commitments/${id}/complete`, {
      method: 'POST',
    });
    if (!res.ok) { toast.error('Failed to complete'); throw new Error('Failed to complete commitment'); }
    toast.success('Marked as done');
    await fetchCommitments();
  };

  const snoozeCommitment = async (id: string, snoozedUntil: string) => {
    const res = await fetch(`/api/commitments/${id}/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snoozed_until: snoozedUntil }),
    });
    if (!res.ok) { toast.error('Failed to snooze'); throw new Error('Failed to snooze commitment'); }
    toast.success('Snoozed');
    await fetchCommitments();
  };

  const cancelCommitment = async (id: string) => {
    const res = await fetch(`/api/commitments/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) { toast.error('Failed to cancel'); throw new Error('Failed to cancel commitment'); }
    toast.success('Cancelled');
    await fetchCommitments();
  };

  const updateCommitment = async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch(`/api/commitments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) { toast.error('Failed to update'); throw new Error('Failed to update commitment'); }
    toast.success('Commitment updated');
    await fetchCommitments();
  };

  return {
    commitments,
    loading,
    error,
    refresh: fetchCommitments,
    createCommitment,
    completeCommitment,
    snoozeCommitment,
    cancelCommitment,
    updateCommitment,
  };
}
