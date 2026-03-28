'use client';

import { Zap, ArrowLeft, Inbox } from 'lucide-react';
import Link from 'next/link';
import { useReviewQueue } from '@/lib/hooks/use-review-queue';
import { EmailReviewCard } from '@/components/review/email-review-card';

export default function ReviewPage() {
  const { emails, loading, error, acceptAll, acceptSelected, dismiss } =
    useReviewQueue();

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
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold tracking-tight">COMMAND HUB</h1>
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
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Inbox Review ({emails.length} items)
        </h2>

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
            {emails.map((email) => (
              <EmailReviewCard
                key={email.id}
                email={email}
                onAcceptAll={acceptAll}
                onAcceptSelected={acceptSelected}
                onDismiss={dismiss}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
