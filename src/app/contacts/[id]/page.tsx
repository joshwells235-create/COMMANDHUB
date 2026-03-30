'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Zap,
  ArrowLeft,
  User,
  Building2,
  Mail,
  Phone,
  ExternalLink,
  Pencil,
  Save,
  X,
  Loader2,
  FileText,
  CheckCircle2,
  MessageSquare,
  Brain,
  Lightbulb,
  Target,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Trash2,
  ClipboardPaste,
  Sparkles,
  Shield,
  Plus,
} from 'lucide-react';
import type { Contact, Organization, Commitment } from '@/types/database';
import { cn, getCommitmentTypeLabel, getDueLabel } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';

const RELATIONSHIP_TYPES = [
  'champion', 'decision_maker', 'influencer', 'coach', 'admin',
  'participant', 'coachee', 'sponsor', 'stakeholder', 'partner', 'friend', 'family',
];

const ASSESSMENT_TYPES = [
  { value: 'predictive_index', label: 'Predictive Index (PI)' },
  { value: 'eq_i_2', label: 'EQ-i 2.0' },
  { value: 'five_dysfunctions', label: 'Five Dysfunctions' },
  { value: 'disc', label: 'DiSC' },
  { value: 'strengthsfinder', label: 'CliftonStrengths' },
  { value: 'mbti', label: 'MBTI' },
  { value: 'custom', label: 'Other' },
];

interface Assessment {
  id: string;
  contact_id: string;
  assessment_type: string;
  title: string;
  assessment_date: string | null;
  raw_text: string | null;
  summary: string | null;
  key_findings: {
    scores?: Record<string, unknown>;
    highlights?: string[];
    areas_of_strength?: string[];
    development_areas?: string[];
    behavioral_drives?: string[];
    under_pressure?: string;
  } | null;
  ai_analysis: string | null;
  notes: string | null;
  created_at: string;
}

interface TranscriptMention {
  id: string;
  title: string | null;
  transcript_date: string;
  summary: string | null;
  notable_quotes: Array<{ quote: string; context: string; speaker: string }> | null;
}

export default function ContactDetailPage() {
  const params = useParams();
  const contactId = params.id as string;

  const [contact, setContact] = useState<(Contact & { organizations?: Organization | null }) | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptMention[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, string | string[]>>({});
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [showAddAssessment, setShowAddAssessment] = useState(false);
  const [newAssessmentType, setNewAssessmentType] = useState('predictive_index');
  const [newAssessmentTitle, setNewAssessmentTitle] = useState('');
  const [newAssessmentDate, setNewAssessmentDate] = useState('');
  const [newAssessmentText, setNewAssessmentText] = useState('');
  const [newAssessmentNotes, setNewAssessmentNotes] = useState('');
  const [savingAssessment, setSavingAssessment] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [expandedAssessment, setExpandedAssessment] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    profile: true,
    assessments: true,
    transcripts: true,
    commitments: true,
  });

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const fetchContact = useCallback(async () => {
    try {
      const res = await fetch(`/api/contacts/${contactId}`);
      if (!res.ok) throw new Error('Contact not found');
      const data = await res.json();
      setContact(data);

      // Fetch transcripts for this person's org
      if (data.org_id) {
        const [transcriptsRes, commitmentsRes] = await Promise.all([
          fetch(`/api/transcripts?org_id=${data.org_id}`),
          fetch(`/api/commitments?org_id=${data.org_id}&status=pending,in_progress,snoozed,waiting`),
        ]);
        const transcriptsRaw = await transcriptsRes.json();
        const allTranscripts: TranscriptMention[] = Array.isArray(transcriptsRaw)
          ? transcriptsRaw
          : transcriptsRaw.transcripts || [];

        // Filter to transcripts that mention this person's name
        const name = data.name.toLowerCase();
        const firstName = name.split(' ')[0];
        const mentioning = allTranscripts.filter((t) => {
          const text = [t.summary, t.title].filter(Boolean).join(' ').toLowerCase();
          const quotesText = (t.notable_quotes || [])
            .map((q) => `${q.quote} ${q.speaker} ${q.context}`)
            .join(' ')
            .toLowerCase();
          return text.includes(firstName) || quotesText.includes(firstName);
        });
        setTranscripts(mentioning);

        const commData: Commitment[] = await commitmentsRes.json();
        // Filter commitments referencing this contact or mentioning their name
        const relevant = commData.filter(
          (c) =>
            c.contact_id === contactId ||
            c.other_party?.toLowerCase().includes(firstName) ||
            c.title?.toLowerCase().includes(firstName) ||
            c.description?.toLowerCase().includes(firstName)
        );
        setCommitments(relevant);
      }

      // Fetch assessments for this contact
      try {
        const assessRes = await fetch(`/api/assessments?contact_id=${contactId}`);
        if (assessRes.ok) {
          const assessData = await assessRes.json();
          setAssessments(Array.isArray(assessData) ? assessData : []);
        }
      } catch { /* ignore */ }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { fetchContact(); }, [fetchContact]);

  // Fetch orgs for the edit dropdown
  useEffect(() => {
    fetch('/api/organizations')
      .then((r) => r.json())
      .then((d) => setOrganizations(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  function startEditing() {
    if (!contact) return;
    setEditFields({
      name: contact.name || '',
      title: contact.title || '',
      role: contact.role || '',
      email: contact.email || '',
      phone: contact.phone || '',
      linkedin_url: contact.linkedin_url || '',
      company: contact.company || '',
      org_id: contact.org_id || '',
      category: contact.category || 'business',
      relationship_type: contact.relationship_type || [],
      notes: contact.notes || '',
      personality_notes: contact.personality_notes || '',
      coaching_focus: contact.coaching_focus || '',
      communication_style: contact.communication_style || '',
    });
    setEditing(true);
  }

  async function saveEdits() {
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editFields,
          org_id: editFields.org_id || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      toast.success('Contact updated');
      setEditing(false);
      fetchContact();
    } catch {
      toast.error('Failed to save contact');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this contact? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/contacts/${contactId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Contact deleted');
      window.location.href = '/contacts';
    } catch {
      toast.error('Failed to delete contact');
    }
  }

  async function saveAssessment() {
    if (!newAssessmentText.trim()) {
      toast.error('Please paste the assessment text');
      return;
    }
    setSavingAssessment(true);
    try {
      const typeLabel = ASSESSMENT_TYPES.find((t) => t.value === newAssessmentType)?.label || newAssessmentType;
      const res = await fetch('/api/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          org_id: contact?.org_id || null,
          assessment_type: newAssessmentType,
          title: newAssessmentTitle.trim() || `${typeLabel} Assessment`,
          assessment_date: newAssessmentDate || null,
          raw_text: newAssessmentText,
          notes: newAssessmentNotes || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const saved = await res.json();
      setAssessments((prev) => [saved, ...prev]);
      setShowAddAssessment(false);
      setNewAssessmentType('predictive_index');
      setNewAssessmentTitle('');
      setNewAssessmentDate('');
      setNewAssessmentText('');
      setNewAssessmentNotes('');
      toast.success('Assessment saved');
    } catch {
      toast.error('Failed to save assessment');
    } finally {
      setSavingAssessment(false);
    }
  }

  async function analyzeAssessment(assessmentId: string) {
    setAnalyzingId(assessmentId);
    try {
      const res = await fetch('/api/assessments/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_id: assessmentId }),
      });
      if (!res.ok) throw new Error('Analysis failed');
      const result = await res.json();
      setAssessments((prev) =>
        prev.map((a) =>
          a.id === assessmentId
            ? { ...a, summary: result.summary, key_findings: result.key_findings, ai_analysis: result.ai_analysis }
            : a
        )
      );
      setExpandedAssessment(assessmentId);
      toast.success('Analysis complete');
    } catch {
      toast.error('AI analysis failed — try again');
    } finally {
      setAnalyzingId(null);
    }
  }

  async function deleteAssessment(assessmentId: string) {
    if (!confirm('Delete this assessment?')) return;
    try {
      const res = await fetch(`/api/assessments/${assessmentId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      setAssessments((prev) => prev.filter((a) => a.id !== assessmentId));
      toast.success('Assessment deleted');
    } catch {
      toast.error('Failed to delete assessment');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted">
          <Zap className="w-5 h-5 text-primary animate-pulse" />
          <span>Loading contact...</span>
        </div>
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-danger mx-auto mb-3" />
          <p className="text-muted">{error || 'Contact not found'}</p>
          <Link href="/contacts" className="text-primary text-sm mt-2 inline-block">Back to people</Link>
        </div>
      </div>
    );
  }

  const org = contact.organizations as Organization | null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl header-gradient-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/contacts" className="text-muted hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold tracking-tight">COMMAND HUB</h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-24">
        {/* Contact Header */}
        <div className="premium-card p-5">
          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-muted block mb-1">Name</label>
                  <input type="text" value={editFields.name}
                    onChange={(e) => setEditFields({ ...editFields, name: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Job Title</label>
                  <input type="text" value={editFields.title}
                    onChange={(e) => setEditFields({ ...editFields, title: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Relationship</label>
                  <div className="w-full bg-background border border-border rounded-lg px-3 py-2">
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {(Array.isArray(editFields.relationship_type) ? editFields.relationship_type : []).map((rt: string) => (
                        <button key={rt} type="button"
                          onClick={() => setEditFields({ ...editFields, relationship_type: (editFields.relationship_type as string[]).filter((t: string) => t !== rt) })}
                          className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary hover:bg-primary/25 transition-colors flex items-center gap-1">
                          {rt.replace(/_/g, ' ')} <X className="w-3 h-3" />
                        </button>
                      ))}
                    </div>
                    <select value=""
                      onChange={(e) => {
                        const current = Array.isArray(editFields.relationship_type) ? editFields.relationship_type : [];
                        if (e.target.value && !current.includes(e.target.value)) {
                          setEditFields({ ...editFields, relationship_type: [...current, e.target.value] });
                        }
                      }}
                      className="bg-transparent text-sm focus:outline-none w-full">
                      <option value="">{(Array.isArray(editFields.relationship_type) && editFields.relationship_type.length) ? 'Add another...' : 'Select type'}</option>
                      {RELATIONSHIP_TYPES.filter((rt) => !(Array.isArray(editFields.relationship_type) ? editFields.relationship_type : []).includes(rt)).map((rt) => (
                        <option key={rt} value={rt}>{rt.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Email</label>
                  <input type="email" value={editFields.email}
                    onChange={(e) => setEditFields({ ...editFields, email: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Phone</label>
                  <input type="tel" value={editFields.phone}
                    onChange={(e) => setEditFields({ ...editFields, phone: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Organization</label>
                  <select value={editFields.org_id}
                    onChange={(e) => setEditFields({ ...editFields, org_id: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary">
                    <option value="">None</option>
                    {organizations.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Company (if no org)</label>
                  <input type="text" value={editFields.company}
                    onChange={(e) => setEditFields({ ...editFields, company: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Category</label>
                  <select value={editFields.category}
                    onChange={(e) => setEditFields({ ...editFields, category: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary">
                    <option value="business">Business</option>
                    <option value="personal">Personal</option>
                    <option value="partner">Partner</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">LinkedIn</label>
                  <input type="url" value={editFields.linkedin_url}
                    onChange={(e) => setEditFields({ ...editFields, linkedin_url: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted block mb-1">Notes</label>
                  <textarea value={editFields.notes} rows={2}
                    onChange={(e) => setEditFields({ ...editFields, notes: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted block mb-1">Coaching Focus</label>
                  <textarea value={editFields.coaching_focus} rows={2}
                    onChange={(e) => setEditFields({ ...editFields, coaching_focus: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none" />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Personality Notes</label>
                  <textarea value={editFields.personality_notes} rows={2}
                    onChange={(e) => setEditFields({ ...editFields, personality_notes: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none" />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Communication Style</label>
                  <textarea value={editFields.communication_style} rows={2}
                    onChange={(e) => setEditFields({ ...editFields, communication_style: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none" />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={saveEdits} disabled={saving || !(typeof editFields.name === 'string' && editFields.name.trim())}
                  className="flex items-center gap-1 px-3 py-1.5 btn-gradient text-white rounded-md text-xs font-medium disabled:opacity-50">
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                </button>
                <button onClick={() => setEditing(false)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-card-hover text-muted rounded-md text-xs font-medium hover:text-foreground">
                  Cancel
                </button>
                <div className="flex-1" />
                <button onClick={handleDelete}
                  className="flex items-center gap-1 px-3 py-1.5 text-danger/70 hover:text-danger text-xs font-medium">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <User className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-foreground">{contact.name}</h2>
                    <button onClick={startEditing} className="text-muted hover:text-foreground transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {contact.title && <span className="text-sm text-muted">{contact.title}</span>}
                    {contact.relationship_type && contact.relationship_type.length > 0 && contact.relationship_type.map((rt) => (
                      <span key={rt} className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                        {rt.replace(/_/g, ' ')}
                      </span>
                    ))}
                    {contact.category && contact.category !== 'business' && (
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded-full',
                        contact.category === 'personal' && 'bg-violet-500/20 text-violet-400',
                        contact.category === 'partner' && 'bg-amber-500/20 text-amber-400',
                      )}>
                        {contact.category}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Contact details */}
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                {org && (
                  <Link href={`/clients/${org.id}`} className="flex items-center gap-2 text-muted hover:text-primary transition-colors">
                    <Building2 className="w-4 h-4" /> {org.name}
                  </Link>
                )}
                {!org && contact.company && (
                  <div className="flex items-center gap-2 text-muted">
                    <Building2 className="w-4 h-4" /> {contact.company}
                  </div>
                )}
                {contact.email && (
                  <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-muted hover:text-primary transition-colors">
                    <Mail className="w-4 h-4" /> {contact.email}
                  </a>
                )}
                {contact.phone && (
                  <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-muted hover:text-primary transition-colors">
                    <Phone className="w-4 h-4" /> {contact.phone}
                  </a>
                )}
                {contact.linkedin_url && (
                  <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-muted hover:text-primary transition-colors">
                    <ExternalLink className="w-4 h-4" /> LinkedIn
                  </a>
                )}
              </div>

              {contact.notes && (
                <p className="mt-3 text-sm text-muted leading-relaxed">{contact.notes}</p>
              )}
            </div>
          )}
        </div>

        {/* Coaching & Personality Profile */}
        {(contact.coaching_focus || contact.personality_notes || contact.communication_style) && (
          <section>
            <button onClick={() => toggleSection('profile')} className="w-full flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Profile & Coaching</h2>
              {expandedSections.profile ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
            </button>
            {expandedSections.profile && (
              <div className="bg-card rounded-lg p-4 border border-border/50 space-y-3">
                {contact.coaching_focus && (
                  <div>
                    <h4 className="text-xs font-semibold text-primary uppercase tracking-wider mb-1 flex items-center gap-1">
                      <Target className="w-3.5 h-3.5" /> Coaching Focus
                    </h4>
                    <p className="text-sm text-foreground leading-relaxed">{contact.coaching_focus}</p>
                  </div>
                )}
                {contact.personality_notes && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1 flex items-center gap-1">
                      <Brain className="w-3.5 h-3.5" /> Personality & Behavioral Style
                    </h4>
                    <p className="text-sm text-foreground leading-relaxed">{contact.personality_notes}</p>
                  </div>
                )}
                {contact.communication_style && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1 flex items-center gap-1">
                      <MessageSquare className="w-3.5 h-3.5" /> Communication Style
                    </h4>
                    <p className="text-sm text-foreground leading-relaxed">{contact.communication_style}</p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Assessments */}
        <section>
          <button onClick={() => toggleSection('assessments')} className="w-full flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Assessments ({assessments.length})
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setShowAddAssessment(!showAddAssessment); }}
                className="text-primary hover:text-primary/80 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
              {expandedSections.assessments ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
            </div>
          </button>
          {expandedSections.assessments && (
            <div className="space-y-3">
              {/* Add Assessment Form */}
              {showAddAssessment && (
                <div className="bg-card rounded-lg p-4 border border-primary/30 space-y-3">
                  <h4 className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1">
                    <ClipboardPaste className="w-3.5 h-3.5" /> Add Assessment
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted block mb-1">Type</label>
                      <select value={newAssessmentType} onChange={(e) => setNewAssessmentType(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary">
                        {ASSESSMENT_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted block mb-1">Date Taken</label>
                      <input type="date" value={newAssessmentDate}
                        onChange={(e) => setNewAssessmentDate(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-muted block mb-1">Title (optional)</label>
                      <input type="text" value={newAssessmentTitle}
                        onChange={(e) => setNewAssessmentTitle(e.target.value)}
                        placeholder={`${ASSESSMENT_TYPES.find((t) => t.value === newAssessmentType)?.label || ''} Assessment`}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-muted block mb-1">Assessment Results (paste text)</label>
                      <textarea value={newAssessmentText} rows={6}
                        onChange={(e) => setNewAssessmentText(e.target.value)}
                        placeholder="Paste the full assessment results here..."
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none font-mono text-xs" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs text-muted block mb-1">Notes (optional)</label>
                      <textarea value={newAssessmentNotes} rows={2}
                        onChange={(e) => setNewAssessmentNotes(e.target.value)}
                        placeholder="Any additional context..."
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={saveAssessment} disabled={savingAssessment || !newAssessmentText.trim()}
                      className="flex items-center gap-1 px-3 py-1.5 btn-gradient text-white rounded-md text-xs font-medium disabled:opacity-50">
                      {savingAssessment ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save Assessment
                    </button>
                    <button onClick={() => setShowAddAssessment(false)}
                      className="px-3 py-1.5 bg-card-hover text-muted rounded-md text-xs font-medium hover:text-foreground">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Assessment List */}
              {assessments.length === 0 && !showAddAssessment ? (
                <div className="text-center py-6">
                  <Shield className="w-6 h-6 text-muted/30 mx-auto mb-2" />
                  <p className="text-xs text-muted">No assessments uploaded yet.</p>
                  <button onClick={() => setShowAddAssessment(true)}
                    className="text-xs text-primary mt-1 hover:underline">Add one</button>
                </div>
              ) : (
                assessments.map((a) => {
                  const typeLabel = ASSESSMENT_TYPES.find((t) => t.value === a.assessment_type)?.label || a.assessment_type;
                  const isExpanded = expandedAssessment === a.id;
                  const isAnalyzing = analyzingId === a.id;

                  return (
                    <div key={a.id} className="bg-card rounded-lg border border-border/50 overflow-hidden">
                      <button
                        onClick={() => setExpandedAssessment(isExpanded ? null : a.id)}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-card-hover/50 transition-colors text-left"
                      >
                        <Shield className="w-4 h-4 text-primary flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground truncate">{a.title}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary flex-shrink-0">
                              {typeLabel}
                            </span>
                          </div>
                          {a.summary && (
                            <p className="text-xs text-muted line-clamp-1 mt-0.5">{a.summary}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {a.assessment_date && (
                            <span className="text-xs text-muted">{format(new Date(a.assessment_date), 'MMM d, yyyy')}</span>
                          )}
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-3 border-t border-border/30 pt-3">
                          {/* AI Analysis button */}
                          {a.raw_text && !a.ai_analysis && (
                            <button onClick={() => analyzeAssessment(a.id)} disabled={isAnalyzing}
                              className="flex items-center gap-1.5 px-3 py-1.5 btn-gradient text-white rounded-md text-xs font-medium disabled:opacity-50">
                              {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                              {isAnalyzing ? 'Analyzing...' : 'Analyze with AI'}
                            </button>
                          )}

                          {/* Summary */}
                          {a.summary && (
                            <div>
                              <h5 className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">Summary</h5>
                              <p className="text-sm text-foreground leading-relaxed">{a.summary}</p>
                            </div>
                          )}

                          {/* Key Findings */}
                          {a.key_findings && (
                            <div className="space-y-2">
                              {a.key_findings.highlights && a.key_findings.highlights.length > 0 && (
                                <div>
                                  <h5 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Highlights</h5>
                                  <ul className="text-xs text-foreground space-y-0.5">
                                    {a.key_findings.highlights.map((h, i) => (
                                      <li key={i} className="flex items-start gap-1.5">
                                        <Lightbulb className="w-3 h-3 text-warning flex-shrink-0 mt-0.5" />
                                        <span>{h}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {a.key_findings.areas_of_strength && a.key_findings.areas_of_strength.length > 0 && (
                                <div>
                                  <h5 className="text-xs font-semibold text-success uppercase tracking-wider mb-1">Strengths</h5>
                                  <ul className="text-xs text-foreground space-y-0.5">
                                    {a.key_findings.areas_of_strength.map((s, i) => (
                                      <li key={i} className="flex items-start gap-1.5">
                                        <CheckCircle2 className="w-3 h-3 text-success flex-shrink-0 mt-0.5" />
                                        <span>{s}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {a.key_findings.development_areas && a.key_findings.development_areas.length > 0 && (
                                <div>
                                  <h5 className="text-xs font-semibold text-warning uppercase tracking-wider mb-1">Development Areas</h5>
                                  <ul className="text-xs text-foreground space-y-0.5">
                                    {a.key_findings.development_areas.map((d, i) => (
                                      <li key={i} className="flex items-start gap-1.5">
                                        <Target className="w-3 h-3 text-warning flex-shrink-0 mt-0.5" />
                                        <span>{d}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {a.key_findings.behavioral_drives && a.key_findings.behavioral_drives.length > 0 && (
                                <div>
                                  <h5 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Behavioral Drives</h5>
                                  <ul className="text-xs text-foreground space-y-0.5">
                                    {a.key_findings.behavioral_drives.map((b, i) => (
                                      <li key={i} className="flex items-start gap-1.5">
                                        <Brain className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                                        <span>{b}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {a.key_findings.under_pressure && (
                                <div>
                                  <h5 className="text-xs font-semibold text-danger uppercase tracking-wider mb-1">Under Pressure</h5>
                                  <p className="text-xs text-foreground">{a.key_findings.under_pressure}</p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* AI Coaching Analysis */}
                          {a.ai_analysis && (
                            <div>
                              <h5 className="text-xs font-semibold text-primary uppercase tracking-wider mb-1 flex items-center gap-1">
                                <Sparkles className="w-3 h-3" /> Coaching Analysis
                              </h5>
                              <div className="text-sm text-foreground leading-relaxed whitespace-pre-line">{a.ai_analysis}</div>
                            </div>
                          )}

                          {/* Notes */}
                          {a.notes && (
                            <div>
                              <h5 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Notes</h5>
                              <p className="text-xs text-muted">{a.notes}</p>
                            </div>
                          )}

                          {/* Raw text preview */}
                          {a.raw_text && (
                            <details className="text-xs">
                              <summary className="text-muted cursor-pointer hover:text-foreground">
                                Raw assessment text ({a.raw_text.length.toLocaleString()} chars)
                              </summary>
                              <pre className="mt-2 bg-background rounded-lg p-3 text-muted font-mono text-[10px] max-h-48 overflow-auto whitespace-pre-wrap">
                                {a.raw_text.slice(0, 5000)}{a.raw_text.length > 5000 ? '\n...(truncated)' : ''}
                              </pre>
                            </details>
                          )}

                          {/* Delete */}
                          <div className="pt-1 flex justify-end">
                            <button onClick={() => deleteAssessment(a.id)}
                              className="text-xs text-danger/60 hover:text-danger flex items-center gap-1">
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>

        {/* Transcript Mentions */}
        <section>
          <button onClick={() => toggleSection('transcripts')} className="w-full flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Session History ({transcripts.length})
            </h2>
            {expandedSections.transcripts ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
          </button>
          {expandedSections.transcripts && (
            <div className="space-y-2">
              {transcripts.length === 0 ? (
                <div className="text-center py-6">
                  <FileText className="w-6 h-6 text-muted/30 mx-auto mb-2" />
                  <p className="text-xs text-muted">No transcript mentions found for {contact.name}.</p>
                </div>
              ) : (
                transcripts.map((t) => {
                  // Find quotes from/about this person
                  const name = contact.name.toLowerCase();
                  const firstName = name.split(' ')[0];
                  const relevantQuotes = (t.notable_quotes || []).filter(
                    (q) =>
                      q.speaker?.toLowerCase().includes(firstName) ||
                      q.quote?.toLowerCase().includes(firstName) ||
                      q.context?.toLowerCase().includes(firstName)
                  );

                  return (
                    <Link
                      key={t.id}
                      href={`/transcripts/${t.id}`}
                      className="block bg-card rounded-lg p-3 border border-border/50 hover:border-border transition-all"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <FileText className="w-3.5 h-3.5 text-primary" />
                        <span className="text-sm font-medium text-foreground truncate">
                          {t.title || 'Session'}
                        </span>
                        <span className="text-xs text-muted ml-auto">
                          {format(new Date(t.transcript_date), 'MMM d, yyyy')}
                        </span>
                      </div>
                      {t.summary && (
                        <p className="text-xs text-muted line-clamp-2 mt-1">{t.summary}</p>
                      )}
                      {relevantQuotes.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {relevantQuotes.slice(0, 2).map((q, i) => (
                            <p key={i} className="text-xs text-foreground/70 italic">
                              &ldquo;{q.quote}&rdquo;
                              <span className="text-muted not-italic"> — {q.speaker}</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </Link>
                  );
                })
              )}
            </div>
          )}
        </section>

        {/* Related Commitments */}
        <section>
          <button onClick={() => toggleSection('commitments')} className="w-full flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Related Commitments ({commitments.length})
            </h2>
            {expandedSections.commitments ? <ChevronDown className="w-4 h-4 text-muted" /> : <ChevronRight className="w-4 h-4 text-muted" />}
          </button>
          {expandedSections.commitments && (
            <div className="space-y-1">
              {commitments.length === 0 ? (
                <div className="text-center py-6">
                  <CheckCircle2 className="w-6 h-6 text-muted/30 mx-auto mb-2" />
                  <p className="text-xs text-muted">No open commitments related to {contact.name}.</p>
                </div>
              ) : (
                commitments.map((c) => (
                  <div key={c.id} className="bg-card rounded-lg px-4 py-2.5 border border-border/50">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground">{c.title}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-card-hover text-muted">
                        {getCommitmentTypeLabel(c.commitment_type)}
                      </span>
                    </div>
                    {c.due_date && (
                      <p className="text-xs text-muted mt-0.5">{getDueLabel(c.due_date, c.status)}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
