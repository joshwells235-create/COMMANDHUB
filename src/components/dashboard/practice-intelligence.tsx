'use client';

import { useState, useEffect } from 'react';
import { Brain, TrendingUp, Eye, EyeOff, RefreshCw, Loader2 } from 'lucide-react';

interface CrossClientPattern {
  pattern: string;
  description: string;
  clients_affected: string[];
  frequency: string;
  significance: string;
}

interface WhatWorked {
  challenge: string;
  client_resolved: string;
  approach_used: string;
  applicable_to: string[];
  suggested_adaptation: string;
}

interface CoachingBlindSpot {
  blind_spot: string;
  evidence: string;
  impact: string;
  recommendation: string;
}

interface PracticeData {
  cross_client_patterns: CrossClientPattern[];
  what_worked_where: WhatWorked[];
  coaching_blind_spots: CoachingBlindSpot[];
}

export function PracticeIntelligence() {
  const [data, setData] = useState<PracticeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [noData, setNoData] = useState(false);

  async function fetchData() {
    try {
      setLoading(true);
      const res = await fetch('/api/ai/cross-client');
      if (res.status === 404) {
        setNoData(true);
        setData(null);
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json.patterns);
      setNoData(false);
    } catch (err) {
      console.error('Practice intelligence fetch error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function generate() {
    try {
      setGenerating(true);
      const res = await fetch('/api/ai/cross-client', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to generate');
      const json = await res.json();
      setData(json.patterns);
      setNoData(false);
    } catch (err) {
      console.error('Practice intelligence generate error:', err);
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          Practice Intelligence
        </h2>
        <div className="bg-card rounded-lg p-4 animate-pulse">
          <div className="h-4 bg-card-hover rounded w-2/3 mb-2" />
          <div className="h-4 bg-card-hover rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (noData && !data) {
    return (
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          Practice Intelligence
        </h2>
        <div className="bg-card rounded-lg p-4 border border-border/50">
          <p className="text-sm text-muted/60 mb-3">No cross-client analysis yet.</p>
          <button
            onClick={generate}
            disabled={generating}
            className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Brain className="w-4 h-4" />
                Generate Practice Intelligence
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const topPatterns = data.cross_client_patterns?.slice(0, 3) || [];
  const topWorked = data.what_worked_where?.slice(0, 2) || [];
  const topBlindSpots = data.coaching_blind_spots?.slice(0, 2) || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Practice Intelligence
        </h2>
        <button
          onClick={generate}
          disabled={generating}
          className="text-xs text-muted hover:text-foreground transition-colors flex items-center gap-1"
        >
          {generating ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          {generating ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="bg-card rounded-lg border border-border/50 divide-y divide-border/50">
        {/* Cross-Client Patterns */}
        {topPatterns.length > 0 && (
          <div className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Brain className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wide">
                Cross-Client Patterns
              </span>
            </div>
            <div className="space-y-1.5">
              {topPatterns.map((p, i) => (
                <div key={i} className="text-sm">
                  <span className="font-medium text-foreground">{p.pattern}</span>
                  <span className="text-xs text-muted ml-1.5">
                    ({p.clients_affected?.length || 0} clients)
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* What Worked */}
        {topWorked.length > 0 && (
          <div className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="w-3.5 h-3.5 text-success" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wide">
                What Worked
              </span>
            </div>
            <div className="space-y-1.5">
              {topWorked.map((w, i) => (
                <div key={i} className="text-sm">
                  <span className="font-medium text-foreground">{w.approach_used}</span>
                  <span className="text-xs text-muted ml-1.5">
                    at {w.client_resolved}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Coaching Blind Spots */}
        {topBlindSpots.length > 0 && (
          <div className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <EyeOff className="w-3.5 h-3.5 text-warning" />
              <span className="text-xs font-semibold text-muted uppercase tracking-wide">
                Practice Blind Spots
              </span>
            </div>
            <div className="space-y-1.5">
              {topBlindSpots.map((b, i) => (
                <div key={i} className="text-sm">
                  <span className="font-medium text-foreground">{b.blind_spot}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
