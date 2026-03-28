import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import type { CommitmentType } from '@/types/database';

export const runtime = 'nodejs';

interface ExtractedCommitment {
  title: string;
  description?: string;
  commitment_type: string;
  owner: string;
  other_party?: string;
  suggested_due?: string | null;
  confidence: string;
  source_quote?: string;
}

interface AiExtraction {
  org_match?: string | null;
  email_summary?: string;
  needs_reply?: boolean;
  reply_urgency?: string;
  commitments: ExtractedCommitment[];
}

const VALID_COMMITMENT_TYPES: CommitmentType[] = [
  'promise_made',
  'ask_received',
  'follow_up',
  'waiting_on',
  'deliverable',
  'prep',
  'internal',
  'note_to_self',
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { action, selected_indices } = await request.json();

    if (!action || !['accept_all', 'accept_selected', 'dismiss'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be accept_all, accept_selected, or dismiss' },
        { status: 400 }
      );
    }

    if (action === 'accept_selected' && (!Array.isArray(selected_indices) || selected_indices.length === 0)) {
      return NextResponse.json(
        { error: 'selected_indices required for accept_selected action' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Fetch the email with its extraction
    const { data: email, error: emailError } = await supabase
      .from('emails')
      .select('*')
      .eq('id', id)
      .single();

    if (emailError || !email) {
      return NextResponse.json({ error: 'Email not found' }, { status: 404 });
    }

    if (!email.ai_extraction) {
      return NextResponse.json({ error: 'Email has no AI extraction data' }, { status: 400 });
    }

    const extraction = email.ai_extraction as AiExtraction;

    if (action === 'dismiss') {
      await supabase
        .from('emails')
        .update({ review_status: 'dismissed' })
        .eq('id', id);

      return NextResponse.json({ success: true, action: 'dismissed', commitments_created: 0 });
    }

    // Determine which commitments to create
    const allCommitments = extraction.commitments || [];
    let commitmentsToCreate: ExtractedCommitment[];

    if (action === 'accept_all') {
      commitmentsToCreate = allCommitments;
    } else {
      // accept_selected
      commitmentsToCreate = selected_indices!
        .filter((i: number) => i >= 0 && i < allCommitments.length)
        .map((i: number) => allCommitments[i]);
    }

    // Match org from extraction
    let matchedOrgId: string | null = email.org_id || null;
    if (!matchedOrgId && extraction.org_match) {
      const { data: orgs } = await supabase
        .from('organizations')
        .select('id, name')
        .ilike('name', extraction.org_match);

      if (orgs && orgs.length > 0) {
        matchedOrgId = orgs[0].id;
      }
    }

    // Create commitments
    const createdCommitments: string[] = [];

    for (const item of commitmentsToCreate) {
      const commitmentType = VALID_COMMITMENT_TYPES.includes(item.commitment_type as CommitmentType)
        ? item.commitment_type
        : 'follow_up';

      const { data: commitment, error: insertError } = await supabase
        .from('commitments')
        .insert({
          title: item.title,
          description: item.description || null,
          commitment_type: commitmentType,
          org_id: matchedOrgId,
          other_party: item.other_party || null,
          owner: item.owner || 'josh',
          due_date: item.suggested_due || null,
          source_type: 'email',
          source_ref: email.id,
          source_snippet: item.source_quote || null,
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('Error creating commitment:', insertError);
        continue;
      }

      if (commitment) {
        createdCommitments.push(commitment.id);

        // Log commitment activity
        await supabase.from('commitment_activity').insert({
          commitment_id: commitment.id,
          action: 'created',
          details: {
            source: 'email_extraction',
            email_id: email.id,
            confidence: item.confidence,
            review_action: action,
          },
        });
      }
    }

    // Mark email as reviewed
    await supabase
      .from('emails')
      .update({ review_status: 'reviewed' })
      .eq('id', id);

    return NextResponse.json({
      success: true,
      action,
      commitments_created: createdCommitments.length,
      commitment_ids: createdCommitments,
    });
  } catch (error) {
    console.error('Review action error:', error);
    return NextResponse.json(
      { error: 'Review action failed' },
      { status: 500 }
    );
  }
}
