'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ReviewEmail } from '@/types/database';

export function useNeedsReply() {
  const [emails, setEmails] = useState<ReviewEmail[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEmails = useCallback(async () => {
    try {
      const res = await fetch('/api/emails/needs-reply');
      if (!res.ok) throw new Error('Failed to fetch needs-reply emails');
      const data = await res.json();
      setEmails(data);
    } catch {
      // Silently fail - the section just won't show data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  return {
    emails,
    loading,
    refresh: fetchEmails,
  };
}
