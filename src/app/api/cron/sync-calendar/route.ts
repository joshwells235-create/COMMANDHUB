import { NextResponse } from 'next/server';
import { syncCalendar } from '@/lib/microsoft-graph';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await syncCalendar();
    return NextResponse.json({ success: true, message: 'Calendar synced' });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to sync calendar', details: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
