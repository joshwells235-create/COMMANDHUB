'use client';

import { useState, useRef, useCallback } from 'react';
import { ArrowLeft, Zap, Upload, FileText, Loader2, CheckCircle, X, Plus } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useOrganizations } from '@/lib/hooks/use-organizations';

const TRANSCRIPT_TYPES = [
  { value: 'coaching_session', label: 'Coaching / 1:1 Session' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'client_meeting', label: 'Client Meeting' },
  { value: 'partnership_meeting', label: 'Partnership Meeting' },
  { value: 'internal', label: 'Internal' },
  { value: 'vistage', label: 'Vistage' },
  { value: 'other', label: 'Other' },
];

export default function TranscriptsPage() {
  const { organizations, refresh: refreshOrgs } = useOrganizations();
  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState('');
  const [showNewOrg, setShowNewOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [orgId, setOrgId] = useState('');
  const [transcriptDate, setTranscriptDate] = useState('');
  const [transcriptType, setTranscriptType] = useState('coaching_session');
  const [participants, setParticipants] = useState('');
  const [duration, setDuration] = useState('');
  const [title, setTitle] = useState('');
  const [engagement, setEngagement] = useState('');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ summary: string } | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    if (file.name.endsWith('.txt') || file.name.endsWith('.md') || file.type === 'text/plain') {
      const reader = new FileReader();
      reader.onload = (e) => {
        setRawText(e.target?.result as string);
      };
      reader.readAsText(file);
    } else {
      setFileName(`${file.name} (paste text content below - only .txt files can be read directly)`);
    }
  }, []);

  const clearFile = useCallback(() => {
    setFileName('');
    setRawText('');
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleSubmit = async () => {
    if (!rawText.trim() || !orgId || !transcriptDate) {
      setError('Text, organization, and date are required.');
      return;
    }

    setProcessing(true);
    setError('');
    setResult(null);

    try {
      // Create transcript record
      const createRes = await fetch('/api/transcripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title || `${transcriptType} - ${transcriptDate}`,
          org_id: orgId,
          engagement_name: engagement || null,
          transcript_date: transcriptDate,
          transcript_type: transcriptType,
          participants: participants
            ? participants.split(',').map((p) => p.trim())
            : [],
          duration_minutes: duration ? parseInt(duration) : null,
          raw_text: rawText,
        }),
      });

      if (!createRes.ok) {
        const errData = await createRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to create transcript');
      }
      const createData = await createRes.json();
      const transcriptId = createData.transcript?.id || createData.id;

      // Trigger AI processing (can take 1-3 min for long transcripts)
      const processRes = await fetch('/api/transcripts/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript_id: transcriptId }),
        signal: AbortSignal.timeout(300_000), // 5 min client timeout
      });

      if (!processRes.ok) {
        const errData = await processRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Processing failed');
      }
      const processResult = await processRes.json();

      setResult({ summary: processResult.summary || processResult.extraction?.summary || 'Processing complete.' });
      toast.success('Transcript processed successfully');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
      toast.error(msg);
    } finally {
      setProcessing(false);
    }
  };

  if (result) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl header-gradient-border">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
            <Link href="/" className="text-muted hover:text-foreground">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold tracking-tight">COMMAND HUB</h1>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-4 py-8">
          <div className="bg-card rounded-xl p-6 text-center space-y-4">
            <CheckCircle className="w-12 h-12 text-success mx-auto" />
            <h2 className="text-lg font-semibold">Transcript Processed</h2>
            <p className="text-sm text-muted leading-relaxed">{result.summary}</p>
            <div className="flex gap-2 justify-center pt-2">
              <Link
                href={orgId ? `/clients/${orgId}` : '/clients'}
                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors"
              >
                View Client
              </Link>
              <button
                onClick={() => {
                  setResult(null);
                  setRawText('');
                  setFileName('');
                  setTitle('');
                  setEngagement('');
                }}
                className="px-4 py-2 bg-card-hover text-foreground rounded-lg text-sm font-medium transition-colors"
              >
                Upload Another
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-muted hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <Zap className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold tracking-tight">COMMAND HUB</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4 pb-24">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          Upload Transcript
        </h2>

        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-primary bg-primary/10'
              : 'border-border hover:border-muted'
          }`}
        >
          <Upload className="w-8 h-8 text-muted mx-auto mb-2" />
          {fileName ? (
            <div className="flex items-center justify-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              <p className="text-sm text-primary font-medium">{fileName}</p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearFile();
                }}
                className="text-muted hover:text-foreground p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted">
                Drop a file here, or click to select
              </p>
              <p className="text-xs text-muted/50 mt-1">.txt, .md, .docx, .pdf</p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.text,.docx,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>

        {/* Or paste */}
        <div>
          <label className="text-xs text-muted block mb-1">
            Or paste transcript text directly
          </label>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste transcript text here..."
            rows={8}
            className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm placeholder:text-muted/50 focus:outline-none focus:border-primary resize-y"
          />
          {rawText && (
            <p className="text-xs text-muted mt-1">
              {rawText.split(/\s+/).filter(Boolean).length} words
            </p>
          )}
        </div>

        {/* Form fields */}
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted block mb-1">Title (optional)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Caryn Session 3"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-muted block mb-1">Engagement (optional)</label>
            <input
              type="text"
              value={engagement}
              onChange={(e) => setEngagement(e.target.value)}
              placeholder="e.g. Leadership Development Program 2026"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">
                Organization <span className="text-danger">*</span>
              </label>
              {showNewOrg ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    placeholder="New org name..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setShowNewOrg(false);
                        setNewOrgName('');
                      }
                    }}
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    disabled={!newOrgName.trim() || creatingOrg}
                    onClick={async () => {
                      setCreatingOrg(true);
                      try {
                        const res = await fetch('/api/organizations', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ name: newOrgName.trim(), status: 'prospect' }),
                        });
                        if (!res.ok) throw new Error('Failed to create');
                        const newOrg = await res.json();
                        refreshOrgs();
                        setOrgId(newOrg.id);
                        setShowNewOrg(false);
                        setNewOrgName('');
                      } catch {
                        setError('Failed to create organization');
                      } finally {
                        setCreatingOrg(false);
                      }
                    }}
                    className="px-3 py-2 btn-gradient rounded-lg text-xs font-medium disabled:opacity-50"
                  >
                    {creatingOrg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Add'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowNewOrg(false); setNewOrgName(''); }}
                    className="px-2 py-2 text-muted hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={orgId}
                    onChange={(e) => setOrgId(e.target.value)}
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Select org...</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowNewOrg(true)}
                    className="flex items-center gap-1 px-2.5 py-2 text-primary hover:bg-primary/10 rounded-lg text-xs font-medium transition-colors"
                    title="Add new organization"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-muted block mb-1">
                Date <span className="text-danger">*</span>
              </label>
              <input
                type="date"
                value={transcriptDate}
                onChange={(e) => setTranscriptDate(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">Type</label>
              <select
                value={transcriptType}
                onChange={(e) => setTranscriptType(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
              >
                {TRANSCRIPT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-muted block mb-1">Duration (min)</label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="60"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted block mb-1">
              Participants (comma-separated)
            </label>
            <input
              type="text"
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
              placeholder="Josh, Caryn"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={processing || !rawText.trim()}
          className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-lg py-3 text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {processing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing transcript (this may take a minute)...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              Upload &amp; Process
            </>
          )}
        </button>
      </main>
    </div>
  );
}
