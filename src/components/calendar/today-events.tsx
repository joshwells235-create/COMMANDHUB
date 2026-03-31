'use client';

import { Calendar, MapPin, AlertTriangle, ExternalLink, Zap, FileText, CircleAlert } from 'lucide-react';
import Link from 'next/link';
import type { CalendarEvent } from '@/types/database';
import { formatEventTime } from '@/lib/utils';
import { format, isToday, isTomorrow } from 'date-fns';

const EVENT_TYPE_LABELS: Record<string, string> = {
  coaching_session: 'Coaching',
  workshop: 'Workshop',
  pi_session: 'PI Session',
  client_meeting: 'Meeting',
  internal_leadshift: 'Internal',
  vistage: 'Vistage',
  personal: 'Personal',
};

interface OrgContext {
  overdueCount: number;
  openCount: number;
}

interface TodayEventsProps {
  events: CalendarEvent[];
  connected: boolean;
  loading: boolean;
  orgContext?: Record<string, OrgContext>;
}

function EventCard({ event, context }: { event: CalendarEvent; context?: OrgContext }) {
  const prepNotes = event.ai_analysis?.prep_notes;
  const eventType = event.ai_analysis?.event_type as string | undefined;
  const importance = event.ai_analysis?.importance as string | undefined;
  const eventTypeLabel = eventType ? EVENT_TYPE_LABELS[eventType] : undefined;
  const isHighImportance = importance === 'high';
  const isPrepWorthy = eventType && !['personal'].includes(eventType);

  return (
    <div className={`px-4 py-3${isHighImportance ? ' ring-1 ring-primary/30 bg-primary/5 rounded-lg' : ''}`}>
      <div className="flex items-start gap-3">
        <span className="text-xs text-muted font-mono mt-0.5 flex-shrink-0 w-16">
          {formatEventTime(event.start_time)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium leading-tight">{event.subject}</p>
            {eventTypeLabel && (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium bg-primary/20 text-primary">
                {eventTypeLabel}
              </span>
            )}
          </div>
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
              <FileText className="w-3 h-3 text-muted mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted/80">{prepNotes}</p>
            </div>
          )}
          {/* Client context line */}
          {event.org_id && context && (context.overdueCount > 0 || context.openCount > 0) && (
            <div className="mt-1.5 flex items-center gap-2 text-[10px]">
              {context.overdueCount > 0 && (
                <span className="text-danger flex items-center gap-0.5">
                  <CircleAlert className="w-3 h-3" />
                  {context.overdueCount} overdue
                </span>
              )}
              {context.openCount > 0 && context.overdueCount === 0 && (
                <span className="text-muted">{context.openCount} open items</span>
              )}
            </div>
          )}
          {event.org_id && isPrepWorthy && (
            <Link
              href={`/prep/${event.org_id}`}
              className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/20 hover:border-amber-500/30 transition-colors"
            >
              <Zap className="w-3 h-3" />
              Prep
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export function TodayEvents({ events, connected, loading, orgContext }: TodayEventsProps) {
  const today = format(new Date(), 'EEEE, MMM d');

  if (loading) {
    return (
      <div>
        <h2 className="section-title mb-3">Today &amp; Tomorrow</h2>
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
        <h2 className="section-title mb-3">Today &amp; Tomorrow</h2>
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

  // Split events into today and tomorrow
  const todayEvents = events.filter((e) => isToday(new Date(e.start_time)));
  const tomorrowEvents = events.filter((e) => isTomorrow(new Date(e.start_time)));
  const tomorrow = format(new Date(Date.now() + 86400000), 'EEEE, MMM d');

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
        Today &amp; Tomorrow
      </h2>

      {/* Today */}
      <div className="mb-2">
        <p className="text-xs text-muted/60 uppercase tracking-wider mb-1.5 px-1">Today — {today}</p>
        {todayEvents.length === 0 ? (
          <div className="flex items-center gap-2 py-3 px-1">
            <Zap className="w-4 h-4 text-primary/40" />
            <p className="text-xs text-muted">No events today — deep work time.</p>
          </div>
        ) : (
          <div className="bg-card rounded-lg divide-y divide-border overflow-hidden">
            {todayEvents.map((event) => (
              <EventCard key={event.id} event={event} context={event.org_id ? orgContext?.[event.org_id] : undefined} />
            ))}
          </div>
        )}
      </div>

      {/* Tomorrow */}
      <div>
        <p className="text-xs text-muted/60 uppercase tracking-wider mb-1.5 px-1">Tomorrow — {tomorrow}</p>
        {tomorrowEvents.length === 0 ? (
          <div className="flex items-center gap-2 py-2 px-1">
            <Calendar className="w-4 h-4 text-muted/30" />
            <p className="text-xs text-muted/60">Nothing scheduled.</p>
          </div>
        ) : (
          <div className="bg-card rounded-lg divide-y divide-border overflow-hidden opacity-80">
            {tomorrowEvents.map((event) => (
              <EventCard key={event.id} event={event} context={event.org_id ? orgContext?.[event.org_id] : undefined} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
