'use client';

import { useState, useEffect } from 'react';
import { HeartPulse, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OrgHealth {
  org_id: string;
  org_name: string;
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
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          Relationship Health
        </h2>
        <div className="bg-card rounded-lg p-4 animate-pulse">
          <div className="h-4 bg-card-hover rounded w-2/3 mb-2" />
          <div className="h-4 bg-card-hover rounded w-1/2" />
        </div>
      </div>
    );
  }

  // Only show orgs that need attention
  const needsAttention = healthData.filter(
    (h) => h.status === 'cooling' || h.status === 'at_risk'
  );

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
        Relationship Health
      </h2>

      {needsAttention.length === 0 ? (
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
        <div className="space-y-1">
          {needsAttention.map((h) => (
            <a
              key={h.org_id}
              href={`/clients/${h.org_id}`}
              className="flex items-center gap-3 bg-card rounded-lg px-4 py-2.5 hover:bg-card-hover transition-colors"
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
    </div>
  );
}
