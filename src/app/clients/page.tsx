'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Zap,
  ArrowLeft,
  Building2,
  Star,
  TrendingUp,
  CheckCircle2,
  Calendar,
  Plus,
} from 'lucide-react';
import type { Organization, Commitment } from '@/types/database';
import { cn } from '@/lib/utils';
import { QuickAddOrg } from '@/components/organizations/quick-add-org';

type LifecycleStage =
  | 'prospecting'
  | 'onboarding'
  | 'building_trust'
  | 'deep_work'
  | 'sustaining'
  | 'winding_down'
  | 'at_risk';

interface OrgLifecycleData {
  org_id: string;
  stage: LifecycleStage;
}

const lifecycleBadgeConfig: Record<LifecycleStage, { label: string; className: string }> = {
  prospecting: { label: 'Prospecting', className: 'bg-gray-400/20 text-gray-400' },
  onboarding: { label: 'Onboarding', className: 'bg-blue-500/20 text-blue-400' },
  building_trust: { label: 'Building Trust', className: 'bg-cyan-500/20 text-cyan-400' },
  deep_work: { label: 'Deep Work', className: 'bg-green-500/20 text-green-400' },
  sustaining: { label: 'Sustaining', className: 'bg-amber-500/20 text-amber-400' },
  winding_down: { label: 'Winding Down', className: 'bg-orange-500/20 text-orange-400' },
  at_risk: { label: 'At Risk', className: 'bg-red-500/20 text-red-400' },
};

interface OrgCardData {
  org: Organization;
  activeCommitmentCount: number;
  nextEventDate: string | null;
}

export default function ClientsPage() {
  const [orgCards, setOrgCards] = useState<OrgCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [lifecycleMap, setLifecycleMap] = useState<Record<string, LifecycleStage>>({});

  const fetchData = useCallback(async () => {
    try {
      const [orgsRes, commitmentsRes, eventsRes] = await Promise.all([
        fetch('/api/organizations'),
        fetch('/api/commitments?status=pending,in_progress,waiting,snoozed&limit=200'),
        fetch('/api/calendar'),
      ]);

      const orgs: Organization[] = await orgsRes.json();
      const commitments: Commitment[] = commitmentsRes.ok
        ? await commitmentsRes.json()
        : [];
      const eventsData = eventsRes.ok ? await eventsRes.json() : [];
      const events = Array.isArray(eventsData)
        ? eventsData
        : eventsData.events || [];

      const now = new Date();

      const cards: OrgCardData[] = orgs.map((org) => {
        const orgCommitments = commitments.filter(
          (c) => c.org_id === org.id
        );
        const orgEvents = events.filter(
          (e: { org_id: string | null; start_time: string }) =>
            e.org_id === org.id && new Date(e.start_time) > now
        );
        const nextEvent =
          orgEvents.length > 0
            ? orgEvents.sort(
                (a: { start_time: string }, b: { start_time: string }) =>
                  new Date(a.start_time).getTime() -
                  new Date(b.start_time).getTime()
              )[0]
            : null;

        return {
          org,
          activeCommitmentCount: orgCommitments.length,
          nextEventDate: nextEvent ? nextEvent.start_time : null,
        };
      });

      setOrgCards(cards);

      // Fetch lifecycle data
      try {
        const lifecycleRes = await fetch('/api/ai/lifecycle');
        if (lifecycleRes.ok) {
          const lifecycleData: OrgLifecycleData[] = await lifecycleRes.json();
          const map: Record<string, LifecycleStage> = {};
          for (const item of lifecycleData) {
            map[item.org_id] = item.stage;
          }
          setLifecycleMap(map);
        }
      } catch {
        // Lifecycle badges are non-critical, fail silently
      }
    } catch (err) {
      console.error('Failed to load client data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statusColor: Record<string, string> = {
    active: 'bg-success/20 text-success',
    paused: 'bg-warning/20 text-warning',
    prospect: 'bg-primary/20 text-primary',
    completed: 'bg-muted/20 text-muted',
  };

  const strategicIcon: Record<string, typeof Star> = {
    strategic: Star,
    emerging: TrendingUp,
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted">
          <Zap className="w-5 h-5 text-primary animate-pulse" />
          <span>Loading clients...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl header-gradient-border">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-bold tracking-tight">
                COMMAND HUB
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">
              {orgCards.length} clients
            </span>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-white px-3 py-1.5 rounded-lg btn-gradient"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Client
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        <h2 className="section-title mb-4">
          Client Intelligence
        </h2>

        {orgCards.length === 0 ? (
          <div className="bg-card rounded-lg p-8 text-center">
            <Building2 className="w-8 h-8 text-muted mx-auto mb-3" />
            <p className="text-muted">No organizations found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {orgCards.map(({ org, activeCommitmentCount, nextEventDate }) => {
              const StrategicIcon = strategicIcon[org.strategic_value];

              return (
                <Link
                  key={org.id}
                  href={`/clients/${org.id}`}
                  className="premium-card p-4 block"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="w-4 h-4 text-muted flex-shrink-0" />
                      <h3 className="font-semibold text-foreground truncate">
                        {org.name}
                      </h3>
                      {lifecycleMap[org.id] && (
                        <span
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0',
                            lifecycleBadgeConfig[lifecycleMap[org.id]].className
                          )}
                        >
                          {lifecycleBadgeConfig[lifecycleMap[org.id]].label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {StrategicIcon && (
                        <StrategicIcon
                          className={cn(
                            'w-4 h-4',
                            org.strategic_value === 'strategic'
                              ? 'text-warning'
                              : 'text-primary'
                          )}
                        />
                      )}
                      <span
                        className={cn(
                          'text-xs px-2 py-0.5 rounded-full font-medium',
                          statusColor[org.status] || 'bg-muted/20 text-muted'
                        )}
                      >
                        {org.status}
                      </span>
                    </div>
                  </div>

                  {org.industry && (
                    <p className="text-xs text-muted mb-2">{org.industry}</p>
                  )}

                  <div className="flex items-center gap-4 text-xs text-muted">
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {activeCommitmentCount} open{' '}
                        {activeCommitmentCount === 1
                          ? 'commitment'
                          : 'commitments'}
                      </span>
                    </div>
                    {nextEventDate && (
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>
                          Next:{' '}
                          {new Date(nextEventDate).toLocaleDateString(
                            'en-US',
                            {
                              month: 'short',
                              day: 'numeric',
                            }
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      <QuickAddOrg
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={fetchData}
      />
    </div>
  );
}
