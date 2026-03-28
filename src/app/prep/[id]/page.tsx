'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  MessageCircleQuestion,
  Eye,
  Users,
  TrendingUp,
  TrendingDown,
  Minus,
  HelpCircle,
  ListChecks,
  Clock,
} from 'lucide-react';

interface PrepData {
  org_name: string;
  org_status: string;
  strategic_value: string;
  last_session_date: string | null;
  contacts: Array<{ name: string; role: string | null }>;
  prep: {
    last_session_recap: string;
    open_items: string[];
    what_theyre_avoiding: string;
    mood_trajectory: 'improving' | 'stable' | 'declining' | 'unknown';
    provocative_question: string;
    watch_for: string;
    relationship_context: string;
  };
}

function MoodIcon({ mood }: { mood: string }) {
  switch (mood) {
    case 'improving':
      return <TrendingUp className="w-4 h-4 text-green-400" />;
    case 'declining':
      return <TrendingDown className="w-4 h-4 text-red-400" />;
    case 'stable':
      return <Minus className="w-4 h-4 text-blue-400" />;
    default:
      return <HelpCircle className="w-4 h-4 text-muted" />;
  }
}

function moodLabel(mood: string) {
  switch (mood) {
    case 'improving':
      return 'Improving';
    case 'declining':
      return 'Declining';
    case 'stable':
      return 'Stable';
    default:
      return 'Unknown';
  }
}

function moodColor(mood: string) {
  switch (mood) {
    case 'improving':
      return 'text-green-400';
    case 'declining':
      return 'text-red-400';
    case 'stable':
      return 'text-blue-400';
    default:
      return 'text-muted';
  }
}

export default function PrepModePage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.id as string;

  const [data, setData] = useState<PrepData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;

    async function fetchPrep() {
      try {
        const res = await fetch(`/api/prep?org_id=${orgId}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to load prep');
        }
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load prep');
      } finally {
        setLoading(false);
      }
    }

    fetchPrep();
  }, [orgId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted">Preparing your brief...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-warning mx-auto" />
          <p className="text-sm text-muted">{error || 'Something went wrong'}</p>
          <button
            onClick={() => router.back()}
            className="text-sm text-primary hover:underline"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  const { prep, contacts } = data;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-muted hover:text-foreground transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-2">
            <MoodIcon mood={prep.mood_trajectory} />
            <span className={`text-xs font-medium ${moodColor(prep.mood_trajectory)}`}>
              {moodLabel(prep.mood_trajectory)}
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 px-4 py-5 max-w-2xl mx-auto w-full">
        {/* Client Name */}
        <div className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight">{data.org_name}</h1>
          <p className="text-xs text-muted mt-1">
            {data.org_status} &middot; {data.strategic_value} value
          </p>
        </div>

        {/* Two-column grid on larger screens */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          {/* Last Session */}
          <div className="bg-card rounded-lg p-4 border border-border/50">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-muted" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Last Session
              </h2>
            </div>
            {data.last_session_date && (
              <p className="text-xs text-muted mb-2">{data.last_session_date}</p>
            )}
            <p className="text-sm leading-relaxed">{prep.last_session_recap}</p>
          </div>

          {/* Open Items */}
          <div className="bg-card rounded-lg p-4 border border-border/50">
            <div className="flex items-center gap-2 mb-2">
              <ListChecks className="w-4 h-4 text-muted" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Open Items
              </h2>
            </div>
            {prep.open_items.length > 0 ? (
              <ul className="space-y-1.5">
                {prep.open_items.map((item, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="text-primary mt-0.5 flex-shrink-0">&bull;</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No open items</p>
            )}
          </div>
        </div>

        {/* The Ask - what they're avoiding */}
        <div className="bg-amber-950/30 border border-amber-700/40 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              What They&apos;re Avoiding
            </h2>
          </div>
          <p className="text-sm text-amber-100 leading-relaxed">
            {prep.what_theyre_avoiding}
          </p>
        </div>

        {/* Your Question */}
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <MessageCircleQuestion className="w-4 h-4 text-primary" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-primary">
              Your Question
            </h2>
          </div>
          <p className="text-lg font-medium text-foreground leading-snug">
            &ldquo;{prep.provocative_question}&rdquo;
          </p>
        </div>

        {/* Watch For */}
        <div className="bg-card rounded-lg p-4 border border-border/50 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Eye className="w-4 h-4 text-muted" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Watch For
            </h2>
          </div>
          <p className="text-sm text-muted leading-relaxed">{prep.watch_for}</p>
        </div>

        {/* Contacts */}
        {contacts.length > 0 && (
          <div className="bg-card rounded-lg p-4 border border-border/50">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-muted" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Contacts
              </h2>
            </div>
            <div className="flex flex-wrap gap-3">
              {contacts.map((c, i) => (
                <div key={i} className="text-sm">
                  <span className="font-medium">{c.name}</span>
                  {c.role && (
                    <span className="text-muted ml-1">({c.role})</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Bottom link to full client detail */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t border-border px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <Link
            href={`/clients/${orgId}`}
            className="block text-center text-xs text-muted hover:text-foreground transition-colors"
          >
            View full client detail &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
