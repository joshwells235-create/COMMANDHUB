import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import type { ReviewEmail } from '@/types/database';

export async function GET() {
  try {
    const supabase = createServerClient();

    // Fetch all processed pending RECEIVED emails - filter for needs_reply in code
    // since Supabase JSON querying can be tricky
    const { data, error } = await supabase
      .from('emails')
      .select('*, organization:organizations(id, name)')
      .eq('is_processed', true)
      .neq('review_status', 'dismissed')
      .neq('folder', 'sent')
      .order('received_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Filter for emails where AI extraction indicates needs_reply
    const needsReply = (data as ReviewEmail[]).filter(
      (email) => email.ai_extraction?.needs_reply === true
    );

    return NextResponse.json(needsReply);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
