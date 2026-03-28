'use client';

import { useState } from 'react';
import {
  X,
  Loader2,
  Copy,
  RefreshCw,
  Mail,
  FileText,
  Handshake,
  PenLine,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type DraftType = 'follow_up_email' | 'session_summary' | 'proposal_intro' | 'general';

interface DraftComposerProps {
  orgId?: string;
  commitmentId?: string;
  defaultType?: DraftType;
  onClose?: () => void;
}

const draftTypes: { value: DraftType; label: string; icon: React.ReactNode }[] = [
  { value: 'follow_up_email', label: 'Follow-Up', icon: <Mail className="w-3.5 h-3.5" /> },
  { value: 'session_summary', label: 'Summary', icon: <FileText className="w-3.5 h-3.5" /> },
  { value: 'proposal_intro', label: 'Proposal', icon: <Handshake className="w-3.5 h-3.5" /> },
  { value: 'general', label: 'General', icon: <PenLine className="w-3.5 h-3.5" /> },
];

export function DraftComposer({
  orgId,
  commitmentId,
  defaultType = 'follow_up_email',
  onClose,
}: DraftComposerProps) {
  const [draftType, setDraftType] = useState<DraftType>(defaultType);
  const [context, setContext] = useState('');
  const [draft, setDraft] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!context.trim() && !commitmentId) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draft_type: draftType,
          context: context.trim(),
          org_id: orgId,
          commitment_id: commitmentId,
        }),
      });
      if (!res.ok) {
        throw new Error('Failed to generate draft');
      }
      const data = await res.json();
      setDraft(data.draft || data.content || '');
    } catch (err) {
      console.error('Draft generation failed:', err);
      setError('Failed to generate draft. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for clipboard API failures
      const textarea = document.createElement('textarea');
      textarea.value = draft;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleRegenerate() {
    setDraft('');
    handleGenerate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-lg mx-auto bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Draft Composer
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Draft Type Selector */}
          <div>
            <label className="text-xs font-semibold text-muted uppercase tracking-wider mb-2 block">
              Draft Type
            </label>
            <div className="flex flex-wrap gap-2">
              {draftTypes.map((type) => (
                <button
                  key={type.value}
                  onClick={() => setDraftType(type.value)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                    draftType === type.value
                      ? 'bg-primary text-white'
                      : 'bg-background text-muted hover:text-foreground hover:bg-card-hover'
                  )}
                >
                  {type.icon}
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Context Input */}
          {!draft && (
            <>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wider mb-2 block">
                  Context
                </label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="What do you want to draft?"
                  rows={4}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>

              {error && (
                <p className="text-sm text-danger">{error}</p>
              )}

              <button
                onClick={handleGenerate}
                disabled={generating || (!context.trim() && !commitmentId)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <PenLine className="w-4 h-4" />
                    Generate Draft
                  </>
                )}
              </button>
            </>
          )}

          {/* Generated Draft */}
          {draft && (
            <>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wider mb-2 block">
                  Generated Draft
                </label>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={12}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y leading-relaxed"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-success/20 text-success rounded-lg text-sm font-medium hover:bg-success/30 transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy to Clipboard
                    </>
                  )}
                </button>
                <button
                  onClick={handleRegenerate}
                  disabled={generating}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-warning/20 text-warning rounded-lg text-sm font-medium hover:bg-warning/30 transition-colors disabled:opacity-50"
                >
                  {generating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  Regenerate
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
