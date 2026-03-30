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
} from 'lucide-react';
import type { Contact, Organization, Commitment } from '@/types/database';
import { cn, getCommitmentTypeLabel, getDueLabel } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';

const RELATIONSHIP_TYPES = [
  'champion', 'decision_maker', 'influencer', 'coach', 'admin',
  'participant', 'coachee', 'sponsor', 'stakeholder', 'partner', 'friend', 'family',
];

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
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    profile: true,
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
      relationship_type: contact.relationship_type || '',
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
                  <select value={editFields.relationship_type}
                    onChange={(e) => setEditFields({ ...editFields, relationship_type: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary">
                    <option value="">None</option>
                    {RELATIONSHIP_TYPES.map((rt) => (
                      <option key={rt} value={rt}>{rt.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
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
                <button onClick={saveEdits} disabled={saving || !editFields.name?.trim()}
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
                    {contact.relationship_type && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                        {contact.relationship_type.replace(/_/g, ' ')}
                      </span>
                    )}
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
