'use client';

import { useState, useEffect } from 'react';
import { Building2, AlertTriangle, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Organization, Commitment } from '@/types/database';

interface OrgPulse {
  org: Organization;
  openCommitments: number;
  overdueCount: number;
  nextEvent: string | null;
}

export function ClientPulse() {
  const [pulses, setPulses] = useState<OrgPulse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPulse() {
      try {
        const [orgsRes, commitmentsRes] = await Promise.all([
          fetch('/api/organizations'),
          fetch('/api/commitments?status=pending,in_progress,waiting,snoozed&limit=200'),
        ]);

        const orgs: Organization[] = await orgsRes.json();
        const commitments: Commitment[] = await commitmentsRes.json();

        const now = new Date();
        const activeOrgs = orgs.filter((o) => o.status === 'active' || o.status === 'partner');

        const result: OrgPulse[] = activeOrgs.map((org) => {
          const orgCommitments = commitments.filter((c) => c.org_id === org.id);
          const overdue = orgCommitments.filter(
            (c) => c.due_date && new Date(c.due_date) < now && c.status !== 'waiting'
          );

          return {
            org,
            openCommitments: orgCommitments.length,
            overdueCount: overdue.length,
            nextEvent: null, // Calendar events come from a different endpoint
          };
        });

        // Sort: overdue first, then by commitment count
        result.sort((a, b) => {
          if (a.overdueCount !== b.overdueCount) return b.overdueCount - a.overdueCount;
          return b.openCommitments - a.openCommitments;
        });

        setPulses(result);
      } catch (err) {
        console.error('Client pulse fetch error:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchPulse();
  }, []);

  if (loading) {
    return (
      <div>
        <h2 className="section-title mb-3">
          Client Pulse
        </h2>
        <div className="bg-card rounded-lg p-4 animate-pulse">
          <div className="h-4 bg-card-hover rounded w-2/3 mb-2" />
          <div className="h-4 bg-card-hover rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (pulses.length === 0) {
    return (
      <div>
        <h2 className="section-title mb-3">
          Client Pulse
        </h2>
        <div className="flex flex-col items-center py-6 text-center">
          <Building2 className="w-8 h-8 text-muted/30 mb-2" />
          <p className="text-sm text-muted">No active clients yet.</p>
          <p className="text-xs text-muted/60 mt-0.5">Add clients to see their pulse here.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
        Client Pulse
      </h2>
      <div className="space-y-1">
        {pulses.map((pulse) => (
          <a
            key={pulse.org.id}
            href={`/clients/${pulse.org.id}`}
            className="flex items-center gap-3 bg-card rounded-lg px-4 py-2.5 hover:bg-card-hover transition-all border border-transparent hover:border-border"
          >
            <Building2 className="w-4 h-4 text-muted flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {pulse.org.name}
              </p>
              <div className="flex items-center gap-1.5 text-xs text-muted">
                {pulse.openCommitments > 0 ? (
                  <span>{pulse.openCommitments} open</span>
                ) : (
                  <span className="text-muted/50">no open items</span>
                )}
                {pulse.nextEvent && (
                  <>
                    <span>&middot;</span>
                    <span className="flex items-center gap-0.5">
                      <Calendar className="w-3 h-3" />
                      {pulse.nextEvent}
                    </span>
                  </>
                )}
              </div>
            </div>
            {pulse.overdueCount > 0 && (
              <div className="flex items-center gap-1 text-danger flex-shrink-0">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">{pulse.overdueCount}</span>
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
