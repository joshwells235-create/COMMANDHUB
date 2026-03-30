'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
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
  Upload,
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
  Plus,
  Activity,
  Heart,
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
import { InteractionTimeline } from '@/components/clients/interaction-timeline';
import { UnifiedTimeline } from '@/components/clients/unified-timeline';
import type { TimelineItem } from '@/components/clients/unified-timeline';
import type { CalendarEvent, ReviewEmail } from '@/types/database';
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

  // Fetch emails and calendar events for the unified timeline
  const [orgEmails, setOrgEmails] = useState<ReviewEmail[]>([]);
  const [orgCalendarEvents, setOrgCalendarEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    if (!orgId) return;
    // Fetch emails for this org
    fetch(`/api/emails/needs-reply?org_id=${orgId}&all=true`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setOrgEmails(Array.isArray(data) ? data : data.emails || []))
      .catch(() => setOrgEmails([]));
    // Fetch calendar events for this org
    fetch(`/api/calendar?org_id=${orgId}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setOrgCalendarEvents(Array.isArray(data) ? data : data.events || []))
      .catch(() => setOrgCalendarEvents([]));
  }, [orgId]);

  // Health score data
  const [healthData, setHealthData] = useState<{
    score: number;
    status: 'thriving' | 'healthy' | 'cooling' | 'at_risk';
    days_since_contact: number;
    overdue_count: number;
    completion_rate: number;
    trend: 'improving' | 'stable' | 'declining';
    alert: string | null;
  } | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    setHealthLoading(true);
    setHealthError(false);
    fetch('/api/ai/relationship-health')
      .then((res) => (res.ok ? res.json() : Promise.reject('Failed')))
      .then((data: Array<{ org_id: string; score: number; status: string; days_since_contact: number; overdue_count: number; completion_rate: number; trend: string; alert: string | null }>) => {
        const match = Array.isArray(data) ? data.find((d) => d.org_id === orgId) : null;
        if (match) {
          setHealthData(match as typeof healthData);
        } else {
          setHealthData(null);
        }
      })
      .catch(() => setHealthError(true))
      .finally(() => setHealthLoading(false));
  }, [orgId]);

  // Derive next meeting from calendar events
  const nextMeeting = useMemo(() => {
    const now = new Date();
    const future = orgCalendarEvents
      .filter((ev) => new Date(ev.start_time) > now)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    return future.length > 0 ? future[0] : null;
  }, [orgCalendarEvents]);

  // Build unified timeline items
  const unifiedTimelineItems = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];

    // Transcripts
    transcripts.forEach((t) => {
      items.push({
        id: t.id,
        type: 'transcript',
        date: t.transcript_date,
        title: t.title || `${t.transcript_type || 'Session'} - ${format(new Date(t.transcript_date), 'MMM d, yyyy')}`,
        subtitle: t.summary ? t.summary.slice(0, 120) + (t.summary.length > 120 ? '...' : '') : undefined,
      });
    });

    // Active commitments (created)
    commitments.forEach((c) => {
      items.push({
        id: c.id,
        type: 'commitment_created',
        date: c.created_at,
        title: c.title,
        subtitle: c.commitment_type ? c.commitment_type.replace(/_/g, ' ') : undefined,
        detail: c.description || undefined,
      });
    });

    // Completed commitments
    completedCommitments.forEach((c) => {
      items.push({
        id: c.id,
        type: 'commitment_completed',
        date: c.completed_at || c.updated_at,
        title: c.title,
        subtitle: 'Completed',
      });
    });

    // Emails
    orgEmails.forEach((e) => {
      const isSent = e.sender_email?.toLowerCase().includes('josh') || false;
      items.push({
        id: e.id,
        type: isSent ? 'email_sent' : 'email_received',
        date: e.received_at || e.created_at,
        title: e.subject || '(No subject)',
        subtitle: isSent ? `To: ${e.sender || 'Unknown'}` : `From: ${e.sender || 'Unknown'}`,
        detail: e.body_preview || undefined,
        sentiment: e.ai_extraction?.needs_reply
          ? (e.ai_extraction.reply_urgency === 'today' ? 'concerned' : undefined)
          : undefined,
      });
    });

    // Calendar events
    orgCalendarEvents.forEach((ev) => {
      items.push({
        id: ev.id,
        type: 'calendar',
        date: ev.start_time,
        title: ev.subject || 'Meeting',
        subtitle: ev.location || undefined,
        detail: ev.body_preview || undefined,
      });
    });

    return items;
  }, [transcripts, commitments, completedCommitments, orgEmails, orgCalendarEvents]);

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
      if (!res.ok) { toast.error('Failed to save client'); throw new Error('Failed to save'); }
      toast.success('Client updated');
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
    unifiedTimeline: true,
    emailIntel: true,
    timeline: true,
    brief: true,
    trajectory: false,
    search: false,
    assessments: true,
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

  // Contact edit state
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactEditFields, setContactEditFields] = useState<Record<string, string | string[]>>({});
  const [contactSaving, setContactSaving] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', role: '', email: '', relationship_type: '', title: '', notes: '' });

  // Assessment state
  interface Assessment {
    id: string;
    org_id: string | null;
    contact_id: string | null;
    title: string;
    assessment_type: string;
    assessment_date: string | null;
    file_name: string | null;
    file_url: string | null;
    raw_text: string | null;
    summary: string | null;
    key_findings: Record<string, unknown> | null;
    ai_analysis: string | null;
    notes: string | null;
    contacts: { id: string; name: string } | null;
    created_at: string;
  }
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [showUploadAssessment, setShowUploadAssessment] = useState(false);
  const [uploadingAssessment, setUploadingAssessment] = useState(false);
  const [analyzingAssessmentId, setAnalyzingAssessmentId] = useState<string | null>(null);
  const [expandedAssessmentId, setExpandedAssessmentId] = useState<string | null>(null);
  const [assessmentForm, setAssessmentForm] = useState({
    contact_id: '',
    assessment_type: 'predictive_index',
    title: '',
    assessment_date: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [assessmentFile, setAssessmentFile] = useState<File | null>(null);

  // Fetch assessments for this org
  useEffect(() => {
    if (!orgId) return;
    fetch(`/api/assessments?org_id=${orgId}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setAssessments(Array.isArray(data) ? data : []))
      .catch(() => setAssessments([]));
  }, [orgId]);

  async function uploadAssessment() {
    if (!assessmentFile) {
      toast.error('Please select a PDF file');
      return;
    }
    setUploadingAssessment(true);
    try {
      const formData = new FormData();
      formData.append('file', assessmentFile);
      formData.append('org_id', orgId);
      if (assessmentForm.contact_id) formData.append('contact_id', assessmentForm.contact_id);
      formData.append('assessment_type', assessmentForm.assessment_type);
      if (assessmentForm.title) formData.append('title', assessmentForm.title);
      formData.append('assessment_date', assessmentForm.assessment_date);
      if (assessmentForm.notes) formData.append('notes', assessmentForm.notes);

      const res = await fetch('/api/assessments/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
      const result = await res.json();
      toast.success('Assessment uploaded');
      setAssessments((prev) => [result.assessment, ...prev]);
      setShowUploadAssessment(false);
      setAssessmentFile(null);
      setAssessmentForm({ contact_id: '', assessment_type: 'predictive_index', title: '', assessment_date: new Date().toISOString().split('T')[0], notes: '' });

      // Auto-trigger AI analysis if text was extracted
      if (result.has_text) {
        analyzeAssessment(result.assessment.id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingAssessment(false);
    }
  }

  async function analyzeAssessment(id: string) {
    setAnalyzingAssessmentId(id);
    try {
      const res = await fetch('/api/assessments/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_id: id }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Analysis failed');
      }
      const result = await res.json();
      setAssessments((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, summary: result.summary, key_findings: result.key_findings, ai_analysis: result.ai_analysis }
            : a
        )
      );
      toast.success('Assessment analyzed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzingAssessmentId(null);
    }
  }

  async function deleteAssessment(id: string) {
    try {
      const res = await fetch(`/api/assessments/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setAssessments((prev) => prev.filter((a) => a.id !== id));
      toast.success('Assessment deleted');
    } catch {
      toast.error('Failed to delete assessment');
    }
  }

  function startEditingContact(c: { id: string; name: string; role: string | null; email: string | null; relationship_type: string[] | null; notes: string | null }) {
    setEditingContactId(c.id);
    setContactEditFields({
      name: c.name,
      role: c.role || '',
      email: c.email || '',
      relationship_type: c.relationship_type || [],
      notes: c.notes || '',
    });
  }

  async function saveContactEdit(id: string) {
    setContactSaving(true);
    try {
      const res = await fetch(`/api/contacts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: contactEditFields.name,
          role: contactEditFields.role || null,
          email: contactEditFields.email || null,
          relationship_type: contactEditFields.relationship_type || null,
          notes: contactEditFields.notes || null,
        }),
      });
      if (!res.ok) { toast.error('Failed to save contact'); throw new Error('Failed to update'); }
      toast.success('Contact updated');
      setEditingContactId(null);
      refresh();
    } catch {
      // stay in edit mode
    } finally {
      setContactSaving(false);
    }
  }

  async function addContact() {
    if (!newContact.name.trim()) return;
    setContactSaving(true);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newContact,
          org_id: orgId,
          category: 'business',
        }),
      });
      if (!res.ok) throw new Error('Failed to create contact');
      toast.success(`${newContact.name} added`);
      setShowAddContact(false);
      setNewContact({ name: '', role: '', email: '', relationship_type: '', title: '', notes: '' });
      refresh();
    } catch {
      toast.error('Failed to add contact');
    } finally {
      setContactSaving(false);
    }
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
      if (!res.ok) { toast.error('Failed to save commitment'); throw new Error('Failed to update'); }
      toast.success('Commitment updated');
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

  // Auto-load cached longitudinal analysis from org intelligence
  useEffect(() => {
    if (organization?.intelligence) {
      const intel = organization.intelligence as { longitudinal?: Record<string, unknown> };
      if (intel.longitudinal) {
        setTrajectoryData({ analysis: intel.longitudinal } as Record<string, unknown>);
        setExpandedSections((prev) => ({ ...prev, trajectory: true }));
      }
    }
  }, [organization]);

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

        {/* Client Health Score */}
        {healthLoading ? (
          <div className="premium-card p-4">
            <div className="flex items-center gap-3 animate-pulse">
              <div className="w-14 h-14 rounded-xl bg-card-hover" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 bg-card-hover rounded" />
                <div className="h-3 w-48 bg-card-hover rounded" />
              </div>
              <div className="flex gap-4">
                <div className="h-8 w-16 bg-card-hover rounded" />
                <div className="h-8 w-16 bg-card-hover rounded" />
                <div className="h-8 w-16 bg-card-hover rounded" />
              </div>
            </div>
          </div>
        ) : healthError ? (
          <div className="premium-card p-4">
            <div className="flex items-center gap-2 text-muted">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm">Health data unavailable</span>
            </div>
          </div>
        ) : healthData ? (
          <div className="premium-card p-4">
            <div className="flex items-center gap-4">
              {/* Score circle */}
              <div
                className={cn(
                  'flex-shrink-0 w-14 h-14 rounded-xl flex flex-col items-center justify-center border',
                  healthData.score >= 70
                    ? 'bg-success/10 border-success/30'
                    : healthData.score >= 40
                      ? 'bg-warning/10 border-warning/30'
                      : 'bg-danger/10 border-danger/30'
                )}
              >
                <span
                  className={cn(
                    'text-xl font-bold leading-none',
                    healthData.score >= 70
                      ? 'text-success'
                      : healthData.score >= 40
                        ? 'text-warning'
                        : 'text-danger'
                  )}
                >
                  {healthData.score}
                </span>
                <span className="text-[10px] text-muted leading-none mt-0.5">health</span>
              </div>

              {/* Status + trend */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Heart
                    className={cn(
                      'w-4 h-4',
                      healthData.score >= 70
                        ? 'text-success'
                        : healthData.score >= 40
                          ? 'text-warning'
                          : 'text-danger'
                    )}
                  />
                  <span
                    className={cn(
                      'text-xs px-2 py-0.5 rounded-full font-medium',
                      healthData.status === 'thriving'
                        ? 'bg-success/20 text-success'
                        : healthData.status === 'healthy'
                          ? 'bg-success/15 text-success'
                          : healthData.status === 'cooling'
                            ? 'bg-warning/20 text-warning'
                            : 'bg-danger/20 text-danger'
                    )}
                  >
                    {healthData.status === 'at_risk'
                      ? 'At Risk'
                      : healthData.status.charAt(0).toUpperCase() + healthData.status.slice(1)}
                  </span>
                  {healthData.trend !== 'stable' && (
                    <span
                      className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded font-medium',
                        healthData.trend === 'improving'
                          ? 'bg-success/10 text-success'
                          : 'bg-danger/10 text-danger'
                      )}
                    >
                      {healthData.trend === 'improving' ? 'Improving' : 'Declining'}
                    </span>
                  )}
                </div>
                {healthData.alert && (
                  <p className="text-xs text-warning/80 truncate">{healthData.alert}</p>
                )}
              </div>

              {/* Metric pills */}
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="text-center">
                  <p className="text-sm font-semibold text-foreground">
                    {healthData.days_since_contact === -1
                      ? '--'
                      : `${healthData.days_since_contact}d`}
                  </p>
                  <p className="text-[10px] text-muted leading-none">last contact</p>
                </div>
                <div className="w-px h-6 bg-border" />
                <div className="text-center">
                  <p
                    className={cn(
                      'text-sm font-semibold',
                      healthData.overdue_count > 0 ? 'text-danger' : 'text-foreground'
                    )}
                  >
                    {healthData.overdue_count}
                  </p>
                  <p className="text-[10px] text-muted leading-none">overdue</p>
                </div>
                <div className="w-px h-6 bg-border" />
                <div className="text-center">
                  <p className="text-sm font-semibold text-foreground">
                    {healthData.completion_rate}%
                  </p>
                  <p className="text-[10px] text-muted leading-none">complete</p>
                </div>
                {nextMeeting && (
                  <>
                    <div className="w-px h-6 bg-border" />
                    <div className="text-center">
                      <p className="text-sm font-semibold text-primary">
                        {format(new Date(nextMeeting.start_time), 'MMM d')}
                      </p>
                      <p className="text-[10px] text-muted leading-none">next meeting</p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}

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

                {/* Session Arc */}
                {latestTranscript.session_arc && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5" /> Session Arc
                    </h4>
                    <p className="text-sm text-foreground leading-relaxed">
                      {latestTranscript.session_arc}
                    </p>
                  </div>
                )}

                {/* Notable Quotes */}
                {latestTranscript.notable_quotes &&
                  latestTranscript.notable_quotes.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <MessageSquare className="w-3.5 h-3.5" /> Notable Quotes
                      </h4>
                      <div className="space-y-2">
                        {latestTranscript.notable_quotes.map((q, i) => (
                          <div
                            key={i}
                            className="bg-background rounded p-2.5 text-sm"
                          >
                            <p className="text-foreground italic">
                              &ldquo;{q.quote}&rdquo;
                            </p>
                            <p className="text-xs text-muted mt-1">
                              <span className="font-medium text-primary">
                                {q.speaker}
                              </span>
                              {q.context && <> &mdash; {q.context}</>}
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

        {/* Unified Timeline */}
        <section>
          <button
            onClick={() => toggleSection('unifiedTimeline')}
            className="w-full flex items-center justify-between mb-3"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Activity Feed ({unifiedTimelineItems.length})
            </h2>
            {expandedSections.unifiedTimeline ? (
              <ChevronDown className="w-4 h-4 text-muted" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted" />
            )}
          </button>

          {expandedSections.unifiedTimeline && (
            <UnifiedTimeline items={unifiedTimelineItems} loading={loading} />
          )}
        </section>

        {/* Email Intelligence */}
        {orgEmails.length > 0 && (
          <section className="bg-card rounded-xl border border-border p-4">
            <button
              onClick={() => toggleSection('emailIntel')}
              className="w-full flex items-center justify-between mb-3"
            >
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                Email Intelligence
              </h2>
              {expandedSections.emailIntel ? (
                <ChevronDown className="w-4 h-4 text-muted" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted" />
              )}
            </button>

            {expandedSections.emailIntel && (() => {
              const emailsWithIntel = orgEmails.filter((e) => e.ai_extraction);
              const sentimentCounts: Record<string, number> = {};
              const allTopics: string[] = [];
              const callbacks: string[] = [];
              const needsReply = orgEmails.filter((e) => e.ai_extraction?.needs_reply);

              for (const email of emailsWithIntel) {
                const ext = email.ai_extraction as unknown as Record<string, unknown> | null;
                if (!ext) continue;
                const sentiment = ext.sentiment as string | undefined;
                if (sentiment) sentimentCounts[sentiment] = (sentimentCounts[sentiment] || 0) + 1;
                const topics = ext.key_topics as string[] | undefined;
                if (Array.isArray(topics)) allTopics.push(...topics);
                const cbs = ext.callback_opportunities as string[] | undefined;
                if (Array.isArray(cbs)) callbacks.push(...cbs);
              }

              const topTopics = [...new Set(allTopics)].slice(0, 8);
              const uniqueCallbacks = [...new Set(callbacks)].slice(0, 5);

              return (
                <div className="space-y-3">
                  {/* Sentiment Overview */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs text-muted">Sentiment:</span>
                    {Object.entries(sentimentCounts).map(([s, count]) => (
                      <span
                        key={s}
                        className={cn(
                          'text-xs px-2 py-0.5 rounded-full font-medium',
                          s === 'positive' && 'bg-success/20 text-success',
                          s === 'negative' && 'bg-danger/20 text-danger',
                          s === 'concerned' && 'bg-warning/20 text-warning',
                          s === 'neutral' && 'bg-muted/20 text-muted'
                        )}
                      >
                        {s}: {count}
                      </span>
                    ))}
                    {Object.keys(sentimentCounts).length === 0 && (
                      <span className="text-xs text-muted/60">No sentiment data</span>
                    )}
                  </div>

                  {/* Topics */}
                  {topTopics.length > 0 && (
                    <div>
                      <span className="text-xs text-muted block mb-1">Key Topics:</span>
                      <div className="flex flex-wrap gap-1">
                        {topTopics.map((topic) => (
                          <span key={topic} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                            {topic}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Callbacks */}
                  {uniqueCallbacks.length > 0 && (
                    <div>
                      <span className="text-xs text-muted block mb-1">Callback Opportunities:</span>
                      <ul className="space-y-1">
                        {uniqueCallbacks.map((cb, i) => (
                          <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                            <Lightbulb className="w-3 h-3 text-warning flex-shrink-0 mt-0.5" />
                            {cb}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Needs Reply */}
                  {needsReply.length > 0 && (
                    <div className="border-t border-border/50 pt-2">
                      <span className="text-xs text-warning font-medium">
                        {needsReply.length} email{needsReply.length > 1 ? 's' : ''} awaiting reply
                      </span>
                      <div className="mt-1 space-y-1">
                        {needsReply.slice(0, 3).map((email) => (
                          <div key={email.id} className="text-xs text-muted truncate">
                            {email.sender || 'Unknown'}: {email.subject}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {emailsWithIntel.length === 0 && (
                    <p className="text-xs text-muted/60">Email intelligence not yet processed</p>
                  )}
                </div>
              );
            })()}
          </section>
        )}

        {/* Visual Interaction Timeline */}
        {timelineEntries.length > 0 && (
          <section className="bg-card rounded-xl border border-border p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
              Interaction Map
            </h2>
            <InteractionTimeline
              events={timelineEntries.map((e) => ({
                date: e.date,
                type: e.type as 'transcript' | 'commitment',
                title: e.title,
                id: e.id,
              }))}
            />
          </section>
        )}

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

        {/* Assessments */}
        <section>
          <button
            onClick={() => toggleSection('assessments')}
            className="w-full flex items-center justify-between mb-3"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Assessments ({assessments.length})
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setShowUploadAssessment(!showUploadAssessment); }}
                className="text-primary hover:text-primary/80 transition-colors"
                title="Upload assessment"
              >
                <Upload className="w-4 h-4" />
              </button>
              {expandedSections.assessments ? (
                <ChevronDown className="w-4 h-4 text-muted" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted" />
              )}
            </div>
          </button>

          {expandedSections.assessments && (
            <>
              {/* Upload Form */}
              {showUploadAssessment && (
                <div className="bg-card rounded-lg p-4 border border-primary/30 mb-3 space-y-3">
                  <h4 className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1">
                    <Upload className="w-3.5 h-3.5" /> Upload Assessment PDF
                  </h4>

                  {/* File Drop Zone */}
                  <label
                    className={cn(
                      'flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors',
                      assessmentFile
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border hover:border-primary/30'
                    )}
                  >
                    <input
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={(e) => setAssessmentFile(e.target.files?.[0] || null)}
                    />
                    {assessmentFile ? (
                      <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-primary" />
                        <span className="text-sm text-foreground">{assessmentFile.name}</span>
                        <button
                          onClick={(e) => { e.preventDefault(); setAssessmentFile(null); }}
                          className="ml-2 text-muted hover:text-danger"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <Upload className="w-6 h-6 text-muted" />
                        <span className="text-sm text-muted">Click or drag to upload PDF</span>
                      </>
                    )}
                  </label>

                  {/* Form Fields */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted uppercase tracking-wide">Type *</label>
                      <select
                        value={assessmentForm.assessment_type}
                        onChange={(e) => setAssessmentForm({ ...assessmentForm, assessment_type: e.target.value })}
                        className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                      >
                        <option value="predictive_index">Predictive Index (PI)</option>
                        <option value="eq_i_2">EQ-i 2.0</option>
                        <option value="five_dysfunctions">Five Dysfunctions</option>
                        <option value="disc">DiSC</option>
                        <option value="strengthsfinder">CliftonStrengths</option>
                        <option value="mbti">MBTI</option>
                        <option value="custom">Custom / Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted uppercase tracking-wide">Person</label>
                      <select
                        value={assessmentForm.contact_id}
                        onChange={(e) => setAssessmentForm({ ...assessmentForm, contact_id: e.target.value })}
                        className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                      >
                        <option value="">-- Select person --</option>
                        {contacts.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted uppercase tracking-wide">Title</label>
                      <input
                        type="text"
                        value={assessmentForm.title}
                        onChange={(e) => setAssessmentForm({ ...assessmentForm, title: e.target.value })}
                        placeholder="Auto-generated if blank"
                        className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted uppercase tracking-wide">Date</label>
                      <input
                        type="date"
                        value={assessmentForm.assessment_date}
                        onChange={(e) => setAssessmentForm({ ...assessmentForm, assessment_date: e.target.value })}
                        className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted uppercase tracking-wide">Notes</label>
                    <input
                      type="text"
                      value={assessmentForm.notes}
                      onChange={(e) => setAssessmentForm({ ...assessmentForm, notes: e.target.value })}
                      placeholder="Optional notes about this assessment..."
                      className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={uploadAssessment}
                      disabled={uploadingAssessment || !assessmentFile}
                      className="flex items-center gap-1 px-3 py-1.5 btn-gradient text-white rounded-md text-xs font-medium disabled:opacity-50"
                    >
                      {uploadingAssessment ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                      Upload & Analyze
                    </button>
                    <button
                      onClick={() => { setShowUploadAssessment(false); setAssessmentFile(null); }}
                      className="px-3 py-1.5 bg-card-hover text-muted rounded-md text-xs font-medium hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Assessment List */}
              {assessments.length === 0 && !showUploadAssessment ? (
                <p className="text-sm text-muted/60 py-3">
                  No assessments uploaded yet. Click the upload icon to add a PDF.
                </p>
              ) : (
                <div className="space-y-2">
                  {assessments.map((assessment) => {
                    const isExpanded = expandedAssessmentId === assessment.id;
                    const isAnalyzing = analyzingAssessmentId === assessment.id;
                    const typeLabels: Record<string, string> = {
                      predictive_index: 'PI',
                      eq_i_2: 'EQ-i 2.0',
                      five_dysfunctions: '5 Dysfunctions',
                      disc: 'DiSC',
                      strengthsfinder: 'CliftonStrengths',
                      mbti: 'MBTI',
                      custom: 'Custom',
                      general: 'General',
                    };
                    const typeLabel = typeLabels[assessment.assessment_type] || assessment.assessment_type;
                    const findings = assessment.key_findings as {
                      highlights?: string[];
                      areas_of_strength?: string[];
                      development_areas?: string[];
                      under_pressure?: string;
                    } | null;

                    return (
                      <div key={assessment.id} className="bg-card rounded-lg border border-transparent hover:border-border transition-all">
                        {/* Header row */}
                        <button
                          onClick={() => setExpandedAssessmentId(isExpanded ? null : assessment.id)}
                          className="w-full px-4 py-3 flex items-center gap-3 text-left"
                        >
                          <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {assessment.title}
                            </p>
                            <div className="flex items-center gap-1.5 text-xs text-muted">
                              <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px] font-medium">
                                {typeLabel}
                              </span>
                              {assessment.contacts?.name && (
                                <>
                                  <span>&middot;</span>
                                  <span>{assessment.contacts.name}</span>
                                </>
                              )}
                              {assessment.assessment_date && (
                                <>
                                  <span>&middot;</span>
                                  <span>{format(new Date(assessment.assessment_date), 'MMM d, yyyy')}</span>
                                </>
                              )}
                              {assessment.summary && (
                                <span title="AI analyzed"><Sparkles className="w-3 h-3 text-amber-400 ml-1" /></span>
                              )}
                            </div>
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted flex-shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted flex-shrink-0" />
                          )}
                        </button>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="px-4 pb-4 space-y-3 border-t border-border/50">
                            {/* Action buttons */}
                            <div className="flex items-center gap-2 pt-3">
                              {assessment.file_url && (
                                <a
                                  href={assessment.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 px-2.5 py-1 bg-primary/10 text-primary rounded-md text-xs font-medium hover:bg-primary/20 transition-colors"
                                >
                                  <FileText className="w-3 h-3" /> View PDF
                                </a>
                              )}
                              {assessment.raw_text && !assessment.summary && (
                                <button
                                  onClick={() => analyzeAssessment(assessment.id)}
                                  disabled={isAnalyzing}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-md text-xs font-medium hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                                >
                                  {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                  Analyze with AI
                                </button>
                              )}
                              {assessment.summary && (
                                <button
                                  onClick={() => analyzeAssessment(assessment.id)}
                                  disabled={isAnalyzing}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-card-hover text-muted rounded-md text-xs font-medium hover:text-foreground transition-colors disabled:opacity-50"
                                >
                                  {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                  Re-analyze
                                </button>
                              )}
                              <button
                                onClick={() => { if (confirm('Delete this assessment?')) deleteAssessment(assessment.id); }}
                                className="flex items-center gap-1 px-2.5 py-1 text-danger/70 hover:text-danger rounded-md text-xs font-medium transition-colors ml-auto"
                              >
                                <X className="w-3 h-3" /> Delete
                              </button>
                            </div>

                            {/* AI Summary */}
                            {assessment.summary && (
                              <div className="space-y-2">
                                <h5 className="text-xs font-semibold text-primary uppercase tracking-wider">Summary</h5>
                                <p className="text-sm text-foreground/90 leading-relaxed">{assessment.summary}</p>
                              </div>
                            )}

                            {/* Key Findings */}
                            {findings && (
                              <div className="space-y-2">
                                {findings.highlights && findings.highlights.length > 0 && (
                                  <div>
                                    <h5 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1">Key Highlights</h5>
                                    <ul className="space-y-0.5">
                                      {findings.highlights.map((h: string, i: number) => (
                                        <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                                          <span className="text-amber-400 mt-0.5">&#8226;</span> {h}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {findings.areas_of_strength && findings.areas_of_strength.length > 0 && (
                                  <div>
                                    <h5 className="text-xs font-semibold text-success uppercase tracking-wider mb-1">Strengths</h5>
                                    <ul className="space-y-0.5">
                                      {findings.areas_of_strength.map((s: string, i: number) => (
                                        <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                                          <span className="text-success mt-0.5">&#8226;</span> {s}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {findings.development_areas && findings.development_areas.length > 0 && (
                                  <div>
                                    <h5 className="text-xs font-semibold text-warning uppercase tracking-wider mb-1">Development Areas</h5>
                                    <ul className="space-y-0.5">
                                      {findings.development_areas.map((d: string, i: number) => (
                                        <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                                          <span className="text-warning mt-0.5">&#8226;</span> {d}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {findings.under_pressure && (
                                  <div>
                                    <h5 className="text-xs font-semibold text-danger uppercase tracking-wider mb-1">Under Pressure</h5>
                                    <p className="text-xs text-foreground/80">{findings.under_pressure}</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Full AI Analysis */}
                            {assessment.ai_analysis && (
                              <div className="space-y-2">
                                <h5 className="text-xs font-semibold text-primary uppercase tracking-wider">Coaching Analysis</h5>
                                <div className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap bg-background/50 rounded-lg p-3 border border-border/50">
                                  {assessment.ai_analysis}
                                </div>
                              </div>
                            )}

                            {/* Notes */}
                            {assessment.notes && (
                              <div className="text-xs text-muted italic">{assessment.notes}</div>
                            )}

                            {/* Analyzing indicator */}
                            {isAnalyzing && (
                              <div className="flex items-center gap-2 text-xs text-amber-400">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Analyzing assessment with AI...
                              </div>
                            )}
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

        {/* Contacts */}
        <section>
          <button
            onClick={() => toggleSection('contacts')}
            className="w-full flex items-center justify-between mb-3"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Contacts ({contacts.length})
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setShowAddContact(!showAddContact); }}
                className="text-primary hover:text-primary/80 transition-colors"
                title="Add contact"
              >
                <Plus className="w-4 h-4" />
              </button>
              {expandedSections.contacts ? (
                <ChevronDown className="w-4 h-4 text-muted" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted" />
              )}
            </div>
          </button>

          {expandedSections.contacts && (
            <>
              {/* Add Contact Form */}
              {showAddContact && (
                <div className="bg-card rounded-lg p-4 border border-primary/30 mb-2 space-y-2">
                  <h4 className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> New Contact
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted uppercase tracking-wide">Name *</label>
                      <input type="text" value={newContact.name}
                        onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                        placeholder="Full name"
                        className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted uppercase tracking-wide">Title</label>
                      <input type="text" value={newContact.title}
                        onChange={(e) => setNewContact({ ...newContact, title: e.target.value })}
                        placeholder="e.g. VP Sales, CEO..."
                        className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted uppercase tracking-wide">Email</label>
                      <input type="email" value={newContact.email}
                        onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                        placeholder="email@example.com"
                        className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted uppercase tracking-wide">Role</label>
                      <input type="text" value={newContact.role}
                        onChange={(e) => setNewContact({ ...newContact, role: e.target.value })}
                        placeholder="e.g. coachee, sponsor..."
                        className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted uppercase tracking-wide">Relationship</label>
                      <input type="text" value={newContact.relationship_type}
                        onChange={(e) => setNewContact({ ...newContact, relationship_type: e.target.value })}
                        placeholder="e.g. champion, decision_maker..."
                        className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted uppercase tracking-wide">Notes</label>
                      <input type="text" value={newContact.notes}
                        onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
                        placeholder="Quick note..."
                        className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={addContact} disabled={contactSaving || !newContact.name.trim()}
                      className="flex items-center gap-1 px-3 py-1.5 btn-gradient text-white rounded-md text-xs font-medium disabled:opacity-50">
                      {contactSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add
                    </button>
                    <button onClick={() => setShowAddContact(false)}
                      className="px-3 py-1.5 bg-card-hover text-muted rounded-md text-xs font-medium hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {contacts.length === 0 && !showAddContact ? (
                <p className="text-sm text-muted/60 py-3">
                  No contacts recorded for this client.
                </p>
              ) : (
                <div className="space-y-1">
                  {contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="bg-card rounded-lg border border-transparent hover:border-border transition-all"
                    >
                      {editingContactId === contact.id ? (
                        <div className="px-4 py-3 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-muted uppercase tracking-wide">Name</label>
                              <input
                                type="text"
                                value={contactEditFields.name || ''}
                                onChange={(e) => setContactEditFields({ ...contactEditFields, name: e.target.value })}
                                className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-muted uppercase tracking-wide">Role</label>
                              <input
                                type="text"
                                value={contactEditFields.role || ''}
                                onChange={(e) => setContactEditFields({ ...contactEditFields, role: e.target.value })}
                                placeholder="e.g. CEO, VP Sales..."
                                className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-muted uppercase tracking-wide">Email</label>
                              <input
                                type="email"
                                value={contactEditFields.email || ''}
                                onChange={(e) => setContactEditFields({ ...contactEditFields, email: e.target.value })}
                                placeholder="email@example.com"
                                className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-muted uppercase tracking-wide">Relationship</label>
                              <input
                                type="text"
                                value={contactEditFields.relationship_type || ''}
                                onChange={(e) => setContactEditFields({ ...contactEditFields, relationship_type: e.target.value })}
                                placeholder="e.g. Primary, Champion..."
                                className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] text-muted uppercase tracking-wide">Notes</label>
                            <textarea
                              value={contactEditFields.notes || ''}
                              onChange={(e) => setContactEditFields({ ...contactEditFields, notes: e.target.value })}
                              rows={2}
                              className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary resize-y"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => saveContactEdit(contact.id)}
                              disabled={contactSaving || !(typeof contactEditFields.name === 'string' && contactEditFields.name.trim())}
                              className="flex items-center gap-1 px-3 py-1.5 btn-gradient text-white rounded-md text-xs font-medium disabled:opacity-50"
                            >
                              {contactSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              Save
                            </button>
                            <button
                              onClick={() => setEditingContactId(null)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-card-hover text-muted rounded-md text-xs font-medium hover:text-foreground"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="px-4 py-3 flex items-center gap-3">
                          <User className="w-4 h-4 text-muted flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">
                              {contact.name}
                            </p>
                            <div className="flex items-center gap-1.5 text-xs text-muted">
                              {contact.role && <span>{contact.role}</span>}
                              {contact.role && contact.relationship_type && contact.relationship_type.length > 0 && (
                                <span>&middot;</span>
                              )}
                              {contact.relationship_type && contact.relationship_type.length > 0 && (
                                <span>{contact.relationship_type.map((rt: string) => rt.replace(/_/g, ' ')).join(', ')}</span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => startEditingContact(contact)}
                            className="flex-shrink-0 p-1.5 text-muted hover:text-primary transition-colors rounded-md hover:bg-card-hover"
                            title="Edit contact"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
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
