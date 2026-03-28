import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { draft_type, context, org_id, commitment_id } = await request.json();

    if (!draft_type || !context) {
      return NextResponse.json(
        { error: 'draft_type and context are required' },
        { status: 400 }
      );
    }

    const validTypes = ['follow_up_email', 'session_summary', 'proposal_intro', 'general'];
    if (!validTypes.includes(draft_type)) {
      return NextResponse.json(
        { error: `draft_type must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Fetch Josh's voice profile from josh_profile table
    const { data: profileRows, error: profileError } = await supabase
      .from('josh_profile')
      .select('profile_type, profile_data');

    if (profileError) {
      console.error('Error fetching voice profile:', profileError);
    }

    const profileMap: Record<string, unknown> = {};
    for (const row of profileRows || []) {
      profileMap[row.profile_type] = row.profile_data;
    }

    const writingStyle = profileMap['writing_style']
      ? JSON.stringify(profileMap['writing_style'], null, 2)
      : 'No writing style profile available yet. Use a professional, warm, and direct tone.';
    const coachingVoice = profileMap['coaching_voice']
      ? JSON.stringify(profileMap['coaching_voice'], null, 2)
      : "No coaching voice profile available yet. Use an insightful, direct consulting approach that reflects Josh's leadership development expertise.";

    // Build optional context sections
    let orgContext = '';
    if (org_id) {
      const { data: org } = await supabase
        .from('organizations')
        .select('name, industry, status, strategic_value, notes')
        .eq('id', org_id)
        .single();

      if (org) {
        // Fetch recent transcripts for this org
        const { data: recentTranscripts } = await supabase
          .from('transcripts')
          .select('title, summary, transcript_date')
          .eq('org_id', org_id)
          .eq('is_processed', true)
          .order('transcript_date', { ascending: false })
          .limit(3);

        // Fetch open commitments for this org
        const { data: openCommitments } = await supabase
          .from('commitments')
          .select('title, commitment_type, due_date, status, owner')
          .eq('org_id', org_id)
          .in('status', ['pending', 'in_progress', 'waiting', 'snoozed'])
          .order('priority_score', { ascending: false })
          .limit(10);

        const transcriptSummaries = (recentTranscripts || [])
          .map((t) => `- ${t.title} (${t.transcript_date}): ${t.summary || 'No summary'}`)
          .join('\n');

        const commitmentsList = (openCommitments || [])
          .map((c) => `- [${c.commitment_type}] ${c.title} (${c.status}, due: ${c.due_date || 'no date'}, owner: ${c.owner})`)
          .join('\n');

        orgContext = `
Recent relationship context for ${org.name} (${org.industry || 'unknown industry'}, ${org.strategic_value} client, ${org.status}):
${org.notes ? `Notes: ${org.notes}` : ''}

Recent sessions:
${transcriptSummaries || 'No recent sessions'}

Open commitments:
${commitmentsList || 'No open commitments'}`;
      }
    }

    let commitmentContext = '';
    if (commitment_id) {
      const { data: commitment } = await supabase
        .from('commitments')
        .select('title, description, commitment_type, due_date, status, owner, other_party, organizations(name)')
        .eq('id', commitment_id)
        .single();

      if (commitment) {
        commitmentContext = `
This is related to commitment: ${commitment.title}
Type: ${commitment.commitment_type}
Description: ${commitment.description || 'No description'}
Due: ${commitment.due_date || 'No due date'}
Status: ${commitment.status}
Owner: ${commitment.owner}
Other party: ${commitment.other_party || 'N/A'}`;
      }
    }

    const client = new Anthropic();
    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `You are drafting content for Josh Wells, Partner at LeadShift.
Write in Josh's voice using this profile:

Writing Style: ${writingStyle}
Coaching Voice: ${coachingVoice}

Draft type: ${draft_type}
Context: ${context}
${orgContext ? orgContext : ''}
${commitmentContext ? commitmentContext : ''}

Generate the draft. Match Josh's tone, vocabulary, and style exactly.
Keep it concise and actionable. Do not include placeholder brackets or
instructions - write the actual content as Josh would.`,
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No AI response received');
    }

    return NextResponse.json({
      success: true,
      draft: textContent.text,
      draft_type,
    });
  } catch (error) {
    console.error('Draft generation error:', error);
    return NextResponse.json(
      { error: 'Draft generation failed' },
      { status: 500 }
    );
  }
}
