'use client';

import { useState, useEffect } from 'react';
import { HeartPulse, AlertTriangle, Users, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OrgHealth {
  org_id: string;
  org_name: string;
  strategic_value: 'strategic' | 'standard' | 'emerging';
  score: number;
  status: 'thriving' | 'healthy' | 'cooling' | 'at_risk';
  days_since_contact: number;
  overdue_count: number;
  completion_rate: number;
  trend: 'improving' | 'stable' | 'declining';
  alert: string | null;
}

const statusDotColor: Record<OrgHealth['status'], string> = {
  thriving: 'bg-success',
  healthy: 'bg-success',
  cooling: 'bg-warning',
  at_risk: 'bg-danger',
};

const strategicValueLabel: Record<OrgHealth['strategic_value'], string> = {
  strategic: 'Strategic',
  standard: 'Standard',
  emerging: 'Emerging',
};

const strategicValueStyle: Record<OrgHealth['strategic_value'], string> = {
  strategic: 'bg-danger/20 text-danger border-danger/30',
  standard: 'bg-muted/20 text-muted border-border/50',
  emerging: 'bg-warning/20 text-warning border-warning/30',
};

export function RelationshipHealth() {
  const [healthData, setHealthData] = useState<OrgHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchHealth() {
      try {
        const res = await fetch('/api/ai/relationship-health');
        if (!res.ok) throw new Error('Failed to fetch');
        const data: OrgHealth[] = await res.json();
        setHealthData(data);
      } catch (err) {
        console.error('Relationship health fetch error:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchHealth();
  }, []);

  if (loading) {
    return (
      <div>
        <h2 className="section-title mb-3">
          Relationship Health
        </h2>
        <div className="bg-card rounded-lg p-4 animate-pulse">
          <div className="h-4 bg-card-hover rounded w-2/3 mb-2" />
          <div className="h-4 bg-card-hover rounded w-1/2" />
        </div>
      </div>
    );
  }

  // Dark clients: no contact in 14+ days (excluding -1 which means "no sessions ever" — those show separately)
  const darkClients = healthData
    .filter((h) => h.days_since_contact >= 14)
    .sort((a, b) => {
      // Sort by strategic value first (strategic > emerging > standard)
      const valueOrder: Record<string, number> = { strategic: 0, emerging: 1, standard: 2 };
      const valueDiff = (valueOrder[a.strategic_value] ?? 2) - (valueOrder[b.strategic_value] ?? 2);
      if (valueDiff !== 0) return valueDiff;
      // Then by days since contact (most days first)
      return b.days_since_contact - a.days_since_contact;
    });

  // Only show orgs that need attention (cooling or at_risk) and are NOT already in darkClients
  const darkClientIds = new Set(darkClients.map((h) => h.org_id));
  const needsAttention = healthData.filter(
    (h) => (h.status === 'cooling' || h.status === 'at_risk') && !darkClientIds.has(h.org_id)
  );

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
        Relationship Health
      </h2>

      {/* Going Dark Section */}
      {darkClients.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-danger" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-danger">
              Going Dark
            </h3>
            <span className="text-xs text-danger/70 font-medium">
              {darkClients.length} client{darkClients.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-1">
            {darkClients.map((h) => {
              const isCritical = h.days_since_contact > 21;
              return (
                <div
                  key={h.org_id}
                  className={cn(
                    'bg-card/50 rounded-lg border px-4 py-3 backdrop-blur-sm',
                    isCritical
                      ? 'border-danger/40'
                      : 'border-warning/30'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {/* Pulsing indicator for critical (>21 days) */}
                    <span
                      className={cn(
                        'w-2.5 h-2.5 rounded-full flex-shrink-0',
                        isCritical
                          ? 'bg-danger animate-pulse'
                          : 'bg-warning'
                      )}
                    />

                    {/* Client info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={cn(
                          'text-sm font-medium truncate',
                          isCritical ? 'text-danger' : 'text-warning'
                        )}>
                          {h.org_name}
                        </p>
                        <span className={cn(
                          'text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border flex-shrink-0',
                          strategicValueStyle[h.strategic_value]
                        )}>
                          {strategicValueLabel[h.strategic_value]}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3 text-muted" />
                        <span className="text-xs text-muted">
                          {h.alert || `No contact in ${h.days_since_contact} days`}
                        </span>
                      </div>
                    </div>

                    {/* Days since contact — prominent */}
                    <div className={cn(
                      'flex-shrink-0 text-right tabular-nums',
                      isCritical ? 'text-danger' : 'text-warning'
                    )}>
                      <p className="text-lg font-bold leading-none">
                        {h.days_since_contact}
                      </p>
                      <p className="text-[10px] text-muted">days</p>
                    </div>

                    {/* Send check-in button */}
                    <a
                      href={`/clients/${h.org_id}`}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all flex-shrink-0',
                        isCritical
                          ? 'bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30'
                          : 'bg-warning/15 text-warning hover:bg-warning/25 border border-warning/30'
                      )}
                    >
                      <Users className="w-3 h-3" />
                      Send check-in
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Regular needs-attention section */}
      {needsAttention.length === 0 && darkClients.length === 0 ? (
        <div className="bg-card rounded-lg border border-border/50 p-4">
          <div className="flex items-center gap-2 text-success">
            <HeartPulse className="w-4 h-4" />
            <span className="text-sm font-medium">All clients healthy</span>
          </div>
          <p className="text-xs text-muted mt-1">
            No relationships need attention right now.
          </p>
        </div>
      ) : (
        <>
          {needsAttention.length > 0 && (
            <div className="space-y-1">
              {needsAttention.map((h) => (
                <a
                  key={h.org_id}
                  href={`/clients/${h.org_id}`}
                  className="flex items-center gap-3 bg-card rounded-lg px-4 py-2.5 hover:bg-card-hover transition-all border border-transparent hover:border-border"
                >
                  {/* Status dot */}
                  <span
                    className={cn(
                      'w-2.5 h-2.5 rounded-full flex-shrink-0',
                      statusDotColor[h.status]
                    )}
                  />

                  {/* Org info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground truncate">
                        {h.org_name}
                      </p>
                      <span className="text-xs font-semibold text-muted tabular-nums">
                        {h.score}
                      </span>
                    </div>
                    {h.alert && (
                      <p className="text-xs text-muted truncate">{h.alert}</p>
                    )}
                  </div>

                  {/* Days since contact */}
                  <div className="flex-shrink-0 text-right">
                    <p className={cn(
                      'text-xs font-medium',
                      h.days_since_contact > 21 ? 'text-danger' : 'text-muted'
                    )}>
                      {h.days_since_contact === -1
                        ? 'No sessions'
                        : `${h.days_since_contact}d ago`}
                    </p>
                  </div>

                  {/* Overdue indicator */}
                  {h.overdue_count > 0 && (
                    <div className="flex items-center gap-1 text-danger flex-shrink-0">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span className="text-xs font-medium">{h.overdue_count}</span>
                    </div>
                  )}
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
