import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai';
import type { StrategicValue } from '@/types/database';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface OrgFollowUpData {
  org_id: string;
  org_name: string;
  strategic_value: StrategicValue;
  days_since_transcript: number;
  days_since_email: number | null;
  overdue_commitments: { title: string; due_date: string; owner: string }[];
  waiting_items: { title: string; other_party: string | null }[];
  client_insights: string | null;
  key_themes: string[] | null;
  score: number;
}

interface FollowUpItem {
  org_id: string;
  org_name: string;
  score: number;
  urgency: 'high' | 'medium' | 'low';
  reason: string;
  suggested_action: string;
  draft_message: string;
  overdue_count: number;
  waiting_count: number;
  days_since_contact: number;
}

function computeScore(data: {
  overdueCount: number;
  daysSinceContact: number;
  waitingCount: number;
  strategicValue: StrategicValue;
}): number {
  let score = 0;

  // Overdue commitments: +30 per overdue item, cap at 60
  score += Math.min(data.overdueCount * 30, 60);

  // Days since contact
  if (data.daysSinceContact >= 30) {
    score += 40;
  } else if (data.daysSinceContact >= 21) {
    score += 25;
  } else if (data.daysSinceContact >= 14) {
    score += 15;
  }

  // Waiting items with no response: +20 per item, cap at 40
  score += Math.min(data.waitingCount * 20, 40);

  // Strategic value multiplier
  const multipliers: Record<StrategicValue, number> = {
    strategic: 1.3,
    standard: 1.0,
    emerging: 0.8,
  };
  score = Math.round(score * (multipliers[data.strategicValue] || 1.0));

  return Math.min(score, 100);
}

export async function GET() {
  try {
    const supabase = createServerClient();
    const now = new Date();

    // Fetch all active client organizations (exclude own business)
    const { data: orgs, error: orgsError } = await supabase
      .from('organizations')
      .select('id, name, strategic_value')
      .eq('status', 'active')
      .eq('is_own_business', false);

    if (orgsError) {
      return NextResponse.json({ error: orgsError.message }, { status: 500 });
    }

    if (!orgs || orgs.length === 0) {
      return NextResponse.json([]);
    }

    const orgIds = orgs.map((o) => o.id);

    // Fetch transcripts, commitments, and emails in parallel
    const [transcriptsRes, commitmentsRes, emailsRes, insightsRes] = await Promise.all([
      supabase
        .from('transcripts')
        .select('org_id, transcript_date')
        .in('org_id', orgIds)
        .order('transcript_date', { ascending: false }),
      supabase
        .from('commitments')
        .select('org_id, title, status, due_date, owner, other_party')
        .in('org_id', orgIds)
        .in('status', ['pending', 'in_progress', 'waiting']),
      supabase
        .from('emails')
        .select('org_id, received_at')
        .in('org_id', orgIds)
        .order('received_at', { ascending: false }),
      supabase
        .from('transcripts')
        .select('org_id, client_insights, key_themes')
        .in('org_id', orgIds)
        .not('client_insights', 'is', null)
        .order('transcript_date', { ascending: false }),
    ]);

    const transcripts = transcriptsRes.data || [];
    const commitments = commitmentsRes.data || [];
    const emails = emailsRes.data || [];
    const insights = insightsRes.data || [];

    // Group data by org
    const lastTranscriptByOrg = new Map<string, string>();
    for (const t of transcripts) {
      if (t.org_id && !lastTranscriptByOrg.has(t.org_id)) {
        lastTranscriptByOrg.set(t.org_id, t.transcript_date);
      }
    }

    const lastEmailByOrg = new Map<string, string>();
    for (const e of emails) {
      if (e.org_id && !lastEmailByOrg.has(e.org_id)) {
        lastEmailByOrg.set(e.org_id, e.received_at);
      }
    }

    const insightsByOrg = new Map<string, { client_insights: string | null; key_themes: string[] | null }>();
    for (const i of insights) {
      if (i.org_id && !insightsByOrg.has(i.org_id)) {
        insightsByOrg.set(i.org_id, {
          client_insights: i.client_insights,
          key_themes: i.key_themes,
        });
      }
    }

    // Build scored org list
    const scoredOrgs: OrgFollowUpData[] = orgs.map((org) => {
      const lastTranscript = lastTranscriptByOrg.get(org.id);
      const lastEmail = lastEmailByOrg.get(org.id);
      const orgInsights = insightsByOrg.get(org.id);

      const daysSinceTranscript = lastTranscript
        ? Math.floor((now.getTime() - new Date(lastTranscript).getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      const daysSinceEmail = lastEmail
        ? Math.floor((now.getTime() - new Date(lastEmail).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      const daysSinceContact = daysSinceEmail !== null
        ? Math.min(daysSinceTranscript, daysSinceEmail)
        : daysSinceTranscript;

      const orgCommitments = commitments.filter((c) => c.org_id === org.id);

      const overdue = orgCommitments.filter(
        (c) =>
          c.due_date &&
          new Date(c.due_date) < now &&
          !['completed', 'cancelled'].includes(c.status)
      );

      const waiting = orgCommitments.filter(
        (c) => c.owner !== 'josh' && c.status === 'waiting'
      );

      const score = computeScore({
        overdueCount: overdue.length,
        daysSinceContact,
        waitingCount: waiting.length,
        strategicValue: org.strategic_value as StrategicValue,
      });

      return {
        org_id: org.id,
        org_name: org.name,
        strategic_value: org.strategic_value as StrategicValue,
        days_since_transcript: daysSinceTranscript,
        days_since_email: daysSinceEmail,
        overdue_commitments: overdue.map((c) => ({
          title: c.title,
          due_date: c.due_date!,
          owner: c.owner,
        })),
        waiting_items: waiting.map((c) => ({
          title: c.title,
          other_party: c.other_party,
        })),
        client_insights: orgInsights?.client_insights || null,
        key_themes: orgInsights?.key_themes || null,
        score,
      };
    });

    // Filter to orgs scoring > 20
    const needsFollowUp = scoredOrgs
      .filter((o) => o.score > 20)
      .sort((a, b) => b.score - a.score);

    if (needsFollowUp.length === 0) {
      return NextResponse.json([]);
    }

    // Take top 5 for AI generation
    const top5 = needsFollowUp.slice(0, 5);

    // Fetch Josh's voice profile
    const { data: profileRows } = await supabase
      .from('josh_profile')
      .select('profile_type, profile_data');

    const profileMap: Record<string, unknown> = {};
    for (const row of profileRows || []) {
      profileMap[row.profile_type] = row.profile_data;
    }

    const voiceNote = profileMap['writing_style']
      ? `Write in Josh's voice using this style profile: ${JSON.stringify(profileMap['writing_style'])}`
      : 'Use a professional, warm, and direct tone.';

    // Build context for all top 5 orgs in one prompt
    const orgContextBlocks = top5.map((org, idx) => {
      const overdueList = org.overdue_commitments.length > 0
        ? org.overdue_commitments.map((c) => `  - "${c.title}" (due ${c.due_date}, owner: ${c.owner})`).join('\n')
        : '  None';

      const waitingList = org.waiting_items.length > 0
        ? org.waiting_items.map((c) => `  - "${c.title}" (from: ${c.other_party || 'unknown'})`).join('\n')
        : '  None';

      const daysSinceContact = org.days_since_email !== null
        ? Math.min(org.days_since_transcript, org.days_since_email)
        : org.days_since_transcript;

      return `
--- Org ${idx + 1}: ${org.org_name} (ID: ${org.org_id}) ---
Strategic value: ${org.strategic_value}
Days since last session: ${org.days_since_transcript === 999 ? 'No sessions recorded' : org.days_since_transcript}
Days since last email: ${org.days_since_email ?? 'No emails recorded'}
Days since any contact: ${daysSinceContact === 999 ? 'No contact recorded' : daysSinceContact}
Follow-up urgency score: ${org.score}/100

Overdue commitments:
${overdueList}

Items waiting on them:
${waitingList}

Recent insights: ${org.client_insights || 'None available'}
Key themes: ${org.key_themes?.join(', ') || 'None available'}`;
    }).join('\n\n');

    const prompt = `You are helping Josh Wells, a leadership development partner at LeadShift, decide who to follow up with and what to say.

${voiceNote}

For each of the following organizations, generate:
1. "reason" - Why Josh should reach out (1 concise sentence)
2. "suggested_action" - What to do: "email", "call", or "schedule session"
3. "draft_message" - A short ready-to-send message (2-3 sentences, in Josh's voice)
4. "urgency" - "high", "medium", or "low"

${orgContextBlocks}

Respond with a JSON array of objects, one per org, in the same order. Each object must have: org_id, reason, suggested_action, draft_message, urgency. No extra text outside the JSON.`;

    const client = new Anthropic();
    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    let aiResults: { org_id: string; reason: string; suggested_action: string; draft_message: string; urgency: 'high' | 'medium' | 'low' }[] = [];

    if (textContent && textContent.type === 'text') {
      try {
        const jsonMatch = textContent.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          aiResults = JSON.parse(jsonMatch[0]);
        }
      } catch {
        console.error('Failed to parse AI follow-up response');
      }
    }

    // Merge AI results with scored data
    const results: FollowUpItem[] = top5.map((org) => {
      const ai = aiResults.find((r) => r.org_id === org.org_id);
      const daysSinceContact = org.days_since_email !== null
        ? Math.min(org.days_since_transcript, org.days_since_email)
        : org.days_since_transcript;

      return {
        org_id: org.org_id,
        org_name: org.org_name,
        score: org.score,
        urgency: ai?.urgency || (org.score >= 60 ? 'high' : org.score >= 35 ? 'medium' : 'low'),
        reason: ai?.reason || `${org.overdue_commitments.length} overdue items, ${daysSinceContact === 999 ? 'no recent contact' : `${daysSinceContact} days since contact`}`,
        suggested_action: ai?.suggested_action || 'email',
        draft_message: ai?.draft_message || '',
        overdue_count: org.overdue_commitments.length,
        waiting_count: org.waiting_items.length,
        days_since_contact: daysSinceContact === 999 ? -1 : daysSinceContact,
      };
    });

    // Also include remaining orgs (beyond top 5) without AI-generated content
    const remaining = needsFollowUp.slice(5).map((org) => {
      const daysSinceContact = org.days_since_email !== null
        ? Math.min(org.days_since_transcript, org.days_since_email)
        : org.days_since_transcript;

      return {
        org_id: org.org_id,
        org_name: org.org_name,
        score: org.score,
        urgency: (org.score >= 60 ? 'high' : org.score >= 35 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
        reason: `${org.overdue_commitments.length} overdue items, ${daysSinceContact === 999 ? 'no recent contact' : `${daysSinceContact} days since contact`}`,
        suggested_action: 'email',
        draft_message: '',
        overdue_count: org.overdue_commitments.length,
        waiting_count: org.waiting_items.length,
        days_since_contact: daysSinceContact === 999 ? -1 : daysSinceContact,
      };
    });

    return NextResponse.json([...results, ...remaining]);
  } catch (err) {
    console.error('Follow-up queue error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
