import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabase = createServerClient();

    const { data: emails, error } = await supabase
      .from('emails')
      .select('*, conversation_id, organization:organizations(id, name, strategic_value, status)')
      .eq('review_status', 'pending')
      .eq('is_processed', true)
      .neq('folder', 'sent')
      .order('received_at', { ascending: false });

    if (error) {
      console.error('Error fetching pending reviews:', error);
      return NextResponse.json({ error: 'Failed to fetch pending reviews' }, { status: 500 });
    }

    return NextResponse.json({ emails: emails || [] });
  } catch (error) {
    console.error('Review fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 });
  }
}
