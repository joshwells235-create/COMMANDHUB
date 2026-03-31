'use client';

import { useState, useEffect } from 'react';
import { Heart, Dumbbell, Calendar, Target } from 'lucide-react';

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

export function LifePulse() {
  const [data, setData] = useState<LifeSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/life/summary')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null; // Don't show skeleton — just appear when ready
  if (!data) return null;

  const fitnessGoal = data.goalProgress.find((g) => g.id === 'fitness-weekly');
  const personalDue = data.personalCommitments.filter(
    (c) => c.due_date && new Date(c.due_date) <= new Date(Date.now() + 2 * 86400000)
  );
  const hasData = fitnessGoal || personalDue.length > 0;

  if (!hasData) {
    return (
      <div className="bg-card/50 rounded-xl border border-border/50 px-4 py-2.5 flex items-center gap-3 text-xs">
        <Heart className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
        <span className="text-muted">Track your life — tell the Brain: &quot;Log a workout&quot; or &quot;I want to work out 4x/week&quot;</span>
      </div>
    );
  }

  return (
    <div className="bg-card/50 rounded-xl border border-border/50 px-4 py-2.5 flex items-center gap-4 text-xs overflow-x-auto">
      <Heart className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />

      {fitnessGoal && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <Dumbbell className="w-3 h-3 text-muted" />
          <span className={fitnessGoal.current >= fitnessGoal.target ? 'text-success font-medium' : fitnessGoal.onTrack ? 'text-foreground' : 'text-warning'}>
            {fitnessGoal.current}/{fitnessGoal.target}
          </span>
          <span className="text-muted">workouts</span>
          {fitnessGoal.current >= fitnessGoal.target && (
            <span className="text-success">✓</span>
          )}
        </div>
      )}

      {data.goalProgress.filter((g) => g.type === 'milestone' && g.milestones).map((g) => (
        <div key={g.id} className="flex items-center gap-2 flex-shrink-0">
          <Target className="w-3 h-3 text-muted" />
          <span className="text-muted truncate" style={{ maxWidth: 120 }}>{g.title}</span>
        </div>
      ))}

      {personalDue.length > 0 && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <Calendar className="w-3 h-3 text-warning" />
          <span className="text-warning">{personalDue.length} personal due soon</span>
        </div>
      )}
    </div>
  );
}
