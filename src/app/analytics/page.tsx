'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Zap, ArrowLeft, Loader2, BarChart3, TrendingUp, TrendingDown, Users, Target,
  Mail, Clock, CheckCircle2, AlertTriangle, Activity, Gauge, ArrowUpRight, ArrowDownRight, Minus,
  DollarSign, Calendar,
} from 'lucide-react';

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

interface PipelineData {
  quarterlyPace: {
    quarter: string;
    target: number;
    closed: number;
    gap: number;
    pacePercent: number;
  };
  pipeline: {
    total: number;
    dealCount: number;
    byMonth: Array<{
      month: string;
      total: number;
      deals: number;
      items: Array<{ name: string; org: string; amount: number; type: string }>;
    }>;
  };
  renewals: {
    upcoming60Days: number;
    value: number;
    items: Array<{ name: string; org: string; amount: number; dueDate: string }>;
  };
}

interface Scorecard {
  practice: {
    totalClients: number;
    clientsTouched7d: number;
    coverageRate: number;
    sessionsThisMonth: number;
    sessionsLastMonth: number;
    sessionsTrend: number;
    avgSessionsPerClient: number;
  };
  velocity: {
    created30d: number;
    completed30d: number;
    completionRate: number;
    prevCompletionRate: number;
    completionTrend: number;
    avgCompletionDays: number | null;
    overdueCount: number;
    promiseKeptRate: number | null;
    waitingCount: number;
  };
  email: {
    total: number;
    processed: number;
    unprocessed: number;
    processingRate: number;
    needsReply: number;
  };
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

function TrendBadge({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (value === 0) return <span className="text-muted text-xs flex items-center gap-0.5"><Minus className="w-3 h-3" /> flat</span>;
  if (value > 0) return <span className="text-success text-xs flex items-center gap-0.5"><ArrowUpRight className="w-3 h-3" /> +{value}{suffix}</span>;
  return <span className="text-danger text-xs flex items-center gap-0.5"><ArrowDownRight className="w-3 h-3" /> {value}{suffix}</span>;
}

function MetricCard({ icon: Icon, label, value, sub, trend, color = 'text-primary' }: {
  icon: typeof Gauge;
  label: string;
  value: string | number;
  sub?: string;
  trend?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${color}`} />
          <span className="text-xs text-muted uppercase tracking-wider font-medium">{label}</span>
        </div>
        {trend}
      </div>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<WeeklyData | null>(null);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [pipelineData, setPipelineData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/stats/weekly').then((r) => r.json()).catch(() => null),
      fetch('/api/stats/scorecard').then((r) => r.json()).catch(() => null),
      fetch('/api/stats/pipeline').then((r) => r.json()).catch(() => null),
    ]).then(([weekly, sc, pipe]) => {
      if (weekly?.weeklyBars) setData(weekly);
      if (sc?.practice) setScorecard(sc);
      if (pipe?.quarterlyPace) setPipelineData(pipe);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
      </div>
    );
  }

  const s = scorecard;

  // Bar chart helpers
  const weeklyBars = data?.weeklyBars || [];
  const completionRates = data?.completionRates || [];
  const clientEngagement = data?.clientEngagement || [];
  const typeBreakdown = data?.typeBreakdown || {};

  const maxBarValue = Math.max(...weeklyBars.flatMap((w) => [w.created, w.completed]), 1);
  const barChartHeight = 160;
  const barChartWidth = 400;
  const barGroupWidth = weeklyBars.length > 0 ? barChartWidth / weeklyBars.length : barChartWidth;

  const rateMax = 100;
  const rateWidth = 300;
  const rateHeight = 100;
  const ratePoints = completionRates.map((r, i) => ({
    x: (i / Math.max(completionRates.length - 1, 1)) * rateWidth,
    y: rateHeight - (r / rateMax) * (rateHeight - 10) - 5,
  }));
  const ratePath = ratePoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');

  const typeEntries = Object.entries(typeBreakdown).sort((a, b) => b[1] - a[1]);
  const typeTotal = typeEntries.reduce((sum, [, v]) => sum + v, 0);

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
    return { type, count, startAngle: start, endAngle: start + angle - 0.5, color: TYPE_COLORS[type] || '#6b7280' };
  });

  const maxEngagement = Math.max(...clientEngagement.map((c) => c.count), 1);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-muted hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Zap className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold">Analytics &amp; Scorecard</h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* Coaching Scorecard */}
        {s && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <Gauge className="w-5 h-5 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Coaching Scorecard</h2>
              <span className="text-xs text-muted ml-2">30-day snapshot</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard
                icon={Users}
                label="Active Clients"
                value={s.practice.totalClients}
                sub={`${s.practice.clientsTouched7d} touched this week (${s.practice.coverageRate}%)`}
                color="text-violet-400"
              />
              <MetricCard
                icon={Activity}
                label="Sessions"
                value={s.practice.sessionsThisMonth}
                sub={`${s.practice.avgSessionsPerClient}/client avg`}
                trend={<TrendBadge value={s.practice.sessionsTrend} />}
                color="text-primary"
              />
              <MetricCard
                icon={CheckCircle2}
                label="Completion Rate"
                value={`${s.velocity.completionRate}%`}
                sub={`${s.velocity.completed30d} of ${s.velocity.created30d} commitments`}
                trend={<TrendBadge value={s.velocity.completionTrend} suffix="pt" />}
                color="text-success"
              />
              <MetricCard
                icon={Clock}
                label="Avg Resolution"
                value={s.velocity.avgCompletionDays !== null ? `${s.velocity.avgCompletionDays}d` : '—'}
                sub="days to complete"
                color="text-primary"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard
                icon={AlertTriangle}
                label="Overdue"
                value={s.velocity.overdueCount}
                sub="commitments past due"
                color={s.velocity.overdueCount > 5 ? 'text-danger' : s.velocity.overdueCount > 0 ? 'text-warning' : 'text-success'}
              />
              <MetricCard
                icon={Target}
                label="Promises Kept"
                value={s.velocity.promiseKeptRate !== null ? `${s.velocity.promiseKeptRate}%` : '—'}
                sub="of Josh's promises delivered"
                color="text-violet-400"
              />
              <MetricCard
                icon={Clock}
                label="Waiting On"
                value={s.velocity.waitingCount}
                sub="items from others"
                color="text-warning"
              />
              <MetricCard
                icon={Mail}
                label="Email Queue"
                value={s.email.unprocessed}
                sub={`${s.email.processed} processed (${s.email.processingRate}%)`}
                color={s.email.unprocessed > 50 ? 'text-danger' : s.email.unprocessed > 10 ? 'text-warning' : 'text-success'}
              />
            </div>

            {/* Email processing progress bar */}
            {s.email.total > 0 && (
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-primary" />
                    <span className="text-xs text-muted uppercase tracking-wider font-medium">Email Intelligence Processing</span>
                  </div>
                  <span className="text-xs text-muted">{s.email.processed}/{s.email.total}</span>
                </div>
                <div className="w-full h-2 bg-background rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-all"
                    style={{ width: `${s.email.processingRate}%` }}
                  />
                </div>
                {s.email.unprocessed > 0 && (
                  <p className="text-xs text-muted mt-1.5">
                    {s.email.unprocessed} emails queued for AI extraction — processing 15/cycle
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* Revenue Pipeline */}
        {pipelineData && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-5 h-5 text-violet-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Revenue Pipeline</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Quarterly Pace */}
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  <span className="text-xs text-muted uppercase tracking-wider font-medium">{pipelineData.quarterlyPace.quarter} Pace</span>
                </div>
                <p className="text-2xl font-bold">${(pipelineData.quarterlyPace.closed / 1000).toFixed(0)}K</p>
                <p className="text-xs text-muted">of ${(pipelineData.quarterlyPace.target / 1000).toFixed(0)}K target</p>
                <div className="w-full h-2 bg-background rounded-full overflow-hidden mt-2">
                  <div
                    className={`h-full rounded-full transition-all ${
                      pipelineData.quarterlyPace.pacePercent >= 80 ? 'bg-success' :
                      pipelineData.quarterlyPace.pacePercent >= 50 ? 'bg-warning' : 'bg-danger'
                    }`}
                    style={{ width: `${Math.min(100, pipelineData.quarterlyPace.pacePercent)}%` }}
                  />
                </div>
                {pipelineData.quarterlyPace.gap > 0 && (
                  <p className="text-xs text-warning mt-1">${(pipelineData.quarterlyPace.gap / 1000).toFixed(0)}K gap</p>
                )}
              </div>

              {/* Open Pipeline */}
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4 text-violet-400" />
                  <span className="text-xs text-muted uppercase tracking-wider font-medium">Open Pipeline</span>
                </div>
                <p className="text-2xl font-bold">${(pipelineData.pipeline.total / 1000).toFixed(0)}K</p>
                <p className="text-xs text-muted">{pipelineData.pipeline.dealCount} deals</p>
              </div>

              {/* Renewals */}
              <div className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-warning" />
                  <span className="text-xs text-muted uppercase tracking-wider font-medium">Renewals (60 days)</span>
                </div>
                <p className="text-2xl font-bold">{pipelineData.renewals.upcoming60Days}</p>
                <p className="text-xs text-muted">${(pipelineData.renewals.value / 1000).toFixed(1)}K total</p>
              </div>
            </div>

            {/* Pipeline by Month */}
            {pipelineData.pipeline.byMonth.length > 0 && (
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-4 h-4 text-violet-400" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Pipeline by Month</h2>
                </div>
                <div className="space-y-3">
                  {pipelineData.pipeline.byMonth.slice(0, 8).map((m) => (
                    <div key={m.month}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-muted">{m.month}</span>
                        <span className="text-sm font-semibold">${(m.total / 1000).toFixed(1)}K</span>
                      </div>
                      <div className="w-full h-3 bg-background rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-500/60 to-violet-400"
                          style={{ width: `${Math.min(100, (m.total / Math.max(...pipelineData.pipeline.byMonth.map(x => x.total), 1)) * 100)}%` }}
                        />
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {m.items.slice(0, 3).map((item, i) => (
                          <span key={i} className="text-[10px] text-muted/60">{item.org} (${(item.amount / 1000).toFixed(1)}K)</span>
                        ))}
                        {m.items.length > 3 && <span className="text-[10px] text-muted/60">+{m.items.length - 3} more</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upcoming Renewals */}
            {pipelineData.renewals.items.length > 0 && (
              <div className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Calendar className="w-4 h-4 text-warning" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Upcoming Renewals</h2>
                </div>
                <div className="space-y-2">
                  {pipelineData.renewals.items.map((r, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
                      <div>
                        <p className="text-sm">{r.org}</p>
                        <p className="text-xs text-muted">{r.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">${(r.amount / 1000).toFixed(1)}K</p>
                        <p className="text-xs text-muted">{r.dueDate}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Created vs Completed */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Created vs Completed</h2>
            </div>
            {weeklyBars.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <BarChart3 className="w-8 h-8 text-muted/30 mb-2" />
                <p className="text-sm text-muted">No commitment data yet.</p>
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>

          {/* Completion Rate Trend */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-success" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Completion Rate</h2>
            </div>
            {completionRates.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <TrendingUp className="w-8 h-8 text-muted/30 mb-2" />
                <p className="text-sm text-muted">No trend data yet.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-4 mb-3">
                  {completionRates.map((r, i) => (
                    <div key={i} className="text-center">
                      <p className={`text-lg font-bold ${r >= 70 ? 'text-success' : r >= 40 ? 'text-warning' : 'text-danger'}`}>{r}%</p>
                      <p className="text-[10px] text-muted">{weeklyBars[i]?.label}</p>
                    </div>
                  ))}
                </div>
                <svg viewBox={`0 0 ${rateWidth} ${rateHeight}`} className="w-full" preserveAspectRatio="xMidYMid meet">
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
              </>
            )}
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
