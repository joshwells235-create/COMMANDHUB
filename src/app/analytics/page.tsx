'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Zap, ArrowLeft, Loader2, BarChart3, TrendingUp, Users, Target } from 'lucide-react';

interface WeeklyBar {
  label: string;
  created: number;
  completed: number;
}

interface WeeklyData {
  weeklyBars: WeeklyBar[];
  completionRates: number[];
  clientEngagement: Array<{ name: string; count: number }>;
  typeBreakdown: Record<string, number>;
}

const TYPE_LABELS: Record<string, string> = {
  promise_made: 'Promise',
  ask_received: 'Ask',
  follow_up: 'Follow Up',
  waiting_on: 'Waiting On',
  deliverable: 'Deliverable',
  prep: 'Prep',
  internal: 'Internal',
  note_to_self: 'Note',
};

const TYPE_COLORS: Record<string, string> = {
  promise_made: '#ef4444',
  ask_received: '#f59e0b',
  follow_up: '#06b6d4',
  waiting_on: '#fb923c',
  deliverable: '#8b5cf6',
  prep: '#22c55e',
  internal: '#6b7280',
  note_to_self: '#3b82f6',
};

export default function AnalyticsPage() {
  const [data, setData] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stats/weekly')
      .then((r) => r.json())
      .then((d) => { if (d.weeklyBars) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <BarChart3 className="w-12 h-12 text-muted/30" />
        <p className="text-muted">No analytics data available yet.</p>
        <Link href="/" className="text-primary text-sm">Back to dashboard</Link>
      </div>
    );
  }

  const { weeklyBars, completionRates, clientEngagement, typeBreakdown } = data;

  // Bar chart helpers
  const maxBarValue = Math.max(...weeklyBars.flatMap((w) => [w.created, w.completed]), 1);
  const barChartHeight = 160;
  const barChartWidth = 400;
  const barGroupWidth = barChartWidth / weeklyBars.length;

  // Completion rate line chart
  const rateMax = 100;
  const rateWidth = 300;
  const rateHeight = 100;
  const ratePoints = completionRates.map((r, i) => ({
    x: (i / Math.max(completionRates.length - 1, 1)) * rateWidth,
    y: rateHeight - (r / rateMax) * (rateHeight - 10) - 5,
  }));
  const ratePath = ratePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');

  // Type breakdown donut
  const typeEntries = Object.entries(typeBreakdown).sort((a, b) => b[1] - a[1]);
  const typeTotal = typeEntries.reduce((sum, [, v]) => sum + v, 0);

  // Build donut arcs
  const donutRadius = 60;
  const donutInner = 40;
  const donutCenter = 70;

  function donutArc(startAngle: number, endAngle: number, radius: number): string {
    const start = polarToCartesian(donutCenter, donutCenter, radius, endAngle);
    const end = polarToCartesian(donutCenter, donutCenter, radius, startAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
  }

  function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  let currentAngle = 0;
  const donutArcs = typeEntries.map(([type, count]) => {
    const angle = (count / Math.max(typeTotal, 1)) * 360;
    const start = currentAngle;
    currentAngle += angle;
    return {
      type,
      count,
      startAngle: start,
      endAngle: start + angle - 0.5,
      color: TYPE_COLORS[type] || '#6b7280',
    };
  });

  // Client engagement bar
  const maxEngagement = Math.max(...clientEngagement.map((c) => c.count), 1);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-muted hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Zap className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold">Analytics</h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Created vs Completed */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Created vs Completed</h2>
            </div>
            <div className="flex items-center gap-4 mb-3 text-xs">
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-primary/60" /><span className="text-muted">Created</span></div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-success" /><span className="text-muted">Completed</span></div>
            </div>
            <svg viewBox={`0 0 ${barChartWidth} ${barChartHeight + 20}`} className="w-full" preserveAspectRatio="xMidYMid meet">
              {weeklyBars.map((w, i) => {
                const x = i * barGroupWidth + barGroupWidth * 0.15;
                const bw = barGroupWidth * 0.3;
                const createdH = (w.created / maxBarValue) * barChartHeight;
                const completedH = (w.completed / maxBarValue) * barChartHeight;

                return (
                  <g key={i}>
                    <rect x={x} y={barChartHeight - createdH} width={bw} height={createdH} rx={3} fill="#06b6d4" opacity={0.5} />
                    <rect x={x + bw + 2} y={barChartHeight - completedH} width={bw} height={completedH} rx={3} fill="#22c55e" />
                    <text x={x + bw} y={barChartHeight + 14} textAnchor="middle" className="fill-muted" fontSize="10">{w.label}</text>
                    <text x={x + bw / 2} y={barChartHeight - createdH - 4} textAnchor="middle" className="fill-muted" fontSize="9">{w.created}</text>
                    <text x={x + bw + 2 + bw / 2} y={barChartHeight - completedH - 4} textAnchor="middle" className="fill-muted" fontSize="9">{w.completed}</text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Completion Rate Trend */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-success" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Completion Rate</h2>
            </div>
            <div className="flex items-center gap-4 mb-3">
              {completionRates.map((r, i) => (
                <div key={i} className="text-center">
                  <p className={`text-lg font-bold ${r >= 70 ? 'text-success' : r >= 40 ? 'text-warning' : 'text-danger'}`}>{r}%</p>
                  <p className="text-[10px] text-muted">{weeklyBars[i]?.label}</p>
                </div>
              ))}
            </div>
            <svg viewBox={`0 0 ${rateWidth} ${rateHeight}`} className="w-full" preserveAspectRatio="xMidYMid meet">
              {/* Grid lines */}
              {[25, 50, 75, 100].map((pct) => {
                const y = rateHeight - (pct / rateMax) * (rateHeight - 10) - 5;
                return (
                  <g key={pct}>
                    <line x1={0} y1={y} x2={rateWidth} y2={y} stroke="rgba(136,153,180,0.1)" />
                    <text x={rateWidth + 2} y={y + 3} fontSize="8" className="fill-muted">{pct}%</text>
                  </g>
                );
              })}
              <path d={ratePath} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {ratePoints.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={4} fill="#22c55e" />
              ))}
            </svg>
          </div>

          {/* Client Engagement */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-violet-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Client Engagement This Week</h2>
            </div>
            {clientEngagement.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center">
                <Users className="w-8 h-8 text-muted/30 mb-2" />
                <p className="text-sm text-muted">No client interactions this week.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {clientEngagement.map((c) => (
                  <div key={c.name} className="flex items-center gap-3">
                    <span className="text-sm w-28 truncate text-muted">{c.name}</span>
                    <div className="flex-1 h-5 bg-background rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500/60 to-violet-400"
                        style={{ width: `${(c.count / maxEngagement) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted w-6 text-right">{c.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Type Breakdown */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <Target className="w-4 h-4 text-warning" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Commitment Types This Week</h2>
            </div>
            {typeTotal === 0 ? (
              <div className="flex flex-col items-center py-6 text-center">
                <Target className="w-8 h-8 text-muted/30 mb-2" />
                <p className="text-sm text-muted">No commitments created this week.</p>
              </div>
            ) : (
              <div className="flex items-center gap-6">
                <svg viewBox={`0 0 ${donutCenter * 2} ${donutCenter * 2}`} width={140} height={140}>
                  {donutArcs.map((arc) => (
                    <g key={arc.type}>
                      <path
                        d={donutArc(arc.startAngle, arc.endAngle, donutRadius)}
                        fill="none"
                        stroke={arc.color}
                        strokeWidth={donutRadius - donutInner}
                        strokeLinecap="butt"
                      />
                    </g>
                  ))}
                  <text x={donutCenter} y={donutCenter - 4} textAnchor="middle" className="fill-foreground" fontSize="18" fontWeight="bold">{typeTotal}</text>
                  <text x={donutCenter} y={donutCenter + 10} textAnchor="middle" className="fill-muted" fontSize="9">total</text>
                </svg>
                <div className="space-y-1.5 flex-1">
                  {typeEntries.map(([type, count]) => (
                    <div key={type} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: TYPE_COLORS[type] || '#6b7280' }} />
                      <span className="text-xs flex-1">{TYPE_LABELS[type] || type}</span>
                      <span className="text-xs text-muted">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
