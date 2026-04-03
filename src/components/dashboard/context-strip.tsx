'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Heart, Dumbbell, Briefcase, Calendar, Target, AlertTriangle, Users } from 'lucide-react';

interface GoalProgress {
  id: string;
  title: string;
  type: string;
  frequency: string;
  target: number;
  current: number;
  onTrack: boolean;
  milestones: string[] | null;
  currentMilestone: number | null;
}

interface LifeSummary {
  weekByTag: Record<string, number>;
  goalProgress: GoalProgress[];
  personalCommitments: Array<{ id: string; title: string; due_date: string | null }>;
}

interface ContextStripProps {
  internalStats: { total: number; overdue: number; dueToday: number };
  clientStats: { total: number; overdue: number };
}

export function ContextStrip({ internalStats, clientStats }: ContextStripProps) {
  const [life, setLife] = useState<LifeSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/life/summary')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setLife(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  const fitnessGoal = life?.goalProgress.find((g) => g.id === 'fitness-weekly');
  const personalDue = life?.personalCommitments.filter(
    (c) => c.due_date && new Date(c.due_date) <= new Date(Date.now() + 2 * 86400000)
  ) || [];
  const milestoneGoals = life?.goalProgress.filter((g) => g.type === 'milestone' && g.milestones) || [];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {/* Client lane */}
      <Link
        href="/commitments?category=client"
        className="glass rounded-xl px-3 py-2.5 flex items-center gap-3 hover:border-primary/30 transition-all group"
      >
        <Users className="w-4 h-4 text-primary flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-0.5">Practice</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-foreground font-medium">{clientStats.total} active</span>
            {clientStats.overdue > 0 && (
              <span className="text-danger flex items-center gap-0.5">
                <AlertTriangle className="w-3 h-3" />
                {clientStats.overdue}
              </span>
            )}
            {clientStats.overdue === 0 && <span className="text-success">clear</span>}
          </div>
        </div>
      </Link>

      {/* Internal lane */}
      <Link
        href="/commitments?category=internal"
        className="glass rounded-xl px-3 py-2.5 flex items-center gap-3 hover:border-violet-500/30 transition-all border-violet-500/10 group"
      >
        <Briefcase className="w-4 h-4 text-violet-400 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-400 mb-0.5">Internal</p>
          <div className="flex items-center gap-2 text-xs">
            {internalStats.total > 0 ? (
              <>
                <span className="text-foreground font-medium">{internalStats.total} active</span>
                {internalStats.overdue > 0 && <span className="text-danger">{internalStats.overdue} overdue</span>}
                {internalStats.dueToday > 0 && <span className="text-warning">{internalStats.dueToday} today</span>}
                {internalStats.overdue === 0 && internalStats.dueToday === 0 && <span className="text-success">on track</span>}
              </>
            ) : (
              <span className="text-muted">no tasks</span>
            )}
          </div>
        </div>
      </Link>

      {/* Personal lane */}
      <Link
        href="/commitments?category=personal"
        className="glass rounded-xl px-3 py-2.5 flex items-center gap-3 hover:border-emerald-500/30 transition-all border-emerald-500/10 group"
      >
        <Heart className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400 mb-0.5">Life</p>
          <div className="flex items-center gap-2 text-xs flex-wrap">
            {fitnessGoal && (
              <span className={fitnessGoal.current >= fitnessGoal.target ? 'text-success font-medium' : fitnessGoal.onTrack ? 'text-foreground' : 'text-warning'}>
                <Dumbbell className="w-3 h-3 inline mr-0.5" />
                {fitnessGoal.current}/{fitnessGoal.target}
              </span>
            )}
            {milestoneGoals.length > 0 && (
              <span className="text-muted truncate" style={{ maxWidth: 80 }}>
                <Target className="w-3 h-3 inline mr-0.5" />
                {milestoneGoals[0].title}
              </span>
            )}
            {personalDue.length > 0 && (
              <span className="text-warning">
                <Calendar className="w-3 h-3 inline mr-0.5" />
                {personalDue.length} due
              </span>
            )}
            {!fitnessGoal && milestoneGoals.length === 0 && personalDue.length === 0 && (
              <span className="text-muted">tell the Brain to set goals</span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}
