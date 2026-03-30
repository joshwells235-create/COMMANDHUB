import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { AI_MODEL } from '@/lib/ai';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const { assessment_id } = await request.json();
    if (!assessment_id) {
      return NextResponse.json({ error: 'assessment_id required' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: assessment, error } = await supabase
      .from('assessments')
      .select('*, contacts(name, title, role, coaching_focus, personality_notes)')
      .eq('id', assessment_id)
      .single();

    if (error || !assessment) {
      return NextResponse.json({ error: 'Assessment not found' }, { status: 404 });
    }

    if (!assessment.raw_text) {
      return NextResponse.json({ error: 'No assessment text to analyze' }, { status: 400 });
    }

    const contact = assessment.contacts as { name: string; title: string | null; role: string | null; coaching_focus: string | null; personality_notes: string | null } | null;
    const contactContext = contact
      ? `Person: ${contact.name}${contact.title ? ` (${contact.title})` : ''}${contact.coaching_focus ? `\nCurrent coaching focus: ${contact.coaching_focus}` : ''}${contact.personality_notes ? `\nExisting personality notes: ${contact.personality_notes}` : ''}`
      : '';

    const typeLabels: Record<string, string> = {
      predictive_index: 'Predictive Index (PI) Behavioral Assessment',
      eq_i_2: 'EQ-i 2.0 Emotional Intelligence Assessment',
      five_dysfunctions: 'Five Dysfunctions of a Team Assessment',
      disc: 'DiSC Profile Assessment',
      strengthsfinder: 'CliftonStrengths / StrengthsFinder Assessment',
      mbti: 'Myers-Briggs Type Indicator (MBTI)',
      custom: 'Custom Assessment',
    };

    const typeLabel = typeLabels[assessment.assessment_type] || assessment.assessment_type;

    const client = new Anthropic({ timeout: 90_000 });
    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `You are analyzing a ${typeLabel} for a leadership development coaching context.

${contactContext}

ASSESSMENT TEXT:
${assessment.raw_text.slice(0, 100_000)}

Analyze this assessment and return JSON only (no markdown code blocks):
{
  "summary": "2-4 sentence executive summary of the key findings. What are the headline takeaways for a coach?",
  "key_findings": {
    "scores": {},
    "highlights": ["Top 3-5 standout findings"],
    "areas_of_strength": ["What this person does well naturally"],
    "development_areas": ["Areas for growth or blind spots"],
    "behavioral_drives": ["Core behavioral patterns and motivations"],
    "under_pressure": "How this person likely behaves under stress"
  },
  "ai_analysis": "3-5 paragraph coaching-oriented interpretation. How should Josh approach coaching this person given these results? What language patterns, resistance points, or breakthrough opportunities might arise? Connect the assessment findings to practical coaching strategies. Reference specific scores or findings to support your analysis."
}`,
        },
      ],
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

    // Update the assessment with the analysis
    await supabase
      .from('assessments')
      .update({
        summary: analysis.summary,
        key_findings: analysis.key_findings,
        ai_analysis: analysis.ai_analysis,
        updated_at: new Date().toISOString(),
      })
      .eq('id', assessment_id);

    return NextResponse.json({
      success: true,
      assessment_id,
      summary: analysis.summary,
      key_findings: analysis.key_findings,
      ai_analysis: analysis.ai_analysis,
    });
  } catch (err) {
    console.error('Assessment analysis error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
