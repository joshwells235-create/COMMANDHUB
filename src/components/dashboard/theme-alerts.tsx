'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw, Loader2, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react';

interface ClientAffected {
  org_id: string;
  org_name: string;
}

interface ThemeAlert {
  theme: string;
  description: string;
  clients_affected: ClientAffected[];
  frequency: number;
  opportunity: string;
  severity: 'trend' | 'pattern' | 'urgent';
}

interface ThemeAlertsData {
  themes: ThemeAlert[];
  coaching_opportunity: string | null;
  blind_spot_alert: string | null;
}

const severityConfig = {
  urgent: { color: 'bg-danger', label: 'Urgent' },
  pattern: { color: 'bg-warning', label: 'Pattern' },
  trend: { color: 'bg-primary', label: 'Trend' },
};

export function ThemeAlerts() {
  const [data, setData] = useState<ThemeAlertsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  async function fetchData() {
    try {
      setLoading(true);
      const res = await fetch('/api/ai/theme-alerts');
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json.alerts);
    } catch (err) {
      console.error('Theme alerts fetch error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    try {
      setRefreshing(true);
      const res = await fetch('/api/ai/theme-alerts', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to refresh');
      const json = await res.json();
      setData(json.alerts);
    } catch (err) {
      console.error('Theme alerts refresh error:', err);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  const alertCount = data?.themes?.length || 0;

  if (loading) {
    return (
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          Theme Alerts
        </h2>
        <div className="bg-card rounded-lg p-4 animate-pulse">
          <div className="h-4 bg-card-hover rounded w-2/3 mb-2" />
          <div className="h-4 bg-card-hover rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (!data || (data.themes.length === 0 && !data.coaching_opportunity && !data.blind_spot_alert)) {
    return (
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
          Theme Alerts
        </h2>
        <div className="bg-card rounded-lg p-4 border border-border/50">
          <p className="text-sm text-muted/60">No cross-client themes detected yet. Need 3+ clients with recent sessions.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Theme Alerts
          </h2>
          {alertCount > 0 && (
            <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-danger/20 text-danger text-xs font-bold rounded-full">
              {alertCount}
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="text-xs text-muted hover:text-foreground transition-colors flex items-center gap-1"
        >
          {refreshing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="bg-card rounded-lg border border-border/50 divide-y divide-border/50">
        {/* Theme rows */}
        {data.themes.map((alert, i) => {
          const config = severityConfig[alert.severity];
          const isExpanded = expandedIndex === i;

          return (
            <div key={i} className="p-3">
              <button
                onClick={() => setExpandedIndex(isExpanded ? null : i)}
                className="w-full text-left flex items-start gap-2"
              >
                <span
                  className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${config.color}`}
                  title={config.label}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">
                      {alert.theme}
                    </span>
                    <span className="text-xs text-muted shrink-0">
                      Affects {alert.clients_affected.length} clients
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-xs text-muted">{alert.description}</p>
                      <p className="text-xs text-primary">{alert.opportunity}</p>
                      <div className="flex flex-wrap gap-1">
                        {alert.clients_affected.map((c) => (
                          <span
                            key={c.org_id}
                            className="text-xs bg-card-hover rounded px-1.5 py-0.5 text-muted"
                          >
                            {c.org_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5 text-muted shrink-0 mt-0.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-muted shrink-0 mt-0.5" />
                )}
              </button>
            </div>
          );
        })}

        {/* Coaching Opportunity */}
        {data.coaching_opportunity && (
          <div className="p-3">
            <div className="flex items-start gap-2">
              <Lightbulb className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
              <div>
                <span className="text-xs font-semibold text-warning uppercase tracking-wide">
                  Coaching Opportunity
                </span>
                <p className="text-sm text-foreground mt-1">
                  {data.coaching_opportunity}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Blind Spot Alert */}
        {data.blind_spot_alert && (
          <div className="p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-danger mt-0.5 shrink-0" />
              <div>
                <span className="text-xs font-semibold text-danger uppercase tracking-wide">
                  Blind Spot
                </span>
                <p className="text-sm text-foreground mt-1">
                  {data.blind_spot_alert}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
