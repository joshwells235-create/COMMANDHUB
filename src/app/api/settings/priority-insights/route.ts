import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('josh_profile')
      .select('profile_data, updated_at')
      .eq('profile_type', 'priority_patterns_insights')
      .single();

    if (error || !data) {
      return NextResponse.json({
        last_run: null,
        insights: [],
        modifier_rules: [],
      });
    }

    const profileData = data.profile_data as Record<string, unknown>;
    return NextResponse.json({
      last_run: data.updated_at,
      insights: profileData.insights || [],
      modifier_rules: profileData.modifier_rules || [],
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch priority insights' }, { status: 500 });
  }
}
