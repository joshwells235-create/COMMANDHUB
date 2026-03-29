'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Zap, ArrowLeft, Sun, BarChart3, FileText, ChevronRight, Loader2 } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

interface BriefingSummary {
  id: string;
  briefing_type: 'morning' | 'weekly';
  summary: Record<string, unknown> | null;
  generated_at: string;
}

interface BriefingFull {
  id: string;
  briefing_type: string;
  html_content: string;
  summary: Record<string, unknown> | null;
  generated_at: string;
}

export default function BriefingsPage() {
  const [briefings, setBriefings] = useState<BriefingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBriefing, setSelectedBriefing] = useState<BriefingFull | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [filter, setFilter] = useState<'all' | 'morning' | 'weekly'>('all');

  useEffect(() => {
    async function fetchBriefings() {
      try {
        const url = filter === 'all' ? '/api/briefings?limit=20' : `/api/briefings?type=${filter}&limit=20`;
        const res = await fetch(url);
        const data = await res.json();
        setBriefings(Array.isArray(data) ? data : []);
      } catch {
        setBriefings([]);
      } finally {
        setLoading(false);
      }
    }
    setLoading(true);
    fetchBriefings();
  }, [filter]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedBriefing(null);
      return;
    }
    async function fetchDetail() {
      setLoadingDetail(true);
      try {
        const res = await fetch(`/api/briefings/${selectedId}`);
        const data = await res.json();
        if (data.html_content) setSelectedBriefing(data);
      } catch {
        // ignore
      } finally {
        setLoadingDetail(false);
      }
    }
    fetchDetail();
  }, [selectedId]);

  const typeIcon = (type: string) =>
    type === 'morning' ? <Sun className="w-4 h-4 text-warning" /> : <BarChart3 className="w-4 h-4 text-primary" />;

  const typeLabel = (type: string) => (type === 'morning' ? 'Morning Briefing' : 'Weekly Report');

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-muted hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Zap className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold">Briefings</h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Filter tabs */}
        <div className="flex gap-2 mb-6">
          {(['all', 'morning', 'weekly'] as const).map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setSelectedId(null); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted hover:text-foreground hover:bg-card'
              }`}
            >
              {f === 'all' ? 'All' : f === 'morning' ? 'Morning' : 'Weekly'}
            </button>
          ))}
        </div>

        {selectedBriefing ? (
          /* Detail view */
          <div>
            <button
              onClick={() => setSelectedId(null)}
              className="flex items-center gap-1 text-sm text-muted hover:text-foreground mb-4 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to list
            </button>
            <div className="flex items-center gap-2 mb-4">
              {typeIcon(selectedBriefing.briefing_type)}
              <h2 className="text-lg font-semibold">{typeLabel(selectedBriefing.briefing_type)}</h2>
              <span className="text-sm text-muted ml-2">
                {format(new Date(selectedBriefing.generated_at), 'EEEE, MMM d, yyyy h:mm a')}
              </span>
            </div>
            <div
              className="bg-card rounded-xl border border-border overflow-hidden"
              style={{ maxHeight: 'calc(100vh - 200px)', overflow: 'auto' }}
            >
              <iframe
                srcDoc={selectedBriefing.html_content}
                className="w-full border-0"
                style={{ minHeight: '80vh' }}
                title="Briefing content"
              />
            </div>
          </div>
        ) : loadingDetail ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          </div>
        ) : briefings.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center">
            <FileText className="w-12 h-12 text-muted/30 mb-3" />
            <p className="text-muted">No briefings generated yet.</p>
            <p className="text-xs text-muted/60 mt-1">
              Briefings are generated automatically — morning briefings on weekdays, weekly reports on Mondays.
            </p>
          </div>
        ) : (
          /* List view */
          <div className="space-y-2">
            {briefings.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedId(b.id)}
                className="w-full bg-card rounded-xl border border-border p-4 flex items-center gap-4 hover:bg-card-hover hover:border-border-hover transition-all text-left"
              >
                <div className="flex-shrink-0">
                  {typeIcon(b.briefing_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {typeLabel(b.briefing_type)}
                  </p>
                  <p className="text-xs text-muted">
                    {format(new Date(b.generated_at), 'EEEE, MMM d, yyyy')} &middot;{' '}
                    {formatDistanceToNow(new Date(b.generated_at), { addSuffix: true })}
                  </p>
                </div>
                {b.summary && (
                  <div className="hidden sm:flex items-center gap-3 text-xs text-muted">
                    {b.briefing_type === 'morning' && (
                      <>
                        {(b.summary as Record<string, number>).overdue_count > 0 && (
                          <span className="text-danger">{(b.summary as Record<string, number>).overdue_count} overdue</span>
                        )}
                        <span>{(b.summary as Record<string, number>).events_count || 0} events</span>
                      </>
                    )}
                    {b.briefing_type === 'weekly' && (
                      <>
                        <span>{(b.summary as Record<string, number>).sessions_count || 0} sessions</span>
                        <span>{(b.summary as Record<string, number>).commitments_completed || 0} completed</span>
                      </>
                    )}
                  </div>
                )}
                <ChevronRight className="w-4 h-4 text-muted flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
