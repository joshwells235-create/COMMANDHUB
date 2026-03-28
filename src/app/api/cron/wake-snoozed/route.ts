import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    const { error } = await supabase.rpc('wake_snoozed_commitments');

    if (error) {
      return NextResponse.json(
        { error: 'Failed to wake snoozed commitments', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Snoozed commitments processed' });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal server error', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
