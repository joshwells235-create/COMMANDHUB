'use client';

import { Calendar, MapPin, AlertTriangle, ExternalLink } from 'lucide-react';
import type { CalendarEvent } from '@/types/database';
import { formatEventTime } from '@/lib/utils';
import { format } from 'date-fns';

interface TodayEventsProps {
  events: CalendarEvent[];
  connected: boolean;
  loading: boolean;
}

export function TodayEvents({ events, connected, loading }: TodayEventsProps) {
  const today = format(new Date(), 'EEEE, MMM d');

  if (loading) {
    return (
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          Today ({today})
        </h2>
        <div className="bg-card rounded-lg p-4 animate-pulse">
          <div className="h-4 bg-background rounded w-3/4 mb-2" />
          <div className="h-4 bg-background rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          Today ({today})
        </h2>
        <a
          href="/api/auth/microsoft"
          className="block bg-card rounded-lg p-4 border border-dashed border-border hover:border-primary transition-colors"
        >
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-muted" />
            <div>
              <p className="text-sm font-medium">Connect Outlook Calendar</p>
              <p className="text-xs text-muted">See your schedule right here</p>
            </div>
            <ExternalLink className="w-4 h-4 text-muted ml-auto" />
          </div>
        </a>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
        Today ({today})
      </h2>

      {events.length === 0 ? (
        <div className="bg-card rounded-lg p-4">
          <p className="text-sm text-muted">No events today. Focus time.</p>
        </div>
      ) : (
        <div className="bg-card rounded-lg divide-y divide-border overflow-hidden">
          {events.map((event) => {
            const prepNotes = event.ai_analysis?.prep_notes;
            return (
              <div key={event.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="text-xs text-muted font-mono mt-0.5 flex-shrink-0 w-16">
                    {formatEventTime(event.start_time)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">{event.subject}</p>
                    {event.organization && (
                      <span className="text-xs text-primary">{event.organization.name}</span>
                    )}
                    {event.location && (
                      <div className="flex items-center gap-1 mt-1">
                        <MapPin className="w-3 h-3 text-muted" />
                        <span className="text-xs text-muted truncate">{event.location}</span>
                      </div>
                    )}
                    {prepNotes && (
                      <div className="mt-2 flex items-start gap-1.5">
                        <AlertTriangle className="w-3 h-3 text-warning mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-warning/80">{prepNotes}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
