'use client';

import { useState, useEffect } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

type LifecycleStage =
  | 'prospecting'
  | 'onboarding'
  | 'building_trust'
  | 'deep_work'
  | 'sustaining'
  | 'winding_down'
  | 'at_risk';

interface OrgLifecycle {
  org_id: string;
  org_name: string;
  stage: LifecycleStage;
  confidence: number;
  signals: string[];
  stage_entered: string | null;
  next_stage_prediction: string | null;
  alert: string | null;
}

const stageConfig: Record<LifecycleStage, { label: string; color: string; bgColor: string }> = {
  prospecting: { label: 'Prospecting', color: 'bg-gray-400', bgColor: 'bg-gray-400/20 text-gray-400' },
  onboarding: { label: 'Onboarding', color: 'bg-blue-500', bgColor: 'bg-blue-500/20 text-blue-400' },
  building_trust: { label: 'Building Trust', color: 'bg-cyan-500', bgColor: 'bg-cyan-500/20 text-cyan-400' },
  deep_work: { label: 'Deep Work', color: 'bg-green-500', bgColor: 'bg-green-500/20 text-green-400' },
  sustaining: { label: 'Sustaining', color: 'bg-amber-500', bgColor: 'bg-amber-500/20 text-amber-400' },
  winding_down: { label: 'Winding Down', color: 'bg-orange-500', bgColor: 'bg-orange-500/20 text-orange-400' },
  at_risk: { label: 'At Risk', color: 'bg-red-500', bgColor: 'bg-red-500/20 text-red-400' },
};

const stageOrder: LifecycleStage[] = [
  'prospecting',
  'onboarding',
  'building_trust',
  'deep_work',
  'sustaining',
  'winding_down',
  'at_risk',
];

export function LifecycleTracker() {
  const [lifecycleData, setLifecycleData] = useState<OrgLifecycle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLifecycle() {
      try {
        const res = await fetch('/api/ai/lifecycle');
        if (!res.ok) throw new Error('Failed to fetch');
        const data: OrgLifecycle[] = await res.json();
        setLifecycleData(data);
      } catch (err) {
        console.error('Lifecycle fetch error:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchLifecycle();
  }, []);

  if (loading) {
    return (
      <div>
        <h2 className="section-title mb-3">
          Engagement Lifecycle
        </h2>
        <div className="bg-card rounded-lg p-4 animate-pulse">
          <div className="h-4 bg-card-hover rounded w-2/3 mb-2" />
          <div className="h-4 bg-card-hover rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (lifecycleData.length === 0) {
    return (
      <div>
        <h2 className="section-title mb-3">
          Engagement Lifecycle
        </h2>
        <p className="text-sm text-muted/60 py-3">No active clients to track.</p>
      </div>
    );
  }

  // Count orgs per stage
  const stageCounts: Record<LifecycleStage, number> = {
    prospecting: 0,
    onboarding: 0,
    building_trust: 0,
    deep_work: 0,
    sustaining: 0,
    winding_down: 0,
    at_risk: 0,
  };

  for (const org of lifecycleData) {
    stageCounts[org.stage]++;
  }

  const total = lifecycleData.length;

  // Active stages (those with at least 1 org)
  const activeStages = stageOrder.filter((s) => stageCounts[s] > 0);

  // Orgs with alerts
  const alertOrgs = lifecycleData.filter((o) => o.alert);

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
        Engagement Lifecycle
      </h2>

      <div className="bg-card rounded-lg border border-border/50 p-4">
        {/* Pipeline bar */}
        <div className="flex rounded-full overflow-hidden h-3 mb-3">
          {activeStages.map((stage) => {
            const count = stageCounts[stage];
            const widthPct = (count / total) * 100;
            return (
              <div
                key={stage}
                className={cn(stageConfig[stage].color, 'transition-all')}
                style={{ width: `${widthPct}%` }}
                title={`${stageConfig[stage].label}: ${count}`}
              />
            );
          })}
        </div>

        {/* Stage legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3">
          {activeStages.map((stage) => (
            <div key={stage} className="flex items-center gap-1.5">
              <span className={cn('w-2 h-2 rounded-full', stageConfig[stage].color)} />
              <span className="text-xs text-muted">
                {stageConfig[stage].label}{' '}
                <span className="font-medium text-foreground">{stageCounts[stage]}</span>
              </span>
            </div>
          ))}
        </div>

        {/* Alerts */}
        {alertOrgs.length > 0 && (
          <div className="border-t border-border/50 pt-3 space-y-1.5">
            {alertOrgs.map((org) => (
              <a
                key={org.org_id}
                href={`/clients/${org.org_id}`}
                className="flex items-start gap-2 text-xs hover:bg-card-hover rounded px-2 py-1.5 -mx-2 transition-colors"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{org.org_name}</span>
                  <span className="text-muted"> &mdash; {org.alert}</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
