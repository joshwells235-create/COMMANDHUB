'use client';

import { useState, useMemo } from 'react';
import { Zap, ArrowLeft, Inbox, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useReviewQueue } from '@/lib/hooks/use-review-queue';
import { EmailReviewCard } from '@/components/review/email-review-card';
import type { ReviewEmail } from '@/types/database';

interface ThreadGroup {
  conversationId: string | null;
  emails: ReviewEmail[];
}

function EmailThread({
  group,
  acceptAll,
  acceptSelected,
  dismiss,
}: {
  group: ThreadGroup;
  acceptAll: (emailId: string, edits?: Record<number, { title?: string; commitment_type?: string; suggested_due?: string | null }>) => void;
  acceptSelected: (emailId: string, indices: number[], edits?: Record<number, { title?: string; commitment_type?: string; suggested_due?: string | null }>) => void;
  dismiss: (emailId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Single email (no thread) - render as-is
  if (group.emails.length === 1) {
    return (
      <EmailReviewCard
        email={group.emails[0]}
        onAcceptAll={acceptAll}
        onAcceptSelected={acceptSelected}
        onDismiss={dismiss}
      />
    );
  }

  // Thread: sorted chronologically (oldest first), latest is last
  const sorted = [...group.emails].sort(
    (a, b) => new Date(a.received_at).getTime() - new Date(b.received_at).getTime()
  );
  const latest = sorted[sorted.length - 1];
  const older = sorted.slice(0, -1);

  return (
    <div className="rounded-lg border border-primary/20 bg-card/50 overflow-hidden">
      {/* Thread indicator header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-primary/80 hover:text-primary hover:bg-primary/5 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
        <MessageSquare className="w-3.5 h-3.5" />
        <span>{group.emails.length} messages in thread</span>
      </button>

      {/* Expanded older messages */}
      {expanded && (
        <div className="border-l-2 border-primary/30 ml-4 mr-2 mb-1">
          {older.map((email) => (
            <EmailReviewCard
              key={email.id}
              email={email}
              onAcceptAll={acceptAll}
              onAcceptSelected={acceptSelected}
              onDismiss={dismiss}
              compact
            />
          ))}
        </div>
      )}

      {/* Latest message - always shown in full */}
      <div className={expanded ? 'border-t border-border' : ''}>
        <EmailReviewCard
          email={latest}
          onAcceptAll={acceptAll}
          onAcceptSelected={acceptSelected}
          onDismiss={dismiss}
        />
      </div>
    </div>
  );
}

export default function ReviewPage() {
  const { emails, loading, error, acceptAll, acceptSelected, dismiss } =
    useReviewQueue();

  // Group emails by conversation_id
  const threadGroups = useMemo(() => {
    const groupMap = new Map<string, ReviewEmail[]>();
    const standalone: ReviewEmail[] = [];

    for (const email of emails) {
      if (email.conversation_id) {
        const existing = groupMap.get(email.conversation_id);
        if (existing) {
          existing.push(email);
        } else {
          groupMap.set(email.conversation_id, [email]);
        }
      } else {
        standalone.push(email);
      }
    }

    const groups: ThreadGroup[] = [];

    // Add threaded groups sorted by most recent email in each thread
    for (const [conversationId, threadEmails] of groupMap) {
      groups.push({ conversationId, emails: threadEmails });
    }

    // Add standalone emails
    for (const email of standalone) {
      groups.push({ conversationId: null, emails: [email] });
    }

    // Sort groups by most recent email (descending)
    groups.sort((a, b) => {
      const aLatest = Math.max(...a.emails.map((e) => new Date(e.received_at).getTime()));
      const bLatest = Math.max(...b.emails.map((e) => new Date(e.received_at).getTime()));
      return bLatest - aLatest;
    });

    return groups;
  }, [emails]);

  const threadCount = threadGroups.filter((g) => g.emails.length > 1).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted">
          <Zap className="w-5 h-5 text-primary animate-pulse" />
          <span>Loading review queue...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl header-gradient-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary pulse-alive" />
            <h1 className="text-lg font-bold tracking-tight text-gradient">COMMAND HUB</h1>
          </div>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4 pb-24">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Inbox Review ({emails.length} items)
          </h2>
          {threadCount > 0 && (
            <span className="text-xs text-muted/70">
              {threadCount} conversation{threadCount !== 1 ? 's' : ''} threaded
            </span>
          )}
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {emails.length === 0 && !error ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted">
            <Inbox className="w-12 h-12 mb-3 text-muted/40" />
            <p className="text-sm">No emails to review. You&apos;re caught up.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {threadGroups.map((group) => (
              <EmailThread
                key={group.conversationId ?? group.emails[0].id}
                group={group}
                acceptAll={acceptAll}
                acceptSelected={acceptSelected}
                dismiss={dismiss}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
