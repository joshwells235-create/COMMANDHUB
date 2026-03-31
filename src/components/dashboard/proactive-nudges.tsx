'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Brain,
  Calendar,
  Users,
  Mail,
  AlertTriangle,
  Clock,
  ArrowRight,
  CheckCircle2,
  Heart,
  Target,
} from 'lucide-react';

interface Nudge {
  id: string;
  type: string;
  score: number;
  icon: string;
  title: string;
  subtitle: string;
  action_type: string;
  action_url: string;
  org_id: string | null;
  commitment_id: string | null;
  urgency: 'high' | 'medium' | 'low';
}

const iconMap: Record<string, React.ElementType> = {
  calendar: Calendar,
  users: Users,
  mail: Mail,
  'alert-triangle': AlertTriangle,
  clock: Clock,
  heart: Heart,
  target: Target,
};

const urgencyConfig = {
  high: { border: 'border-danger', iconColor: 'text-danger', bg: 'bg-danger/10' },
  medium: { border: 'border-warning', iconColor: 'text-warning', bg: 'bg-warning/10' },
  low: { border: 'border-primary', iconColor: 'text-primary', bg: 'bg-primary/10' },
};

export function ProactiveNudges() {
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchNudges() {
      try {
        const res = await fetch('/api/nudges');
        if (!res.ok) throw new Error('Failed to fetch nudges');
        const data = await res.json();
        setNudges(data.nudges ?? data ?? []);
      } catch (err) {
        console.error('Nudges fetch error:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchNudges();
  }, []);

  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border p-4 premium-card">
        <h2 className="section-title flex items-center gap-2 mb-3">
          <Brain className="w-4 h-4 text-primary" />
          PROACTIVE INTEL
        </h2>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse flex items-center gap-3 p-3 bg-card-hover rounded-lg">
              <div className="w-8 h-8 bg-border/30 rounded-lg shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-border/30 rounded w-3/4" />
                <div className="h-3 bg-border/30 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-4 premium-card">
      <h2 className="section-title flex items-center gap-2 mb-3">
        <Brain className="w-4 h-4 text-primary" />
        PROACTIVE INTEL
      </h2>

      {nudges.length === 0 ? (
        <div className="flex items-center gap-3 p-4 bg-card-hover rounded-lg border border-border/50">
          <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
          <p className="text-sm text-muted">
            All clear — nothing needs your attention right now
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {nudges.map((nudge) => {
            const config = urgencyConfig[nudge.urgency as keyof typeof urgencyConfig] || urgencyConfig.medium;
            const Icon = iconMap[nudge.icon] || AlertTriangle;

            return (
              <Link
                key={nudge.id}
                href={nudge.action_url}
                className={`flex items-center gap-3 p-3 bg-card-hover/50 rounded-lg border-l-4 ${config.border} hover:bg-card-hover transition-colors group`}
              >
                <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center shrink-0`}>
                  <Icon className={`w-4 h-4 ${config.iconColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {nudge.title}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {nudge.subtitle}
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted shrink-0 group-hover:text-primary transition-colors" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
