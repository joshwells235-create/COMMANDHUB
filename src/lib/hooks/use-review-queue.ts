'use client';

import { useState, useEffect, useCallback } from 'react';
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

  const acceptAll = async (emailId: string) => {
    const res = await fetch(`/api/review/${emailId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept_all' }),
    });
    if (!res.ok) throw new Error('Failed to accept all commitments');
    await fetchEmails();
  };

  const acceptSelected = async (emailId: string, indices: number[]) => {
    const res = await fetch(`/api/review/${emailId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept_selected', selected_indices: indices }),
    });
    if (!res.ok) throw new Error('Failed to accept selected commitments');
    await fetchEmails();
  };

  const dismiss = async (emailId: string) => {
    const res = await fetch(`/api/review/${emailId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss' }),
    });
    if (!res.ok) throw new Error('Failed to dismiss email');
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
