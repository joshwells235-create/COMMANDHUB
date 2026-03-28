import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

type LifecycleStage =
  | 'prospecting'
  | 'onboarding'
  | 'building_trust'
  | 'deep_work'
  | 'sustaining'
  | 'winding_down'
  | 'at_risk';

interface OrgLifecycle {
  org_id: string;
  org_name: string;
  stage: LifecycleStage;
  confidence: number;
  signals: string[];
  stage_entered: string | null;
  next_stage_prediction: string | null;
  alert: string | null;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function computeLifecycle(
  now: Date,
  transcripts: { transcript_date: string }[],
  commitments: { commitment_type: string; status: string; due_date: string | null }[],
  engagements: { start_date: string | null; end_date: string | null; type: string | null; status: string }[],
  contactCount: number
): Omit<OrgLifecycle, 'org_id' | 'org_name'> {
  const signals: string[] = [];
  const transcriptCount = transcripts.length;

  // Sort transcripts by date descending
  const sorted = [...transcripts].sort(
    (a, b) => new Date(b.transcript_date).getTime() - new Date(a.transcript_date).getTime()
  );

  // Days since last transcript
  const daysSinceLast = sorted.length > 0
    ? daysBetween(now, new Date(sorted[0].transcript_date))
    : null;

  // Engagement age (earliest engagement start_date or earliest transcript)
  const engagementStarts = engagements
    .filter((e) => e.start_date)
    .map((e) => new Date(e.start_date!));
  const transcriptDates = sorted.map((t) => new Date(t.transcript_date));
  const allDates = [...engagementStarts, ...transcriptDates];
  const earliestDate = allDates.length > 0
    ? new Date(Math.min(...allDates.map((d) => d.getTime())))
    : null;
  const engagementAgeDays = earliestDate ? daysBetween(now, earliestDate) : 0;

  // Engagement end_date approaching?
  const activeEngagement = engagements.find((e) => e.status === 'active');
  const endDateApproaching = activeEngagement?.end_date
    ? daysBetween(now, new Date(activeEngagement.end_date)) <= 30 && new Date(activeEngagement.end_date) > now
    : false;

  // Commitment type distribution
  const commitmentTypes = new Set(commitments.map((c) => c.commitment_type));
  const typeCount = commitmentTypes.size;
  const totalCommitments = commitments.length;
  const completed = commitments.filter((c) => c.status === 'completed').length;
  const completionRate = totalCommitments > 0 ? completed / totalCommitments : 0;
  const overdue = commitments.filter(
    (c) => c.due_date && new Date(c.due_date) < now && !['completed', 'cancelled'].includes(c.status)
  ).length;

  const followUpAndDeliverable = commitments.filter(
    (c) => c.commitment_type === 'follow_up' || c.commitment_type === 'deliverable'
  ).length;
  const mostlyFollowUpDeliverable = totalCommitments > 0 && followUpAndDeliverable / totalCommitments >= 0.6;

  // Session frequency (average days between sessions in last 90 days)
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const recentTranscripts = sorted.filter((t) => new Date(t.transcript_date) >= ninetyDaysAgo);

  let avgFrequency: number | null = null;
  if (recentTranscripts.length >= 2) {
    const dates = recentTranscripts.map((t) => new Date(t.transcript_date).getTime());
    let totalGap = 0;
    for (let i = 0; i < dates.length - 1; i++) {
      totalGap += dates[i] - dates[i + 1];
    }
    avgFrequency = Math.round(totalGap / (dates.length - 1) / (1000 * 60 * 60 * 24));
  }

  // Frequency trend: last 30 days vs prior 30 days
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date(now);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const recentCount = sorted.filter((t) => new Date(t.transcript_date) >= thirtyDaysAgo).length;
  const priorCount = sorted.filter(
    (t) => new Date(t.transcript_date) >= sixtyDaysAgo && new Date(t.transcript_date) < thirtyDaysAgo
  ).length;
  const frequencyDeclining = priorCount > 0 && recentCount < priorCount;
  const frequencyDropPct = priorCount > 0 ? Math.round(((priorCount - recentCount) / priorCount) * 100) : 0;

  // New commitments in last 30 days (approximation: commitments without completed_at recently)
  const recentCommitments = commitments.filter(
    (c) => !['completed', 'cancelled'].includes(c.status)
  );

  // Determine stage
  let stage: LifecycleStage;
  let confidence: number;

  // At Risk: no transcript in 45+ days with prior history
  if (transcriptCount > 0 && daysSinceLast !== null && daysSinceLast >= 45) {
    stage = 'at_risk';
    confidence = Math.min(0.95, 0.7 + (daysSinceLast > 60 ? 0.2 : 0.1) + (overdue > 1 ? 0.1 : 0));
    signals.push(`No session in ${daysSinceLast} days`);
    if (overdue > 0) signals.push(`${overdue} overdue commitment${overdue > 1 ? 's' : ''}`);
    signals.push('Engagement was active but has gone quiet');
  }
  // Winding Down
  else if (
    (daysSinceLast !== null && daysSinceLast >= 30) ||
    endDateApproaching ||
    (frequencyDeclining && transcriptCount >= 5 && recentCommitments.length <= 2)
  ) {
    stage = 'winding_down';
    confidence = 0.7;
    if (daysSinceLast !== null && daysSinceLast >= 30) signals.push(`${daysSinceLast} days since last session`);
    if (endDateApproaching) signals.push('Engagement end date approaching');
    if (frequencyDeclining) signals.push('Session frequency declining');
    if (recentCommitments.length <= 2) signals.push('Few active commitments remain');
  }
  // Prospecting
  else if (transcriptCount === 0 || (transcriptCount === 1 && engagementAgeDays < 14)) {
    stage = 'prospecting';
    confidence = transcriptCount === 0 ? 0.9 : 0.75;
    if (transcriptCount === 0) signals.push('No sessions yet');
    else signals.push('1 session, engagement < 2 weeks old');
    if (contactCount > 0) signals.push(`${contactCount} contact${contactCount > 1 ? 's' : ''} identified`);
  }
  // Onboarding
  else if (transcriptCount >= 1 && transcriptCount <= 3 && engagementAgeDays < 42 && mostlyFollowUpDeliverable) {
    stage = 'onboarding';
    confidence = 0.8;
    signals.push(`${transcriptCount} session${transcriptCount > 1 ? 's' : ''} in ${engagementAgeDays} days`);
    signals.push('Commitments mostly follow-up and deliverable types');
    if (engagements.length > 0) signals.push('Active engagement established');
  }
  // Deep Work
  else if (transcriptCount >= 8 && avgFrequency !== null && avgFrequency <= 21 && typeCount >= 3) {
    stage = 'deep_work';
    confidence = 0.85;
    const months = Math.round(engagementAgeDays / 30);
    signals.push(`${transcriptCount} sessions over ${months} month${months !== 1 ? 's' : ''}`);
    signals.push('Diverse commitment types');
    if (avgFrequency <= 14) signals.push('Weekly-ish cadence');
    else signals.push('Biweekly cadence');
    if (completionRate >= 0.7) signals.push(`${Math.round(completionRate * 100)}% commitment completion`);
  }
  // Sustaining
  else if (transcriptCount >= 8 && (frequencyDeclining || (avgFrequency !== null && avgFrequency > 21))) {
    stage = 'sustaining';
    confidence = 0.75;
    signals.push(`${transcriptCount} sessions total`);
    if (frequencyDeclining) signals.push('Session frequency declining from peak');
    if (avgFrequency !== null) signals.push(`~${avgFrequency} day cadence`);
    signals.push('Established relationship with stable patterns');
  }
  // Building Trust (fallback for 3-8 sessions)
  else if (transcriptCount >= 3 && transcriptCount < 8) {
    stage = 'building_trust';
    confidence = 0.75;
    signals.push(`${transcriptCount} sessions so far`);
    if (typeCount >= 2) signals.push('Mix of commitment types emerging');
    if (completionRate >= 0.5) signals.push('Early follow-through patterns forming');
    if (contactCount > 1) signals.push(`${contactCount} contacts engaged`);
  }
  // Edge cases that fall through - use engagement age and transcript count
  else if (transcriptCount >= 1 && transcriptCount <= 3) {
    stage = 'onboarding';
    confidence = 0.6;
    signals.push(`${transcriptCount} session${transcriptCount > 1 ? 's' : ''}`);
    signals.push('Early stage engagement');
  } else {
    // 8+ transcripts, no frequency decline, but low type diversity
    stage = 'deep_work';
    confidence = 0.6;
    signals.push(`${transcriptCount} sessions`);
    signals.push('Mature engagement');
  }

  // Estimate stage_entered date
  let stageEntered: string | null = null;
  if (stage === 'prospecting') {
    stageEntered = earliestDate ? earliestDate.toISOString().split('T')[0] : null;
  } else if (stage === 'onboarding' && sorted.length > 0) {
    stageEntered = sorted[sorted.length - 1].transcript_date;
  } else if (stage === 'building_trust' && sorted.length >= 3) {
    stageEntered = sorted[sorted.length - 3]?.transcript_date || null;
  } else if (stage === 'deep_work' && sorted.length >= 8) {
    stageEntered = sorted[sorted.length - 8]?.transcript_date || null;
  } else if ((stage === 'sustaining' || stage === 'winding_down' || stage === 'at_risk') && sorted.length > 0) {
    // Approximate: use the date when frequency started changing
    stageEntered = sorted[Math.min(2, sorted.length - 1)]?.transcript_date || null;
  }

  // Next stage prediction
  let nextStagePrediction: string | null = null;
  if (stage === 'prospecting') {
    nextStagePrediction = 'Will move to onboarding once regular sessions begin';
  } else if (stage === 'onboarding') {
    nextStagePrediction = 'Building trust phase expected after 3+ sessions';
  } else if (stage === 'building_trust') {
    const sessionsToDeepWork = 8 - transcriptCount;
    if (avgFrequency) {
      const weeksEstimate = Math.round((sessionsToDeepWork * avgFrequency) / 7);
      nextStagePrediction = `Deep work in ~${weeksEstimate} weeks at current cadence`;
    } else {
      nextStagePrediction = `${sessionsToDeepWork} more sessions to deep work phase`;
    }
  } else if (stage === 'deep_work') {
    if (frequencyDeclining) {
      nextStagePrediction = 'Sustaining in ~2 months if cadence holds';
    } else {
      nextStagePrediction = 'Sustained deep work - monitor for natural transition';
    }
  } else if (stage === 'sustaining') {
    nextStagePrediction = 'Monitor for re-engagement or natural wind-down';
  } else if (stage === 'winding_down') {
    nextStagePrediction = 'At risk if no session within 2 weeks';
  } else if (stage === 'at_risk') {
    nextStagePrediction = 'Needs immediate outreach to re-engage';
  }

  // Build alert
  let alert: string | null = null;
  if (frequencyDeclining && frequencyDropPct >= 40 && stage !== 'at_risk' && stage !== 'winding_down') {
    alert = `Session frequency dropped ${frequencyDropPct}% this month - monitor for wind-down`;
  }
  if (overdue >= 3) {
    const overdueAlert = `${overdue} commitments overdue - follow-through may be impacting relationship`;
    alert = alert ? `${alert}. ${overdueAlert}` : overdueAlert;
  }

  return {
    stage,
    confidence: Math.round(confidence * 100) / 100,
    signals,
    stage_entered: stageEntered,
    next_stage_prediction: nextStagePrediction,
    alert,
  };
}

export async function GET() {
  try {
    const supabase = createServerClient();

    // Fetch all active organizations
    const { data: orgs, error: orgsError } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('status', 'active');

    if (orgsError) {
      return NextResponse.json({ error: orgsError.message }, { status: 500 });
    }

    if (!orgs || orgs.length === 0) {
      return NextResponse.json([]);
    }

    const orgIds = orgs.map((o) => o.id);
    const now = new Date();

    // Fetch all data in parallel
    const [transcriptsRes, commitmentsRes, engagementsRes, contactsRes] = await Promise.all([
      supabase
        .from('transcripts')
        .select('org_id, transcript_date')
        .in('org_id', orgIds)
        .order('transcript_date', { ascending: false }),
      supabase
        .from('commitments')
        .select('org_id, commitment_type, status, due_date')
        .in('org_id', orgIds),
      supabase
        .from('engagements')
        .select('org_id, start_date, end_date, type, status')
        .in('org_id', orgIds),
      supabase
        .from('contacts')
        .select('org_id, relationship_type')
        .in('org_id', orgIds),
    ]);

    const transcripts = transcriptsRes.data || [];
    const commitments = commitmentsRes.data || [];
    const engagements = engagementsRes.data || [];
    const contacts = contactsRes.data || [];

    // Group by org
    const transcriptsByOrg = new Map<string, { transcript_date: string }[]>();
    for (const t of transcripts) {
      if (!t.org_id) continue;
      if (!transcriptsByOrg.has(t.org_id)) transcriptsByOrg.set(t.org_id, []);
      transcriptsByOrg.get(t.org_id)!.push(t);
    }

    const commitmentsByOrg = new Map<string, { commitment_type: string; status: string; due_date: string | null }[]>();
    for (const c of commitments) {
      if (!c.org_id) continue;
      if (!commitmentsByOrg.has(c.org_id)) commitmentsByOrg.set(c.org_id, []);
      commitmentsByOrg.get(c.org_id)!.push(c);
    }

    const engagementsByOrg = new Map<string, { start_date: string | null; end_date: string | null; type: string | null; status: string }[]>();
    for (const e of engagements) {
      if (!e.org_id) continue;
      if (!engagementsByOrg.has(e.org_id)) engagementsByOrg.set(e.org_id, []);
      engagementsByOrg.get(e.org_id)!.push(e);
    }

    const contactCountByOrg = new Map<string, number>();
    for (const c of contacts) {
      if (!c.org_id) continue;
      contactCountByOrg.set(c.org_id, (contactCountByOrg.get(c.org_id) || 0) + 1);
    }

    const results: OrgLifecycle[] = orgs.map((org) => {
      const lifecycle = computeLifecycle(
        now,
        transcriptsByOrg.get(org.id) || [],
        commitmentsByOrg.get(org.id) || [],
        engagementsByOrg.get(org.id) || [],
        contactCountByOrg.get(org.id) || 0
      );

      return {
        org_id: org.id,
        org_name: org.name,
        ...lifecycle,
      };
    });

    // Sort by stage priority (at_risk first, then winding_down, etc.)
    const stagePriority: Record<LifecycleStage, number> = {
      at_risk: 0,
      winding_down: 1,
      prospecting: 2,
      onboarding: 3,
      building_trust: 4,
      sustaining: 5,
      deep_work: 6,
    };

    results.sort((a, b) => stagePriority[a.stage] - stagePriority[b.stage]);

    return NextResponse.json(results);
  } catch (err) {
    console.error('Lifecycle analysis error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const orgId = body.org_id as string | undefined;

    if (!orgId) {
      return NextResponse.json(
        { error: 'org_id is required for detailed lifecycle analysis' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    const { data: org } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .single();

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const now = new Date();

    // Fetch all relevant data
    const [transcriptsRes, commitmentsRes, engagementsRes, contactsRes] = await Promise.all([
      supabase
        .from('transcripts')
        .select('org_id, transcript_date, summary')
        .eq('org_id', orgId)
        .order('transcript_date', { ascending: false }),
      supabase
        .from('commitments')
        .select('org_id, commitment_type, status, due_date, title, owner')
        .eq('org_id', orgId),
      supabase
        .from('engagements')
        .select('org_id, start_date, end_date, type, status, name')
        .eq('org_id', orgId),
      supabase
        .from('contacts')
        .select('org_id, name, role, relationship_type')
        .eq('org_id', orgId),
    ]);

    const transcripts = transcriptsRes.data || [];
    const commitments = commitmentsRes.data || [];
    const engagements = engagementsRes.data || [];
    const contacts = contactsRes.data || [];

    // Compute deterministic lifecycle first
    const lifecycle = computeLifecycle(now, transcripts, commitments, engagements, contacts.length);

    // Build context for Claude
    const transcriptSummary = transcripts
      .slice(0, 5)
      .map((t) => `- ${t.transcript_date}: ${t.summary || 'No summary'}`)
      .join('\n') || 'No sessions recorded';

    const commitmentSummary = commitments
      .map((c) => `- [${c.status}] ${c.title} (${c.commitment_type}, owner: ${c.owner}${c.due_date ? ', due ' + c.due_date : ''})`)
      .join('\n') || 'No commitments';

    const engagementSummary = engagements
      .map((e) => `- ${e.name} (${e.type || 'untyped'}, ${e.status}${e.start_date ? ', started ' + e.start_date : ''}${e.end_date ? ', ends ' + e.end_date : ''})`)
      .join('\n') || 'No engagements';

    const contactSummary = contacts
      .map((c) => `- ${c.name}${c.role ? ' (' + c.role + ')' : ''}${c.relationship_type ? ' - ' + c.relationship_type : ''}`)
      .join('\n') || 'No contacts';

    const stageLabels: Record<LifecycleStage, string> = {
      prospecting: 'Prospecting',
      onboarding: 'Onboarding',
      building_trust: 'Building Trust',
      deep_work: 'Deep Work',
      sustaining: 'Sustaining',
      winding_down: 'Winding Down',
      at_risk: 'At Risk',
    };

    const prompt = `You are a coaching practice advisor analyzing the engagement lifecycle for a client organization.

Client: ${org.name}
Industry: ${org.industry || 'Not specified'}
Current Lifecycle Stage: ${stageLabels[lifecycle.stage]} (confidence: ${lifecycle.confidence})
Signals: ${lifecycle.signals.join('; ')}
${lifecycle.alert ? `Alert: ${lifecycle.alert}` : ''}

Total sessions: ${transcripts.length}
Total commitments: ${commitments.length}
Contacts: ${contacts.length}

Recent sessions:
${transcriptSummary}

Commitments:
${commitmentSummary}

Engagements:
${engagementSummary}

Contacts:
${contactSummary}

Based on this lifecycle stage and data, provide a detailed analysis with specific recommendations. Return JSON only (no markdown code blocks):
{
  "stage_analysis": "2-3 sentence deep analysis of why this org is at this lifecycle stage",
  "key_indicators": ["list of specific data points that confirm this stage"],
  "risks": ["specific risks for this stage and this client"],
  "opportunities": ["specific opportunities given the lifecycle stage"],
  "recommendations": [
    {
      "action": "specific action to take",
      "rationale": "why this matters at this lifecycle stage",
      "priority": "high|medium|low",
      "timeframe": "this week|this month|next quarter"
    }
  ],
  "transition_plan": "What needs to happen to move this client to the next healthy stage"
}`;

    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No AI response received');
    }

    let jsonStr = textContent.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }
    const analysis = JSON.parse(jsonStr);

    return NextResponse.json({
      org_id: orgId,
      org_name: org.name,
      lifecycle: {
        stage: lifecycle.stage,
        confidence: lifecycle.confidence,
        signals: lifecycle.signals,
        stage_entered: lifecycle.stage_entered,
        next_stage_prediction: lifecycle.next_stage_prediction,
        alert: lifecycle.alert,
      },
      analysis,
    });
  } catch (error) {
    console.error('Lifecycle detail error:', error);
    return NextResponse.json(
      { error: 'Failed to generate lifecycle analysis' },
      { status: 500 }
    );
  }
}
