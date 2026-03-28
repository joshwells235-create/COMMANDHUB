'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Zap,
  ArrowLeft,
  Building2,
  Star,
  TrendingUp,
  Check,
  Clock,
  X,
  Search,
  User,
  FileText,
  Calendar,
  MessageSquare,
  Brain,
  Lightbulb,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
  PenLine,
  Pencil,
  Save,
} from 'lucide-react';
import { useClientDetail } from '@/lib/hooks/use-client-detail';
import type { Transcript, TranscriptTheme, LanguageLeak } from '@/lib/hooks/use-client-detail';
import {
  cn,
  getDueLabel,
  getCommitmentTypeLabel,
  getCommitmentTypeColor,
  getEscalationIndicator,
} from '@/lib/utils';
import { SnoozePicker } from '@/components/ui/snooze-picker';
import { DraftComposer } from '@/components/drafts/draft-composer';
import { format, formatDistanceToNow } from 'date-fns';

export default function ClientDetailPage() {
  const params = useParams();
  const orgId = params.id as string;
  const {
    organization,
    commitments,
    completedCommitments,
    contacts,
    transcripts,
    loading,
    error,
    refresh,
  } = useClientDetail(orgId);

  const [showDraft, setShowDraft] = useState(false);
  const [expandedCommitment, setExpandedCommitment] = useState<string | null>(null);
  const [snoozeTarget, setSnoozeTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editFields, setEditFields] = useState({
    name: '',
    status: '',
    strategic_value: '',
    industry: '',
    notes: '',
  });

  const startEditing = () => {
    if (!organization) return;
    setEditFields({
      name: organization.name,
      status: organization.status,
      strategic_value: organization.strategic_value,
      industry: organization.industry || '',
      notes: organization.notes || '',
    });
    setEditing(true);
  };

  const saveEdits = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/organizations/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editFields),
      });
      if (!res.ok) throw new Error('Failed to save');
      setEditing(false);
      refresh();
    } catch {
      // stay in edit mode on failure
    } finally {
      setSaving(false);
    }
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<{
    answer: string;
    sources: Array<{
      transcript_id: string;
      title: string;
      date: string;
      excerpt?: string;
      snippet?: string;
      transcript_title?: string;
      transcript_date?: string;
    }>;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [trajectoryData, setTrajectoryData] = useState<Record<string, unknown> | null>(null);
  const [trajectoryLoading, setTrajectoryLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    commitments: true,
    timeline: true,
    brief: true,
    trajectory: false,
    search: false,
    contacts: true,
  });

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  async function handleComplete(id: string) {
    await fetch(`/api/commitments/${id}/complete`, { method: 'POST' });
    refresh();
  }

  async function handleSnooze(id: string, date: string) {
    await fetch(`/api/commitments/${id}/snooze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snoozed_until: date }),
    });
    setSnoozeTarget(null);
    refresh();
  }

  async function handleCancel(id: string) {
    await fetch(`/api/commitments/${id}`, { method: 'DELETE' });
    refresh();
  }

  const [editingCommitmentId, setEditingCommitmentId] = useState<string | null>(null);
  const [commitEditFields, setCommitEditFields] = useState<Record<string, string | null>>({});
  const [commitSaving, setCommitSaving] = useState(false);

  function startEditingCommitment(c: { id: string; title: string; description: string | null; commitment_type: string; due_date: string | null; owner: string; other_party: string | null }) {
    setEditingCommitmentId(c.id);
    setCommitEditFields({
      title: c.title,
      description: c.description || '',
      commitment_type: c.commitment_type,
      due_date: c.due_date ? c.due_date.split('T')[0] : '',
      owner: c.owner,
      other_party: c.other_party || '',
    });
  }

  async function saveCommitmentEdit(id: string) {
    setCommitSaving(true);
    try {
      const res = await fetch(`/api/commitments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: commitEditFields.title,
          description: commitEditFields.description || null,
          commitment_type: commitEditFields.commitment_type,
          due_date: commitEditFields.due_date || null,
          owner: commitEditFields.owner,
          other_party: commitEditFields.other_party || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to update');
      setEditingCommitmentId(null);
      refresh();
    } catch {
      // stay in edit mode on error
    } finally {
      setCommitSaving(false);
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(searchQuery)}&org_id=${orgId}`
      );
      if (res.ok) {
        const data = await res.json();
        setSearchResult(data);
      }
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
    }
  }

  async function generateTrajectory() {
    setTrajectoryLoading(true);
    try {
      const res = await fetch(`/api/ai/longitudinal?org_id=${orgId}`);
      if (res.ok) {
        const data = await res.json();
        setTrajectoryData(data);
        setExpandedSections((prev) => ({ ...prev, trajectory: true }));
      }
    } catch (err) {
      console.error('Trajectory analysis failed:', err);
    } finally {
      setTrajectoryLoading(false);
    }
  }

  async function generateBriefing() {
    setBriefingLoading(true);
    try {
      const res = await fetch('/api/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId }),
      });
      if (res.ok) {
        const data = await res.json();
        setBriefing(data.briefing);
      }
    } catch (err) {
      console.error('Briefing generation failed:', err);
    } finally {
      setBriefingLoading(false);
    }
  }

  // Build relationship timeline
  const timelineEntries: Array<{
    date: string;
    type: 'transcript' | 'commitment';
    title: string;
    description?: string;
    id: string;
  }> = [];

  transcripts.forEach((t) => {
    timelineEntries.push({
      date: t.transcript_date,
      type: 'transcript',
      title: t.title || `${t.transcript_type || 'Session'} - ${format(new Date(t.transcript_date), 'MMM d, yyyy')}`,
      description: t.summary || undefined,
      id: t.id,
    });
  });

  completedCommitments.forEach((c) => {
    timelineEntries.push({
      date: c.completed_at || c.updated_at,
      type: 'commitment',
      title: c.title,
      description: `${getCommitmentTypeLabel(c.commitment_type)} completed`,
      id: c.id,
    });
  });

  timelineEntries.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Get most recent processed transcript for AI brief
  const latestTranscript = transcripts.find((t) => t.is_processed);

  const statusColor: Record<string, string> = {
    active: 'bg-success/20 text-success',
    paused: 'bg-warning/20 text-warning',
    prospect: 'bg-primary/20 text-primary',
    partner: 'bg-violet-500/20 text-violet-400',
    completed: 'bg-muted/20 text-muted',
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted">
          <Zap className="w-5 h-5 text-primary animate-pulse" />
          <span>Loading client intelligence...</span>
        </div>
      </div>
    );
  }

  if (error || !organization) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-danger mx-auto mb-3" />
          <p className="text-muted">{error || 'Organization not found'}</p>
          <Link href="/clients" className="text-primary text-sm mt-2 inline-block">
            Back to clients
          </Link>
        </div>
      </div>
    );
  }

  // Extract theme names from key_themes (handles both string[] and object[] formats)
  function getThemeNames(themes: TranscriptTheme[] | string[] | null): string[] {
    if (!themes) return [];
    return themes.map((t) => (typeof t === 'string' ? t : t.theme));
  }

  // Extract language leaks
  function getLanguageLeaks(transcript: Transcript): LanguageLeak[] {
    const insights = transcript.client_insights;
    if (!insights) return [];
    return insights.language_leaks_observed || [];
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl header-gradient-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/clients"
            className="text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold tracking-tight">COMMAND HUB</h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-24">
        {/* Organization Header */}
        <div className="premium-card p-5">
          {editing ? (
            /* ---- EDIT MODE ---- */
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted block mb-1">Name</label>
                <input
                  type="text"
                  value={editFields.name}
                  onChange={(e) => setEditFields({ ...editFields, name: e.target.value })}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted block mb-1">Status</label>
                  <select
                    value={editFields.status}
                    onChange={(e) => setEditFields({ ...editFields, status: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="prospect">Prospect</option>
                    <option value="partner">Partner</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Strategic Value</label>
                  <select
                    value={editFields.strategic_value}
                    onChange={(e) => setEditFields({ ...editFields, strategic_value: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="standard">Standard</option>
                    <option value="emerging">Emerging</option>
                    <option value="strategic">Strategic</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Industry</label>
                <input
                  type="text"
                  value={editFields.industry}
                  onChange={(e) => setEditFields({ ...editFields, industry: e.target.value })}
                  placeholder="e.g. Healthcare, Tech, Financial Services"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Notes</label>
                <textarea
                  value={editFields.notes}
                  onChange={(e) => setEditFields({ ...editFields, notes: e.target.value })}
                  rows={3}
                  placeholder="Key context, relationship notes..."
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-y"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={saveEdits}
                  disabled={saving || !editFields.name.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 btn-gradient rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="flex items-center gap-1.5 px-4 py-2 text-muted hover:text-foreground text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            /* ---- VIEW MODE ---- */
            <>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-muted" />
                  <h2 className="text-xl font-bold text-foreground">
                    {organization.name}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {organization.strategic_value === 'strategic' && (
                    <Star className="w-5 h-5 text-warning" />
                  )}
                  {organization.strategic_value === 'emerging' && (
                    <TrendingUp className="w-5 h-5 text-primary" />
                  )}
                  <button
                    onClick={startEditing}
                    className="p-1.5 text-muted hover:text-foreground hover:bg-card-hover rounded-md transition-colors"
                    title="Edit organization"
                  >
                    <PenLine className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-medium',
                    statusColor[organization.status] || 'bg-muted/20 text-muted'
                  )}
                >
                  {organization.status}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-card-hover text-muted font-medium">
                  {organization.strategic_value}
                </span>
                {organization.industry && (
                  <span className="text-xs text-muted">
                    {organization.industry}
                  </span>
                )}
              </div>
              {organization.notes && (
                <p className="text-sm text-muted mt-3">{organization.notes}</p>
              )}
              {(() => {
                const sessionComparison = latestTranscript?.ai_extraction?.session_comparison as
                  | { momentum?: { direction?: string } }
                  | undefined;
                const direction = sessionComparison?.momentum?.direction;
                if (!direction) return null;
                const colors: Record<string, string> = {
                  accelerating: 'bg-success/20 text-success',
                  steady: 'bg-primary/20 text-primary',
                  stalling: 'bg-warning/20 text-warning',
                  regressing: 'bg-danger/20 text-danger',
                };
                return (
                  <div className="flex items-center gap-2 mt-3">
                    <TrendingUp className="w-4 h-4 text-muted" />
                    <span
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full font-medium capitalize',
                        colors[direction] || 'bg-muted/20 text-muted'
                      )}
                    >
                      {direction}
                    </span>
                    <span className="text-xs text-muted">momentum</span>
                  </div>
                );
              })()}
            </>
          )}
        </div>

        {/* Prep Mode + Generate Briefing Buttons */}
        <div>
          <Link
            href={`/prep/${orgId}`}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-500/20 text-amber-400 rounded-lg font-medium text-sm hover:bg-amber-500/30 transition-colors mb-2"
          >
            <Zap className="w-4 h-4" />
            Prep Mode
          </Link>
          <button
            onClick={generateBriefing}
            disabled={briefingLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary/20 text-primary rounded-lg font-medium text-sm hover:bg-primary/30 transition-colors disabled:opacity-50"
          >
            {briefingLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {briefingLoading
              ? 'Generating Pre-Session Briefing...'
              : 'Generate Pre-Session Briefing'}
          </button>
          <button
            onClick={() => setShowDraft(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-card text-foreground rounded-lg font-medium text-sm hover:bg-card-hover transition-colors border border-border/50 mt-2"
          >
            <PenLine className="w-4 h-4 text-primary" />
            Draft Communication
          </button>
          {briefing && (
            <div className="mt-3 bg-card rounded-lg p-4 border border-primary/30">
              <h3 className="text-sm font-semibold text-primary mb-2 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" /> Pre-Session Briefing
              </h3>
              <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {briefing}
              </div>
            </div>
          )}
        </div>

        {/* Active Commitments */}
        <section>
          <button
            onClick={() => toggleSection('commitments')}
            className="w-full flex items-center justify-between mb-3"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Active Commitments ({commitments.length})
            </h2>
            {expandedSections.commitments ? (
              <ChevronDown className="w-4 h-4 text-muted" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted" />
            )}
          </button>

          {expandedSections.commitments && (
            <>
              {commitments.length === 0 ? (
                <p className="text-sm text-muted/60 py-3">
                  No open commitments for this client.
                </p>
              ) : (
                <div className="space-y-1">
                  {commitments.map((c) => {
                    const escalation = getEscalationIndicator(c.escalation_level);
                    const dueLabel = getDueLabel(c.due_date, c.status);
                    const isOverdue =
                      c.due_date && new Date(c.due_date) < new Date();
                    const isExpanded = expandedCommitment === c.id;

                    return (
                      <div
                        key={c.id}
                        className="bg-card rounded-lg hover:bg-card-hover transition-colors"
                      >
                        <button
                          onClick={() =>
                            setExpandedCommitment(isExpanded ? null : c.id)
                          }
                          className="w-full text-left px-4 py-3 flex items-start gap-3"
                        >
                          <div className="flex-shrink-0 mt-0.5">
                            {escalation ? (
                              <span className="text-danger font-bold text-xs">
                                {escalation}
                              </span>
                            ) : (
                              <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-muted/40" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium leading-tight truncate">
                              {c.title}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-muted">
                              {dueLabel && (
                                <span
                                  className={cn(
                                    isOverdue && 'text-danger'
                                  )}
                                >
                                  {dueLabel}
                                </span>
                              )}
                              {c.owner && (
                                <>
                                  {dueLabel && <span>&middot;</span>}
                                  <span>
                                    {c.owner === 'josh' ? 'Josh' : 'Client'}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <span
                            className={cn(
                              'text-xs mt-0.5 flex-shrink-0',
                              getCommitmentTypeColor(c.commitment_type)
                            )}
                          >
                            {getCommitmentTypeLabel(c.commitment_type)}
                          </span>
                        </button>

                        {isExpanded && editingCommitmentId !== c.id && (
                          <div className="px-4 pb-3">
                            {c.description && (
                              <p className="text-xs text-muted mb-2">
                                {c.description}
                              </p>
                            )}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleComplete(c.id)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-success/20 text-success rounded-md text-xs font-medium hover:bg-success/30"
                              >
                                <Check className="w-3 h-3" /> Done
                              </button>
                              <button
                                onClick={() => setSnoozeTarget(c.id)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-warning/20 text-warning rounded-md text-xs font-medium hover:bg-warning/30"
                              >
                                <Clock className="w-3 h-3" /> Snooze
                              </button>
                              <button
                                onClick={() => handleCancel(c.id)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-danger/20 text-danger rounded-md text-xs font-medium hover:bg-danger/30"
                              >
                                <X className="w-3 h-3" /> Cancel
                              </button>
                              <button
                                onClick={() => startEditingCommitment(c)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-primary/20 text-primary rounded-md text-xs font-medium hover:bg-primary/30 ml-auto"
                              >
                                <Pencil className="w-3 h-3" /> Edit
                              </button>
                            </div>
                          </div>
                        )}

                        {editingCommitmentId === c.id && (
                          <div className="px-4 pb-4 space-y-2">
                            <div>
                              <label className="text-[10px] text-muted uppercase tracking-wide">Title</label>
                              <input
                                type="text"
                                value={commitEditFields.title || ''}
                                onChange={(e) => setCommitEditFields({ ...commitEditFields, title: e.target.value })}
                                className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-muted uppercase tracking-wide">Description</label>
                              <textarea
                                value={commitEditFields.description || ''}
                                onChange={(e) => setCommitEditFields({ ...commitEditFields, description: e.target.value })}
                                rows={2}
                                className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary resize-y"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-muted uppercase tracking-wide">Type</label>
                                <select
                                  value={commitEditFields.commitment_type || ''}
                                  onChange={(e) => setCommitEditFields({ ...commitEditFields, commitment_type: e.target.value })}
                                  className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm"
                                >
                                  <option value="promise_made">Promise Made</option>
                                  <option value="ask_received">Ask Received</option>
                                  <option value="follow_up">Follow Up</option>
                                  <option value="waiting_on">Waiting On</option>
                                  <option value="deliverable">Deliverable</option>
                                  <option value="prep">Prep</option>
                                  <option value="internal">Internal</option>
                                  <option value="note_to_self">Note to Self</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-muted uppercase tracking-wide">Due Date</label>
                                <input
                                  type="date"
                                  value={commitEditFields.due_date || ''}
                                  onChange={(e) => setCommitEditFields({ ...commitEditFields, due_date: e.target.value })}
                                  className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm"
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-muted uppercase tracking-wide">Owner</label>
                                <select
                                  value={commitEditFields.owner || 'josh'}
                                  onChange={(e) => setCommitEditFields({ ...commitEditFields, owner: e.target.value })}
                                  className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm"
                                >
                                  <option value="josh">Josh</option>
                                  <option value="other">Other</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-muted uppercase tracking-wide">Other Party</label>
                                <input
                                  type="text"
                                  value={commitEditFields.other_party || ''}
                                  onChange={(e) => setCommitEditFields({ ...commitEditFields, other_party: e.target.value })}
                                  placeholder="Name..."
                                  className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm"
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                onClick={() => saveCommitmentEdit(c.id)}
                                disabled={commitSaving || !commitEditFields.title?.trim()}
                                className="flex items-center gap-1 px-3 py-1.5 btn-gradient text-white rounded-md text-xs font-medium disabled:opacity-50"
                              >
                                {commitSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                Save
                              </button>
                              <button
                                onClick={() => setEditingCommitmentId(null)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-card-hover text-muted rounded-md text-xs font-medium hover:text-foreground"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>

        {/* AI Client Brief */}
        {latestTranscript && (
          <section>
            <button
              onClick={() => toggleSection('brief')}
              className="w-full flex items-center justify-between mb-3"
            >
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                AI Client Brief
              </h2>
              {expandedSections.brief ? (
                <ChevronDown className="w-4 h-4 text-muted" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted" />
              )}
            </button>

            {expandedSections.brief && (
              <div className="bg-card rounded-lg p-4 border border-border/50 space-y-4">
                <div className="text-xs text-muted mb-2">
                  Based on: {latestTranscript.title || 'Latest session'} (
                  {format(new Date(latestTranscript.transcript_date), 'MMM d, yyyy')})
                </div>

                {/* Summary */}
                {latestTranscript.summary && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <Brain className="w-3.5 h-3.5" /> Summary
                    </h4>
                    <p className="text-sm text-foreground leading-relaxed">
                      {latestTranscript.summary}
                    </p>
                  </div>
                )}

                {/* Key Themes */}
                {latestTranscript.key_themes &&
                  latestTranscript.key_themes.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                        Key Themes
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {getThemeNames(latestTranscript.key_themes).map(
                          (theme, i) => (
                            <span
                              key={i}
                              className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary"
                            >
                              {theme}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  )}

                {/* Client Insights */}
                {latestTranscript.client_insights && (
                  <div className="space-y-2">
                    {latestTranscript.client_insights.breakthroughs && (
                      <div>
                        <h4 className="text-xs font-semibold text-success uppercase tracking-wider mb-1 flex items-center gap-1">
                          <Lightbulb className="w-3.5 h-3.5" /> Breakthroughs
                        </h4>
                        <p className="text-sm text-foreground">
                          {latestTranscript.client_insights.breakthroughs}
                        </p>
                      </div>
                    )}
                    {latestTranscript.client_insights.resistance_points && (
                      <div>
                        <h4 className="text-xs font-semibold text-warning uppercase tracking-wider mb-1">
                          Resistance Points
                        </h4>
                        <p className="text-sm text-foreground">
                          {latestTranscript.client_insights.resistance_points}
                        </p>
                      </div>
                    )}
                    {latestTranscript.client_insights.patterns_observed && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                          Patterns Observed
                        </h4>
                        <p className="text-sm text-foreground">
                          {latestTranscript.client_insights.patterns_observed}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Language Leaks */}
                {getLanguageLeaks(latestTranscript).length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-warning uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <MessageSquare className="w-3.5 h-3.5" /> Language Leaks
                    </h4>
                    <div className="space-y-2">
                      {getLanguageLeaks(latestTranscript).map((leak, i) => (
                        <div
                          key={i}
                          className="bg-background rounded p-2.5 text-sm"
                        >
                          <p className="text-foreground italic">
                            &ldquo;{leak.quote}&rdquo;
                          </p>
                          <p className="text-xs text-muted mt-1">
                            <span className="text-warning font-medium">
                              {leak.leak_type}
                            </span>{' '}
                            &mdash; {leak.interpretation}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommended Focus */}
                {latestTranscript.client_insights
                  ?.recommended_focus_next_session && (
                  <div className="bg-primary/10 rounded-lg p-3">
                    <h4 className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
                      Recommended Focus Next Session
                    </h4>
                    <p className="text-sm text-foreground">
                      {
                        latestTranscript.client_insights
                          .recommended_focus_next_session
                      }
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Session Trajectory */}
        <section>
          <button
            onClick={() => toggleSection('trajectory')}
            className="w-full flex items-center justify-between mb-3"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Session Trajectory
            </h2>
            {expandedSections.trajectory ? (
              <ChevronDown className="w-4 h-4 text-muted" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted" />
            )}
          </button>

          {expandedSections.trajectory && (
            <div className="space-y-3">
              {!trajectoryData && (
                <button
                  onClick={generateTrajectory}
                  disabled={trajectoryLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary/20 text-primary rounded-lg font-medium text-sm hover:bg-primary/30 transition-colors disabled:opacity-50"
                >
                  {trajectoryLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <TrendingUp className="w-4 h-4" />
                  )}
                  {trajectoryLoading
                    ? 'Generating Trajectory Analysis...'
                    : 'Generate Trajectory Analysis'}
                </button>
              )}

              {trajectoryData && (() => {
                const momentum = trajectoryData.momentum as { direction?: string; reasoning?: string } | undefined;
                const growthTrajectory = trajectoryData.growth_trajectory as string[] | undefined;
                const stalledAreas = trajectoryData.stalled_areas as Array<{ topic?: string; suggested_approach?: string }> | undefined;
                const droppedThreads = trajectoryData.dropped_threads as Array<{ item?: string; significance?: string }> | undefined;
                const commitmentFollowThrough = trajectoryData.commitment_follow_through as Array<{ commitment?: string; status?: string }> | undefined;
                const recommendedInterventions = trajectoryData.recommended_interventions as string[] | undefined;

                const momentumColors: Record<string, string> = {
                  accelerating: 'bg-success/20 text-success',
                  steady: 'bg-primary/20 text-primary',
                  stalling: 'bg-warning/20 text-warning',
                  regressing: 'bg-danger/20 text-danger',
                };

                const significanceColors: Record<string, string> = {
                  high: 'bg-danger/20 text-danger',
                  medium: 'bg-warning/20 text-warning',
                  low: 'bg-muted/20 text-muted',
                };

                return (
                  <div className="bg-card rounded-xl border border-border p-5 space-y-4">
                    {/* Momentum Indicator */}
                    {momentum && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <TrendingUp className="w-3.5 h-3.5" /> Momentum
                        </h4>
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={cn(
                              'text-xs px-2 py-0.5 rounded-full font-medium capitalize',
                              momentumColors[momentum.direction || ''] || 'bg-muted/20 text-muted'
                            )}
                          >
                            {momentum.direction || 'unknown'}
                          </span>
                        </div>
                        {momentum.reasoning && (
                          <p className="text-sm text-foreground/80 leading-relaxed">
                            {momentum.reasoning}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Growth Trajectory */}
                    {growthTrajectory && growthTrajectory.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-success uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <Lightbulb className="w-3.5 h-3.5" /> Growth Trajectory
                        </h4>
                        <ul className="space-y-1">
                          {growthTrajectory.map((item, i) => (
                            <li key={i} className="text-sm text-foreground flex items-start gap-2">
                              <span className="text-success mt-1 flex-shrink-0">&#8226;</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Stalled Areas */}
                    {stalledAreas && stalledAreas.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-warning uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> Stalled Areas
                        </h4>
                        <ul className="space-y-2">
                          {stalledAreas.map((area, i) => (
                            <li key={i} className="text-sm">
                              <span className="text-foreground flex items-start gap-2">
                                <span className="text-warning mt-1 flex-shrink-0">&#8226;</span>
                                <span>
                                  <span className="font-medium">{area.topic}</span>
                                  {area.suggested_approach && (
                                    <span className="text-muted"> &mdash; {area.suggested_approach}</span>
                                  )}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Dropped Threads */}
                    {droppedThreads && droppedThreads.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-danger uppercase tracking-wider mb-1.5">
                          Dropped Threads
                        </h4>
                        <ul className="space-y-1.5">
                          {droppedThreads.map((thread, i) => (
                            <li key={i} className="text-sm text-foreground flex items-center gap-2">
                              <span>{thread.item}</span>
                              {thread.significance && (
                                <span
                                  className={cn(
                                    'text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize',
                                    significanceColors[thread.significance] || 'bg-muted/20 text-muted'
                                  )}
                                >
                                  {thread.significance}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Commitment Follow-Through */}
                    {commitmentFollowThrough && commitmentFollowThrough.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Commitment Follow-Through
                        </h4>
                        <ul className="space-y-1">
                          {commitmentFollowThrough.map((item, i) => (
                            <li key={i} className="text-sm text-foreground flex items-center gap-2">
                              {item.status === 'followed_up' || item.status === 'followed-up' ? (
                                <Check className="w-3.5 h-3.5 text-success flex-shrink-0" />
                              ) : (
                                <X className="w-3.5 h-3.5 text-danger flex-shrink-0" />
                              )}
                              <span>{item.commitment}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Recommended Interventions */}
                    {recommendedInterventions && recommendedInterventions.length > 0 && (
                      <div className="bg-primary/10 rounded-lg p-3">
                        <h4 className="text-xs font-semibold text-primary uppercase tracking-wider mb-1.5">
                          Recommended Interventions
                        </h4>
                        <ol className="space-y-1 list-decimal list-inside">
                          {recommendedInterventions.map((intervention, i) => (
                            <li key={i} className="text-sm text-foreground">
                              {intervention}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </section>

        {/* Relationship Timeline */}
        <section>
          <button
            onClick={() => toggleSection('timeline')}
            className="w-full flex items-center justify-between mb-3"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Relationship Timeline ({timelineEntries.length})
            </h2>
            {expandedSections.timeline ? (
              <ChevronDown className="w-4 h-4 text-muted" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted" />
            )}
          </button>

          {expandedSections.timeline && (
            <>
              {timelineEntries.length === 0 ? (
                <p className="text-sm text-muted/60 py-3">
                  No history yet for this client.
                </p>
              ) : (
                <div className="space-y-1">
                  {timelineEntries.slice(0, 20).map((entry) => {
                    const isTranscript = entry.type === 'transcript';
                    const content = (
                      <>
                        <div className="flex-shrink-0 mt-0.5">
                          {isTranscript ? (
                            <FileText className="w-4 h-4 text-primary" />
                          ) : (
                            <Check className="w-4 h-4 text-success" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-tight truncate">
                            {entry.title}
                          </p>
                          {entry.description && (
                            <p className="text-xs text-muted mt-1 line-clamp-2">
                              {entry.description}
                            </p>
                          )}
                        </div>
                        <span className="text-xs text-muted flex-shrink-0">
                          {format(new Date(entry.date), 'MMM d')}
                        </span>
                      </>
                    );

                    return isTranscript ? (
                      <Link
                        key={`${entry.type}-${entry.id}`}
                        href={`/transcripts/${entry.id}`}
                        className="bg-card rounded-lg px-4 py-3 flex items-start gap-3 hover:bg-card-hover transition-all border border-transparent hover:border-border"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div
                        key={`${entry.type}-${entry.id}`}
                        className="bg-card rounded-lg px-4 py-3 flex items-start gap-3"
                      >
                        {content}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>

        {/* Transcript Search */}
        <section>
          <button
            onClick={() => toggleSection('search')}
            className="w-full flex items-center justify-between mb-3"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Transcript Search
            </h2>
            {expandedSections.search ? (
              <ChevronDown className="w-4 h-4 text-muted" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted" />
            )}
          </button>

          {expandedSections.search && (
            <div className="bg-card rounded-lg p-4 border border-border/50">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Search across transcripts for this client..."
                  className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  onClick={handleSearch}
                  disabled={searching || !searchQuery.trim()}
                  className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {searching ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                </button>
              </div>

              {searchResult && (
                <div className="mt-4 space-y-3">
                  <div className="bg-background rounded-lg p-3">
                    <h4 className="text-xs font-semibold text-primary uppercase tracking-wider mb-1.5">
                      AI Answer
                    </h4>
                    <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                      {searchResult.answer}
                    </p>
                  </div>

                  {searchResult.sources.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                        Sources
                      </h4>
                      <div className="space-y-1">
                        {searchResult.sources.map((source, i) => (
                          <div
                            key={i}
                            className="bg-background rounded p-2.5 text-xs"
                          >
                            <div className="flex items-center gap-1.5 text-muted mb-1">
                              <FileText className="w-3 h-3" />
                              <span className="font-medium">
                                {source.transcript_title || source.title}
                              </span>
                              <span>&middot;</span>
                              <span>
                                {format(
                                  new Date(source.transcript_date || source.date),
                                  'MMM d, yyyy'
                                )}
                              </span>
                            </div>
                            {(source.snippet || source.excerpt) && (
                              <p className="text-foreground/80 line-clamp-3">
                                {source.snippet || source.excerpt}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Contacts */}
        <section>
          <button
            onClick={() => toggleSection('contacts')}
            className="w-full flex items-center justify-between mb-3"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Contacts ({contacts.length})
            </h2>
            {expandedSections.contacts ? (
              <ChevronDown className="w-4 h-4 text-muted" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted" />
            )}
          </button>

          {expandedSections.contacts && (
            <>
              {contacts.length === 0 ? (
                <p className="text-sm text-muted/60 py-3">
                  No contacts recorded for this client.
                </p>
              ) : (
                <div className="space-y-1">
                  {contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="bg-card rounded-lg px-4 py-3 flex items-center gap-3"
                    >
                      <User className="w-4 h-4 text-muted flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {contact.name}
                        </p>
                        <div className="flex items-center gap-1.5 text-xs text-muted">
                          {contact.role && <span>{contact.role}</span>}
                          {contact.role && contact.relationship_type && (
                            <span>&middot;</span>
                          )}
                          {contact.relationship_type && (
                            <span>{contact.relationship_type}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {/* Draft Composer */}
      {showDraft && (
        <DraftComposer orgId={orgId} onClose={() => setShowDraft(false)} />
      )}

      {/* Snooze Picker */}
      {snoozeTarget && (
        <SnoozePicker
          onSnooze={(date) => handleSnooze(snoozeTarget, date)}
          onClose={() => setSnoozeTarget(null)}
        />
      )}
    </div>
  );
}
