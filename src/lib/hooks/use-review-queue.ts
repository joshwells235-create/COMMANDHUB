'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import type { ReviewEmail } from '@/types/database';

export function useReviewQueue() {
  const [emails, setEmails] = useState<ReviewEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEmails = useCallback(async () => {
    try {
      const res = await fetch('/api/review');
      if (!res.ok) throw new Error('Failed to fetch review queue');
      const data = await res.json();
      setEmails(data.emails || data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const acceptAll = async (emailId: string, edits?: Record<number, { title?: string; commitment_type?: string; suggested_due?: string | null }>) => {
    const res = await fetch(`/api/review/${emailId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept_all', edits }),
    });
    if (!res.ok) { toast.error('Failed to accept commitments'); throw new Error('Failed to accept'); }
    toast.success('Commitments accepted');
    await fetchEmails();
  };

  const acceptSelected = async (emailId: string, indices: number[], edits?: Record<number, { title?: string; commitment_type?: string; suggested_due?: string | null }>) => {
    const res = await fetch(`/api/review/${emailId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept_selected', selected_indices: indices, edits }),
    });
    if (!res.ok) { toast.error('Failed to accept selected'); throw new Error('Failed to accept'); }
    toast.success(`${indices.length} commitment${indices.length !== 1 ? 's' : ''} accepted`);
    await fetchEmails();
  };

  const dismiss = async (emailId: string) => {
    const res = await fetch(`/api/review/${emailId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss' }),
    });
    if (!res.ok) { toast.error('Failed to dismiss'); throw new Error('Failed to dismiss'); }
    toast.success('Email dismissed');
    await fetchEmails();
  };

  return {
    emails,
    loading,
    error,
    refresh: fetchEmails,
    acceptAll,
    acceptSelected,
    dismiss,
  };
}
