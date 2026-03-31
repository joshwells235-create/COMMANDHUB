'use client';

import Link from 'next/link';
import { AlertTriangle, Calendar, Mail, TrendingUp, Zap } from 'lucide-react';
import type { CalendarEvent, Commitment } from '@/types/database';
import { isToday } from 'date-fns';

interface DaySummaryProps {
  commitments: Commitment[];
  waitingOn: Commitment[];
  events: CalendarEvent[];
  needsReplyCount: number;
  pipelineSnapshot?: { closed: number; target: number; quarter: string } | null;
}

export function DaySummary({ commitments, waitingOn, events, needsReplyCount, pipelineSnapshot }: DaySummaryProps) {
  const now = new Date();

  // Calculate overdue by context (client / internal / personal)
  const allOverdue = commitments.filter((c) => c.due_date && new Date(c.due_date) < now && !isToday(new Date(c.due_date)));
  const clientOverdue = allOverdue.filter((c) => c.category === 'client' || (!c.category && !(c.organization as { is_own_business?: boolean } | undefined)?.is_own_business));
  const internalOverdue = allOverdue.filter((c) => c.category === 'internal').length;
  const personalOverdue = allOverdue.filter((c) => c.category === 'personal').length;
  const overdue = clientOverdue; // "overdue" = client overdue for org breakdown
  const dueToday = commitments.filter((c) => c.due_date && isToday(new Date(c.due_date)));
  const todayEvents = events.filter((e) => isToday(new Date(e.start_time)));

  // Group client overdue by org for context
  const overdueByOrg: Record<string, number> = {};
  for (const c of clientOverdue) {
    const orgName = (c.organization as { name: string } | undefined)?.name || 'Unassigned';
    overdueByOrg[orgName] = (overdueByOrg[orgName] || 0) + 1;
  }
  const topOverdueOrgs = Object.entries(overdueByOrg)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);

  // Build the summary parts
  const parts: Array<{ text: string; color: string; href?: string }> = [];

  if (overdue.length > 0) {
    const orgDetail = topOverdueOrgs.length > 0
      ? ` (${topOverdueOrgs.map(([name, count]) => `${count} ${name}`).join(', ')})`
      : '';
    parts.push({
      text: `${overdue.length} overdue${orgDetail}`,
      color: 'text-danger',
      href: '/commitments?view=overdue',
    });
  }
  if (internalOverdue > 0 || personalOverdue > 0) {
    const extras = [
      internalOverdue > 0 ? `${internalOverdue} internal` : '',
      personalOverdue > 0 ? `${personalOverdue} personal` : '',
    ].filter(Boolean).join(', ');
    parts.push({ text: extras, color: 'text-muted' });
  }

  if (dueToday.length > 0) {
    parts.push({
      text: `${dueToday.length} due today`,
      color: 'text-warning',
      href: '/commitments?view=today',
    });
  }

  if (todayEvents.length > 0) {
    parts.push({
      text: `${todayEvents.length} meeting${todayEvents.length !== 1 ? 's' : ''} today`,
      color: 'text-primary',
    });
  }

  if (needsReplyCount > 0) {
    parts.push({
      text: `${needsReplyCount} email${needsReplyCount !== 1 ? 's' : ''} need reply`,
      color: 'text-muted',
      href: '/review',
    });
  }

  if (waitingOn.length > 0) {
    parts.push({
      text: `${waitingOn.length} waiting on others`,
      color: 'text-orange-400',
      href: '/commitments?view=waiting',
    });
  }

  // Day assessment
  const urgency = overdue.length >= 3 ? 'heavy' : overdue.length > 0 || dueToday.length >= 3 ? 'busy' : todayEvents.length === 0 && dueToday.length === 0 ? 'light' : 'normal';
  const urgencyLabel = {
    heavy: { text: 'Full plate', color: 'text-danger', bg: 'bg-danger/10' },
    busy: { text: 'Busy', color: 'text-warning', bg: 'bg-warning/10' },
    normal: { text: 'Steady', color: 'text-primary', bg: 'bg-primary/10' },
    light: { text: 'Light day', color: 'text-success', bg: 'bg-success/10' },
  }[urgency];

  // Next up summary
  const nextUp = commitments[0];
  const nextUpOrg = (nextUp?.organization as { name: string } | undefined)?.name;

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="w-4 h-4 text-primary flex-shrink-0" />
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${urgencyLabel.bg} ${urgencyLabel.color}`}>
          {urgencyLabel.text}
        </span>
        {pipelineSnapshot && (
          <Link href="/analytics" className="ml-auto text-[10px] text-muted hover:text-foreground transition-colors">
            ${(pipelineSnapshot.closed / 1000).toFixed(0)}K / ${(pipelineSnapshot.target / 1000).toFixed(0)}K {pipelineSnapshot.quarter}
          </Link>
        )}
      </div>

      {/* Summary line */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
        {parts.map((part, i) => (
          <span key={i} className="flex items-center">
            {i > 0 && <span className="text-border mx-1">·</span>}
            {part.href ? (
              <Link href={part.href} className={`${part.color} hover:underline`}>{part.text}</Link>
            ) : (
              <span className={part.color}>{part.text}</span>
            )}
          </span>
        ))}
        {parts.length === 0 && (
          <span className="text-success">All clear — no urgent items</span>
        )}
      </div>

      {/* Next action */}
      {nextUp && (
        <div className="mt-2 flex items-start gap-2 text-xs text-muted">
          <TrendingUp className="w-3 h-3 mt-0.5 flex-shrink-0 text-primary" />
          <span>
            Next: <span className="text-foreground font-medium">{nextUp.title}</span>
            {nextUpOrg && <span className="text-muted"> — {nextUpOrg}</span>}
            {nextUp.due_date && isToday(new Date(nextUp.due_date)) && <span className="text-warning"> (due today)</span>}
            {nextUp.due_date && new Date(nextUp.due_date) < now && !isToday(new Date(nextUp.due_date)) && (
              <span className="text-danger"> (overdue)</span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
