export type CommitmentType =
  | 'promise_made'
  | 'ask_received'
  | 'follow_up'
  | 'waiting_on'
  | 'deliverable'
  | 'prep'
  | 'internal'
  | 'note_to_self';

export type CommitmentStatus =
  | 'pending'
  | 'in_progress'
  | 'snoozed'
  | 'waiting'
  | 'completed'
  | 'cancelled';

export type StrategicValue = 'strategic' | 'standard' | 'emerging';
export type OrgStatus = 'active' | 'paused' | 'completed' | 'prospect';

export interface Organization {
  id: string;
  name: string;
  industry: string | null;
  notes: string | null;
  status: OrgStatus;
  strategic_value: StrategicValue;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  org_id: string | null;
  name: string;
  role: string | null;
  email: string | null;
  relationship_type: string | null;
  notes: string | null;
  created_at: string;
}

export interface Engagement {
  id: string;
  org_id: string | null;
  name: string;
  type: string | null;
  status: string;
  value_amount: number | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_at: string;
}

export interface Commitment {
  id: string;
  title: string;
  description: string | null;
  commitment_type: CommitmentType;
  org_id: string | null;
  contact_id: string | null;
  engagement_id: string | null;
  other_party: string | null;
  owner: string;
  due_date: string | null;
  snoozed_until: string | null;
  completed_at: string | null;
  last_touched_at: string;
  priority_score: number;
  manual_priority_override: string | null;
  status: CommitmentStatus;
  source_type: string | null;
  source_ref: string | null;
  source_snippet: string | null;
  escalation_level: number;
  last_escalated_at: string | null;
  ai_priority_modifier: number;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  organization?: Organization;
}

export interface CalendarEvent {
  id: string;
  ms_event_id: string;
  subject: string | null;
  body_preview: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
  attendees: Record<string, unknown>[] | null;
  org_id: string | null;
  is_processed: boolean;
  ai_analysis: {
    org_match?: string;
    event_type?: string;
    prep_notes?: string;
    implied_commitments?: Array<{
      title: string;
      description: string;
      commitment_type: string;
      suggested_due: string | null;
      timing: 'before' | 'after';
    }>;
  } | null;
  raw_data: Record<string, unknown> | null;
  created_at: string;
  organization?: Organization;
}

export interface CommitmentActivity {
  id: string;
  commitment_id: string;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export type CommitmentCreateInput = {
  title: string;
  description?: string;
  commitment_type: CommitmentType;
  org_id?: string;
  contact_id?: string;
  engagement_id?: string;
  other_party?: string;
  owner?: string;
  due_date?: string;
  source_type?: string;
  source_ref?: string;
  source_snippet?: string;
  tags?: string[];
};

export type CommitmentUpdateInput = Partial<
  Pick<
    Commitment,
    | 'title'
    | 'description'
    | 'commitment_type'
    | 'org_id'
    | 'contact_id'
    | 'engagement_id'
    | 'other_party'
    | 'owner'
    | 'due_date'
    | 'manual_priority_override'
    | 'tags'
  >
>;
