'use client';

import { useState, useEffect } from 'react';
import type { CalendarEvent } from '@/types/database';

export function useCalendarEvents(date?: string, days?: number) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (days) params.set('days', String(days));

    fetch(`/api/calendar?${params}`)
      .then(async (res) => {
        if (res.status === 401) {
          setConnected(false);
          return [];
        }
        setConnected(true);
        if (!res.ok) return [];
        return res.json();
      })
      .then(setEvents)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [date, days]);

  return { events, loading, connected };
}
