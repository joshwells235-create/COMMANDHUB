'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Organization, Contact, Commitment } from '@/types/database';

export interface TranscriptTheme {
  theme: string;
  category: string;
  description: string;
}

export interface LanguageLeak {
  quote: string;
  leak_type: string;
  interpretation: string;
}

export interface ClientInsights {
  patterns_observed?: string;
  breakthroughs?: string;
  resistance_points?: string;
  growth_areas?: string;
  language_leaks_observed?: LanguageLeak[];
  frameworks_used?: string[];
  recommended_focus_next_session?: string;
  emotional_state?: string;
  engagement_level?: string;
  resistance_areas?: string[];
  language_patterns?: string[];
}

export interface Transcript {
  id: string;
  org_id: string | null;
  title: string | null;
  transcript_date: string;
  transcript_type: string | null;
  participants: string[] | null;
  duration_minutes: number | null;
  raw_text: string | null;
  summary: string | null;
  key_themes: TranscriptTheme[] | string[] | null;
  client_insights: ClientInsights | null;
  session_arc: string | null;
  notable_quotes: Array<{ quote: string; context: string; speaker: string }> | null;
  ai_extraction: Record<string, unknown> | null;
  review_status: string | null;
  is_processed: boolean;
  created_at: string;
}

interface ClientDetailData {
  organization: Organization | null;
  commitments: Commitment[];
  completedCommitments: Commitment[];
  contacts: Contact[];
  transcripts: Transcript[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useClientDetail(orgId: string): ClientDetailData {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [completedCommitments, setCompletedCommitments] = useState<Commitment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [orgRes, commRes, completedRes, contactsRes, transcriptsRes] =
        await Promise.all([
          fetch(`/api/organizations/${orgId}`),
          fetch(`/api/commitments?org_id=${orgId}&status=pending,in_progress,snoozed,waiting`),
          fetch(`/api/commitments?org_id=${orgId}&status=completed`),
          fetch(`/api/contacts?org_id=${orgId}`),
          fetch(`/api/transcripts?org_id=${orgId}`),
        ]);

      if (!orgRes.ok) throw new Error('Failed to fetch organization');

      const [orgData, commData, completedData, contactsData, transcriptsRaw] =
        await Promise.all([
          orgRes.json(),
          commRes.ok ? commRes.json() : [],
          completedRes.ok ? completedRes.json() : [],
          contactsRes.ok ? contactsRes.json() : [],
          transcriptsRes.ok ? transcriptsRes.json() : { transcripts: [] },
        ]);

      setOrganization(orgData);
      setCommitments(commData);
      setCompletedCommitments(completedData);
      setContacts(contactsData);
      // Handle both wrapped { transcripts: [...] } and raw array responses
      setTranscripts(
        Array.isArray(transcriptsRaw)
          ? transcriptsRaw
          : transcriptsRaw.transcripts || []
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    organization,
    commitments,
    completedCommitments,
    contacts,
    transcripts,
    loading,
    error,
    refresh: fetchAll,
  };
}
