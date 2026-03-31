import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('josh_profile')
      .select('profile_data, updated_at')
      .eq('profile_type', 'business_context')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data?.profile_data || {});
  } catch {
    return NextResponse.json({ error: 'Failed to fetch business context' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = createServerClient();
    const updates = await request.json();

    // Fetch current profile
    const { data: existing } = await supabase
      .from('josh_profile')
      .select('id, profile_data')
      .eq('profile_type', 'business_context')
      .single();

    if (!existing) {
      // Create if doesn't exist
      const { error } = await supabase
        .from('josh_profile')
        .insert({
          profile_type: 'business_context',
          profile_data: updates,
        });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, action: 'created' });
    }

    // Deep merge updates into existing profile_data
    const merged = deepMerge(existing.profile_data as Record<string, unknown>, updates);

    const { error } = await supabase
      .from('josh_profile')
      .update({
        profile_data: merged,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, action: 'updated' });
  } catch {
    return NextResponse.json({ error: 'Failed to update business context' }, { status: 500 });
  }
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const targetVal = target[key];
    const sourceVal = source[key];

    if (Array.isArray(sourceVal) && Array.isArray(targetVal)) {
      // For arrays, replace entirely (caller decides what the new array should be)
      result[key] = sourceVal;
    } else if (
      sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal) &&
      targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal as Record<string, unknown>, sourceVal as Record<string, unknown>);
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}
