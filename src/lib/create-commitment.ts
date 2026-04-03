import { isSimilarCommitment } from '@/lib/dedup-commitment';

type SupabaseClient = ReturnType<typeof import('@/lib/supabase/server').createServerClient>;

interface CommitmentInput {
  title: string;
  description?: string | null;
  commitment_type: string;
  category?: string;
  org_id?: string | null;
  contact_id?: string | null;
  engagement_id?: string | null;
  other_party?: string | null;
  owner?: string;
  due_date?: string | null;
  source_type?: string | null;
  source_ref?: string | null;
  source_snippet?: string | null;
  tags?: string[] | null;
}

interface CreateResult {
  created: boolean;
  id: string | null;
  title: string;
  duplicate_of?: string;
}

/**
 * Check for duplicates then create a commitment if none found.
 * Centralizes dedup logic so all creation paths use the same check.
 */
export async function dedupAndCreateCommitment(
  supabase: SupabaseClient,
  input: CommitmentInput,
): Promise<CreateResult> {
  // Fetch active commitments to check for duplicates
  // Include snoozed — they'll come back and would be duplicates
  let query = supabase
    .from('commitments')
    .select('id, title')
    .in('status', ['pending', 'in_progress', 'waiting', 'snoozed']);

  if (input.org_id) {
    query = query.eq('org_id', input.org_id);
  }

  const { data: existing } = await query;

  // Check for similar existing commitment
  const duplicate = (existing || []).find((c) => isSimilarCommitment(c.title, input.title));
  if (duplicate) {
    return {
      created: false,
      id: null,
      title: input.title,
      duplicate_of: duplicate.title,
    };
  }

  // No duplicate — create
  const now = new Date().toISOString();
  const { data: commitment, error } = await supabase
    .from('commitments')
    .insert({
      title: input.title,
      description: input.description ?? null,
      commitment_type: input.commitment_type,
      category: input.category ?? 'client',
      org_id: input.org_id ?? null,
      contact_id: input.contact_id ?? null,
      engagement_id: input.engagement_id ?? null,
      other_party: input.other_party ?? null,
      owner: input.owner ?? 'josh',
      due_date: input.due_date ?? null,
      source_type: input.source_type ?? null,
      source_ref: input.source_ref ?? null,
      source_snippet: input.source_snippet ?? null,
      tags: input.tags ?? null,
      status: 'pending',
      priority_score: 0,
      escalation_level: 0,
      ai_priority_modifier: 0,
      last_touched_at: now,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`DB error: ${error.message}`);
  }

  // Log activity
  await supabase.from('commitment_activity').insert({
    commitment_id: commitment.id,
    action: 'created',
    details: { title: commitment.title, source: input.source_type || 'manual' },
  });

  return {
    created: true,
    id: commitment.id,
    title: commitment.title,
  };
}
