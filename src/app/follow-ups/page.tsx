'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Check, Copy, ChevronDown, ChevronUp, ExternalLink, Zap } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface FollowUpItem {
  org_id: string;
  org_name: string;
  score: number;
  urgency: 'high' | 'medium' | 'low';
  reason: string;
  suggested_action: string;
  draft_message: string;
  overdue_count: number;
  waiting_count: number;
  days_since_contact: number;
}

const urgencyConfig = {
  high: { label: 'High', bg: 'bg-danger/20', text: 'text-danger', dot: 'bg-danger' },
  medium: { label: 'Medium', bg: 'bg-warning/20', text: 'text-warning', dot: 'bg-warning' },
  low: { label: 'Low', bg: 'bg-primary/20', text: 'text-primary', dot: 'bg-primary' },
};

export default function FollowUpQueuePage() {
  const [followUps, setFollowUps] = useState<FollowUpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function fetchQueue() {
      try {
        const res = await fetch('/api/ai/follow-up-queue');
        if (!res.ok) throw new Error('Failed to fetch');
        const data: FollowUpItem[] = await res.json();
        setFollowUps(data);
      } catch (err) {
        console.error('Follow-up queue fetch error:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchQueue();
  }, []);

  async function handleMarkDone(item: FollowUpItem) {
    try {
      await fetch('/api/commitments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Follow up with ${item.org_name}: ${item.reason}`,
          commitment_type: 'follow_up',
          org_id: item.org_id,
          owner: 'josh',
          source_type: 'follow_up_queue',
        }),
      });
      setDismissedIds((prev) => new Set(prev).add(item.org_id));
    } catch (err) {
      console.error('Failed to create commitment:', err);
    }
  }

  async function handleCopy(text: string, orgId: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(orgId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback: select text
    }
  }

  const visibleFollowUps = followUps.filter((f) => !dismissedIds.has(f.org_id));

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl header-gradient-border">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
            <Link href="/" className="text-muted hover:text-foreground transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-lg font-bold tracking-tight">Follow-up Queue</h1>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-6">
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card rounded-xl p-5 border border-border/50 animate-pulse">
                <div className="h-5 bg-card-hover rounded w-1/3 mb-3" />
                <div className="h-4 bg-card-hover rounded w-2/3 mb-2" />
                <div className="h-4 bg-card-hover rounded w-1/2" />
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-muted hover:text-foreground transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-lg font-bold tracking-tight">Follow-up Queue</h1>
            {visibleFollowUps.length > 0 && (
              <span className="text-xs font-medium bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                {visibleFollowUps.length}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        {visibleFollowUps.length === 0 ? (
          <div className="bg-card rounded-xl p-8 border border-border/50 text-center">
            <div className="flex items-center justify-center gap-2 text-success mb-2">
              <Check className="w-5 h-5" />
              <span className="font-semibold">All caught up</span>
            </div>
            <p className="text-sm text-muted">No follow-ups needed right now.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleFollowUps.map((item) => {
              const config = urgencyConfig[item.urgency as keyof typeof urgencyConfig] || urgencyConfig.medium;
              const isExpanded = expandedId === item.org_id;

              return (
                <div
                  key={item.org_id}
                  className="bg-card rounded-xl border border-border/50 overflow-hidden"
                >
                  <div className="p-5">
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Link
                          href={`/clients/${item.org_id}`}
                          className="text-base font-semibold text-foreground hover:text-primary transition-colors truncate"
                        >
                          {item.org_name}
                        </Link>
                        <span
                          className={cn(
                            'text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0',
                            config.bg,
                            config.text
                          )}
                        >
                          {config.label}
                        </span>
                      </div>
                      <span className="text-xs text-muted tabular-nums flex-shrink-0">
                        {item.score} pts
                      </span>
                    </div>

                    {/* Reason */}
                    <p className="text-sm text-foreground/80 mb-2">{item.reason}</p>

                    {/* Meta info */}
                    <div className="flex flex-wrap gap-3 text-xs text-muted mb-3">
                      <span>
                        {item.suggested_action === 'email'
                          ? 'Send email'
                          : item.suggested_action === 'call'
                          ? 'Make a call'
                          : 'Schedule session'}
                      </span>
                      {item.days_since_contact > 0 && (
                        <>
                          <span>&middot;</span>
                          <span>{item.days_since_contact}d since contact</span>
                        </>
                      )}
                      {item.overdue_count > 0 && (
                        <>
                          <span>&middot;</span>
                          <span className="text-danger">{item.overdue_count} overdue</span>
                        </>
                      )}
                      {item.waiting_count > 0 && (
                        <>
                          <span>&middot;</span>
                          <span className="text-warning">{item.waiting_count} waiting</span>
                        </>
                      )}
                    </div>

                    {/* Draft message toggle */}
                    {item.draft_message && (
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : item.org_id)}
                        className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover transition-colors mb-3"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                        {isExpanded ? 'Hide draft' : 'Show draft message'}
                      </button>
                    )}

                    {isExpanded && item.draft_message && (
                      <div className="bg-background rounded-lg p-3 mb-3 border border-border/50">
                        <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
                          {item.draft_message}
                        </p>
                        <button
                          onClick={() => handleCopy(item.draft_message, item.org_id)}
                          className="mt-2 flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover transition-colors"
                        >
                          {copiedId === item.org_id ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              Copy message
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleMarkDone(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-success/20 text-success hover:bg-success/30 rounded-lg text-sm font-medium transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Mark Done
                      </button>
                      <Link
                        href={`/prep/${item.org_id}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/20 text-primary hover:bg-primary/30 rounded-lg text-sm font-medium transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Prep
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
