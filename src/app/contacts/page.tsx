'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Zap,
  ArrowLeft,
  User,
  Plus,
  Search,
  Building2,
  Phone,
  Mail,
  X,
  Loader2,
  Users,
  Briefcase,
  Heart,
  Handshake,
} from 'lucide-react';
import type { Contact, Organization, ContactCategory } from '@/types/database';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

const RELATIONSHIP_TYPES = [
  'champion', 'decision_maker', 'influencer', 'coach', 'admin',
  'participant', 'coachee', 'sponsor', 'stakeholder', 'partner', 'friend', 'family',
];

const CATEGORY_OPTIONS: { value: ContactCategory; label: string; icon: typeof Users }[] = [
  { value: 'business', label: 'Business', icon: Briefcase },
  { value: 'personal', label: 'Personal', icon: Heart },
  { value: 'partner', label: 'Partner', icon: Handshake },
];

const categoryColor: Record<ContactCategory, string> = {
  business: 'bg-primary/20 text-primary',
  personal: 'bg-violet-500/20 text-violet-400',
  partner: 'bg-amber-500/20 text-amber-400',
};

const relationshipColor: Record<string, string> = {
  champion: 'text-success',
  decision_maker: 'text-primary',
  sponsor: 'text-amber-400',
  coachee: 'text-violet-400',
  stakeholder: 'text-muted',
  influencer: 'text-cyan-400',
  partner: 'text-amber-400',
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<(Contact & { organizations?: { id: string; name: string } | null })[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<ContactCategory | ''>('');
  const [filterOrg, setFilterOrg] = useState('');
  const [filterRelationship, setFilterRelationship] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);

  const [newContact, setNewContact] = useState({
    name: '', title: '', role: '', email: '', phone: '', linkedin_url: '',
    org_id: '', company: '', category: 'business' as ContactCategory,
    relationship_type: [] as string[], notes: '', personality_notes: '', coaching_focus: '',
    communication_style: '',
  });

  const fetchContacts = useCallback(async () => {
    try {
      const [contactsRes, orgsRes] = await Promise.all([
        fetch('/api/contacts'),
        fetch('/api/organizations'),
      ]);
      const contactsData = await contactsRes.json();
      const orgsData = await orgsRes.json();
      setContacts(Array.isArray(contactsData) ? contactsData : []);
      setOrganizations(Array.isArray(orgsData) ? orgsData : []);
    } catch {
      console.error('Failed to fetch contacts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  async function handleAdd() {
    if (!newContact.name.trim()) return;
    setAdding(true);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newContact,
          org_id: newContact.org_id || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to create contact');
      toast.success(`Added ${newContact.name}`);
      setNewContact({
        name: '', title: '', role: '', email: '', phone: '', linkedin_url: '',
        org_id: '', company: '', category: 'business', relationship_type: [],
        notes: '', personality_notes: '', coaching_focus: '', communication_style: '',
      });
      setShowAdd(false);
      fetchContacts();
    } catch {
      toast.error('Failed to add contact');
    } finally {
      setAdding(false);
    }
  }

  // Filter contacts
  const filtered = contacts.filter((c) => {
    if (search) {
      const q = search.toLowerCase();
      const matchesSearch =
        c.name?.toLowerCase().includes(q) ||
        c.title?.toLowerCase().includes(q) ||
        c.role?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q) ||
        (c.organizations as { name: string } | null)?.name?.toLowerCase().includes(q);
      if (!matchesSearch) return false;
    }
    if (filterCategory && c.category !== filterCategory) return false;
    if (filterOrg && c.org_id !== filterOrg) return false;
    if (filterRelationship && (!c.relationship_type || !c.relationship_type.includes(filterRelationship))) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl header-gradient-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="text-muted hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold tracking-tight">PEOPLE</h1>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-1.5 btn-gradient text-white rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Add Person
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4 pb-24">
        {/* Add Contact Form */}
        {showAdd && (
          <div className="bg-card rounded-lg border border-border/50 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">New Contact</h2>
              <button onClick={() => setShowAdd(false)} className="text-muted hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Category tabs */}
            <div className="flex gap-2">
              {CATEGORY_OPTIONS.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => setNewContact({ ...newContact, category: cat.value })}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    newContact.category === cat.value
                      ? categoryColor[cat.value]
                      : 'bg-card-hover text-muted hover:text-foreground'
                  )}
                >
                  <cat.icon className="w-3.5 h-3.5" />
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Full name *"
                value={newContact.name}
                onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                className="col-span-2 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                autoFocus
              />
              <input
                type="text"
                placeholder="Job title"
                value={newContact.title}
                onChange={(e) => setNewContact({ ...newContact, title: e.target.value })}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
              <div className="bg-background border border-border rounded-lg px-3 py-2">
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {newContact.relationship_type.map((rt) => (
                    <button key={rt} type="button"
                      onClick={() => setNewContact({ ...newContact, relationship_type: newContact.relationship_type.filter((t) => t !== rt) })}
                      className={`text-xs px-2 py-0.5 rounded-full ${relationshipColor[rt] || 'text-muted'} bg-white/10 hover:bg-white/20 transition-colors flex items-center gap-1`}>
                      {rt.replace(/_/g, ' ')} <X className="w-3 h-3" />
                    </button>
                  ))}
                </div>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value && !newContact.relationship_type.includes(e.target.value)) {
                      setNewContact({ ...newContact, relationship_type: [...newContact.relationship_type, e.target.value] });
                    }
                  }}
                  className="bg-transparent text-sm focus:outline-none w-full"
                >
                  <option value="">{newContact.relationship_type.length ? 'Add another...' : 'Relationship type'}</option>
                  {RELATIONSHIP_TYPES.filter((rt) => !newContact.relationship_type.includes(rt)).map((rt) => (
                    <option key={rt} value={rt}>{rt.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <input
                type="email"
                placeholder="Email"
                value={newContact.email}
                onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
              <input
                type="tel"
                placeholder="Phone"
                value={newContact.phone}
                onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
              <select
                value={newContact.org_id}
                onChange={(e) => setNewContact({ ...newContact, org_id: e.target.value })}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
              >
                <option value="">Organization (optional)</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              {!newContact.org_id && (
                <input
                  type="text"
                  placeholder="Company name"
                  value={newContact.company}
                  onChange={(e) => setNewContact({ ...newContact, company: e.target.value })}
                  className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              )}
              <input
                type="url"
                placeholder="LinkedIn URL"
                value={newContact.linkedin_url}
                onChange={(e) => setNewContact({ ...newContact, linkedin_url: e.target.value })}
                className="col-span-2 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
              <textarea
                placeholder="Notes"
                value={newContact.notes}
                onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
                rows={2}
                className="col-span-2 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
              />
            </div>

            {/* Coaching-specific fields */}
            {(newContact.relationship_type.includes('coachee') || newContact.category === 'business') && (
              <div className="grid grid-cols-2 gap-3">
                <textarea
                  placeholder="Coaching focus / what they're working on"
                  value={newContact.coaching_focus}
                  onChange={(e) => setNewContact({ ...newContact, coaching_focus: e.target.value })}
                  rows={2}
                  className="col-span-2 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
                />
                <textarea
                  placeholder="Personality notes / behavioral style"
                  value={newContact.personality_notes}
                  onChange={(e) => setNewContact({ ...newContact, personality_notes: e.target.value })}
                  rows={2}
                  className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
                />
                <textarea
                  placeholder="Communication style / preferences"
                  value={newContact.communication_style}
                  onChange={(e) => setNewContact({ ...newContact, communication_style: e.target.value })}
                  rows={2}
                  className="bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none"
                />
              </div>
            )}

            <button
              onClick={handleAdd}
              disabled={adding || !newContact.name.trim()}
              className="flex items-center gap-2 px-4 py-2 btn-gradient text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Contact
            </button>
          </div>
        )}

        {/* Search + Filters */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              type="text"
              placeholder="Search people by name, title, email, company..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-border/50 rounded-lg text-sm focus:outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Category filter */}
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value as ContactCategory | '')}
              className="bg-card border border-border/50 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-primary"
            >
              <option value="">All categories</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>

            {/* Org filter */}
            <select
              value={filterOrg}
              onChange={(e) => setFilterOrg(e.target.value)}
              className="bg-card border border-border/50 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-primary"
            >
              <option value="">All organizations</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>

            {/* Relationship filter */}
            <select
              value={filterRelationship}
              onChange={(e) => setFilterRelationship(e.target.value)}
              className="bg-card border border-border/50 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-primary"
            >
              <option value="">All relationships</option>
              {RELATIONSHIP_TYPES.map((rt) => (
                <option key={rt} value={rt}>{rt.replace(/_/g, ' ')}</option>
              ))}
            </select>

            {(filterCategory || filterOrg || filterRelationship || search) && (
              <button
                onClick={() => { setFilterCategory(''); setFilterOrg(''); setFilterRelationship(''); setSearch(''); }}
                className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted hover:text-foreground"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
        </div>

        {/* Results count */}
        <p className="text-xs text-muted">
          {filtered.length} {filtered.length === 1 ? 'person' : 'people'}
          {search || filterCategory || filterOrg || filterRelationship ? ' matching filters' : ''}
        </p>

        {/* Contact list */}
        {loading ? (
          <div className="flex items-center gap-2 justify-center py-12 text-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading people...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <Users className="w-8 h-8 text-muted/30 mb-2" />
            <p className="text-sm text-muted">
              {contacts.length === 0 ? 'No contacts yet.' : 'No contacts match your filters.'}
            </p>
            {contacts.length === 0 && (
              <button
                onClick={() => setShowAdd(true)}
                className="text-primary text-sm mt-2"
              >
                Add your first contact
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((contact) => {
              const org = contact.organizations as { id: string; name: string } | null;
              return (
                <Link
                  key={contact.id}
                  href={`/contacts/${contact.id}`}
                  className="flex items-center gap-3 bg-card rounded-lg px-4 py-3 hover:bg-card-hover transition-all border border-transparent hover:border-border"
                >
                  <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground truncate">
                        {contact.name}
                      </p>
                      {contact.category && contact.category !== 'business' && (
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', categoryColor[contact.category])}>
                          {contact.category}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted flex-wrap">
                      {contact.title && <span>{contact.title}</span>}
                      {contact.title && (org || contact.company) && <span>&middot;</span>}
                      {org ? (
                        <span className="flex items-center gap-0.5">
                          <Building2 className="w-3 h-3" />
                          {org.name}
                        </span>
                      ) : contact.company ? (
                        <span className="flex items-center gap-0.5">
                          <Building2 className="w-3 h-3" />
                          {contact.company}
                        </span>
                      ) : null}
                      {contact.relationship_type && contact.relationship_type.length > 0 && (
                        <>
                          <span>&middot;</span>
                          {contact.relationship_type.map((rt) => (
                            <span key={rt} className={relationshipColor[rt] || 'text-muted'}>
                              {rt.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {contact.email && <Mail className="w-3.5 h-3.5 text-muted/50" />}
                    {contact.phone && <Phone className="w-3.5 h-3.5 text-muted/50" />}
                    {contact.last_interaction_date && (
                      <span className="text-[10px] text-muted/60">
                        {formatDistanceToNow(new Date(contact.last_interaction_date), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
