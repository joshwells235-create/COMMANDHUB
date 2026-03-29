'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Zap,
  Loader2,
  Replace,
  Check,
  X,
  FileText,
  Calendar,
  Building2,
  RefreshCw,
  Pencil,
  Save,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface TranscriptData {
  id: string;
  title: string;
  org_id: string | null;
  transcript_date: string;
  transcript_type: string;
  duration_minutes: number | null;
  participants: unknown;
  raw_text: string;
  summary: string | null;
  is_processed: boolean;
  organizations?: { id: string; name: string } | null;
}

export default function TranscriptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const transcriptId = params.id as string;

  const [transcript, setTranscript] = useState<TranscriptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Find & Replace state
  const [showReplace, setShowReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [replaceResult, setReplaceResult] = useState<string | null>(null);

  // Reprocess state
  const [reprocessing, setReprocessing] = useState(false);

  // Metadata edit state
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaFields, setMetaFields] = useState({ title: '', transcript_date: '', transcript_type: '' });
  const [savingMeta, setSavingMeta] = useState(false);

  function startEditingMeta() {
    if (!transcript) return;
    setMetaFields({
      title: transcript.title,
      transcript_date: transcript.transcript_date.split('T')[0],
      transcript_type: transcript.transcript_type,
    });
    setEditingMeta(true);
  }

  async function saveMetaEdit() {
    setSavingMeta(true);
    try {
      const res = await fetch(`/api/transcripts/${transcriptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metaFields),
      });
      if (!res.ok) { toast.error('Failed to save'); throw new Error('Failed to save'); }
      const data = await res.json();
      toast.success('Transcript updated');
      setTranscript((prev) => prev ? { ...prev, ...metaFields, ...(data.transcript || {}) } : prev);
      setEditingMeta(false);
    } catch {
      // stay in edit mode
    } finally {
      setSavingMeta(false);
    }
  }

  useEffect(() => {
    if (!transcriptId) return;

    async function fetchTranscript() {
      try {
        const res = await fetch(`/api/transcripts/${transcriptId}`);
        if (!res.ok) throw new Error('Failed to load transcript');
        const data = await res.json();
        setTranscript(data.transcript);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }

    fetchTranscript();
  }, [transcriptId]);

  async function handleReplace() {
    if (!findText) return;
    setReplacing(true);
    setReplaceResult(null);

    try {
      const res = await fetch(`/api/transcripts/${transcriptId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          find_replace: { find: findText, replace: replaceText },
        }),
      });

      if (!res.ok) throw new Error('Replace failed');
      const data = await res.json();

      const msg = `Replaced ${data.replacements} occurrence${data.replacements !== 1 ? 's' : ''}`;
      setReplaceResult(msg + `, ${data.chunks_updated} search chunk${data.chunks_updated !== 1 ? 's' : ''} updated`);
      toast.success(msg);

      // Refresh the transcript to show updated text
      if (data.transcript?.raw_text) {
        setTranscript((prev) => prev ? { ...prev, raw_text: data.transcript.raw_text } : prev);
      }
    } catch (err) {
      setReplaceResult('Failed to replace — try again');
    } finally {
      setReplacing(false);
    }
  }

  async function handleReprocess() {
    setReprocessing(true);
    try {
      const res = await fetch('/api/transcripts/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript_id: transcriptId }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error('Reprocess failed');
      // Refresh
      const refreshRes = await fetch(`/api/transcripts/${transcriptId}`);
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        setTranscript(data.transcript);
      }
    } catch {
      // silent — the UI will still show the old data
    } finally {
      setReprocessing(false);
    }
  }

  // Count occurrences for preview
  const matchCount = findText && transcript
    ? (transcript.raw_text.split(findText).length - 1)
    : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
          <span>Loading transcript...</span>
        </div>
      </div>
    );
  }

  if (error || !transcript) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <p className="text-muted">{error || 'Transcript not found'}</p>
          <button onClick={() => router.back()} className="text-primary text-sm hover:underline">
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl header-gradient-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="text-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-bold tracking-tight">COMMAND HUB</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowReplace(!showReplace)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                showReplace
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted hover:text-foreground hover:bg-card'
              }`}
            >
              <Replace className="w-4 h-4" />
              Find & Replace
            </button>
          </div>
        </div>
      </header>

      {/* Find & Replace Panel */}
      {showReplace && (
        <div className="sticky top-[53px] z-20 bg-card border-b border-border">
          <div className="max-w-3xl mx-auto px-4 py-3 space-y-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="text"
                  value={findText}
                  onChange={(e) => { setFindText(e.target.value); setReplaceResult(null); }}
                  placeholder="Find (e.g. misspelled name)..."
                  autoFocus
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div className="flex-1">
                <input
                  type="text"
                  value={replaceText}
                  onChange={(e) => { setReplaceText(e.target.value); setReplaceResult(null); }}
                  placeholder="Replace with..."
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <button
                onClick={handleReplace}
                disabled={!findText || replacing || matchCount === 0}
                className="flex items-center gap-1.5 px-4 py-2 btn-gradient rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {replacing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Replace All
              </button>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">
                {findText
                  ? `${matchCount} match${matchCount !== 1 ? 'es' : ''} found`
                  : 'Type to search transcript text'
                }
              </span>
              {replaceResult && (
                <span className="text-success">{replaceResult}</span>
              )}
            </div>
          </div>
        </div>
      )}

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4 pb-24">
        {/* Transcript Info */}
        <div className="premium-card p-5">
          {editingMeta ? (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-muted uppercase tracking-wide">Title</label>
                <input
                  type="text"
                  value={metaFields.title}
                  onChange={(e) => setMetaFields({ ...metaFields, title: e.target.value })}
                  className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-muted uppercase tracking-wide">Date</label>
                  <input
                    type="date"
                    value={metaFields.transcript_date}
                    onChange={(e) => setMetaFields({ ...metaFields, transcript_date: e.target.value })}
                    className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted uppercase tracking-wide">Type</label>
                  <select
                    value={metaFields.transcript_type}
                    onChange={(e) => setMetaFields({ ...metaFields, transcript_type: e.target.value })}
                    className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm"
                  >
                    <option value="coaching_session">Coaching Session</option>
                    <option value="workshop">Workshop</option>
                    <option value="client_meeting">Client Meeting</option>
                    <option value="partnership_meeting">Partnership Meeting</option>
                    <option value="internal">Internal</option>
                    <option value="vistage">Vistage</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={saveMetaEdit}
                  disabled={savingMeta || !metaFields.title.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 btn-gradient text-white rounded-md text-xs font-medium disabled:opacity-50"
                >
                  {savingMeta ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Save
                </button>
                <button
                  onClick={() => setEditingMeta(false)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-card-hover text-muted rounded-md text-xs font-medium hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-lg font-bold">{transcript.title}</h2>
                <button
                  onClick={startEditingMeta}
                  className="flex-shrink-0 p-1.5 text-muted hover:text-primary transition-colors rounded-md hover:bg-card"
                  title="Edit metadata"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted mt-2">
                {transcript.organizations && (
                  <Link
                    href={`/clients/${transcript.org_id}`}
                    className="flex items-center gap-1 text-primary hover:underline"
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    {transcript.organizations.name}
                  </Link>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {format(new Date(transcript.transcript_date), 'MMM d, yyyy')}
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="w-3.5 h-3.5" />
                  {transcript.transcript_type}
                </span>
                {transcript.duration_minutes && (
                  <span>{transcript.duration_minutes} min</span>
                )}
              </div>
              {transcript.summary && (
                <p className="text-sm text-foreground-secondary mt-3 leading-relaxed">
                  {transcript.summary}
                </p>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleReprocess}
            disabled={reprocessing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted hover:text-foreground hover:bg-card rounded-lg transition-colors disabled:opacity-50"
          >
            {reprocessing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {reprocessing ? 'Reprocessing...' : 'Reprocess with AI'}
          </button>
        </div>

        {/* Raw Text */}
        <div>
          <h3 className="section-title mb-3">Full Transcript</h3>
          <div className="bg-card rounded-lg border border-border p-5">
            <pre className="text-sm text-foreground leading-relaxed whitespace-pre-wrap font-sans">
              {findText
                ? highlightMatches(transcript.raw_text, findText)
                : transcript.raw_text
              }
            </pre>
          </div>
        </div>
      </main>
    </div>
  );
}

/** Highlight find matches in yellow */
function highlightMatches(text: string, find: string): React.ReactNode {
  if (!find) return text;
  const parts = text.split(find);
  if (parts.length <= 1) return text;

  return parts.map((part, i) => (
    <span key={i}>
      {part}
      {i < parts.length - 1 && (
        <mark className="bg-warning/30 text-warning rounded px-0.5">{find}</mark>
      )}
    </span>
  ));
}
