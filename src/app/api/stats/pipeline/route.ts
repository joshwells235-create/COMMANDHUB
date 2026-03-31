import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createServerClient();
    const now = new Date();

    // Fetch business context for quarterly target
    const { data: bizCtx } = await supabase
      .from('josh_profile')
      .select('profile_data')
      .eq('profile_type', 'business_context')
      .single();

    const revenueModel = (bizCtx?.profile_data as Record<string, unknown>)?.revenue_model as Record<string, unknown> | undefined;
    const quarterlyTarget = (revenueModel?.quarterly_target as number) || 225000;

    // Current quarter boundaries
    const currentMonth = now.getMonth();
    const quarterStart = new Date(now.getFullYear(), Math.floor(currentMonth / 3) * 3, 1);
    const quarterEnd = new Date(now.getFullYear(), Math.floor(currentMonth / 3) * 3 + 3, 0);
    const quarterLabel = `${now.getFullYear()} Q${Math.floor(currentMonth / 3) + 1}`;

    // Revenue closed this quarter (completed engagements with start_date in this quarter)
    const { data: closedThisQuarter } = await supabase
      .from('engagements')
      .select('value_amount')
      .eq('status', 'completed')
      .gte('start_date', quarterStart.toISOString())
      .lte('start_date', quarterEnd.toISOString());

    const closedRevenue = (closedThisQuarter || []).reduce(
      (sum, e) => sum + (Number(e.value_amount) || 0), 0
    );

    // Open pipeline (pending engagements)
    const { data: pipeline } = await supabase
      .from('engagements')
      .select('id, name, type, status, value_amount, end_date, org_id, organizations(name)')
      .eq('status', 'pending')
      .order('end_date', { ascending: true });

    const totalPipeline = (pipeline || []).reduce(
      (sum, e) => sum + (Number(e.value_amount) || 0), 0
    );

    // Upcoming renewals (next 60 days)
    const sixtyDaysOut = new Date(now);
    sixtyDaysOut.setDate(sixtyDaysOut.getDate() + 60);

    const renewals = (pipeline || []).filter(e => {
      if (!e.end_date) return false;
      const end = new Date(e.end_date);
      return end >= now && end <= sixtyDaysOut;
    });

    const renewalValue = renewals.reduce(
      (sum, e) => sum + (Number(e.value_amount) || 0), 0
    );

    // Group pipeline by month
    const monthlyPipeline: Record<string, { month: string; total: number; deals: number; items: Array<{ name: string; org: string; amount: number; type: string }> }> = {};

    for (const deal of pipeline || []) {
      const date = deal.end_date ? new Date(deal.end_date) : null;
      if (!date) continue;
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

      if (!monthlyPipeline[monthKey]) {
        monthlyPipeline[monthKey] = { month: monthLabel, total: 0, deals: 0, items: [] };
      }
      const entry = monthlyPipeline[monthKey];
      entry.total += Number(deal.value_amount) || 0;
      entry.deals += 1;
      const orgName = (deal.organizations as unknown as { name: string } | null)?.name || 'Unknown';
      entry.items.push({
        name: deal.name,
        org: orgName,
        amount: Number(deal.value_amount) || 0,
        type: deal.type || 'Other',
      });
    }

    // Sort months chronologically
    const sortedMonths = Object.entries(monthlyPipeline)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);

    return NextResponse.json({
      quarterlyPace: {
        quarter: quarterLabel,
        target: quarterlyTarget,
        closed: Math.round(closedRevenue),
        gap: Math.round(quarterlyTarget - closedRevenue),
        pacePercent: Math.round((closedRevenue / quarterlyTarget) * 100),
      },
      pipeline: {
        total: Math.round(totalPipeline),
        dealCount: (pipeline || []).length,
        byMonth: sortedMonths,
      },
      renewals: {
        upcoming60Days: renewals.length,
        value: Math.round(renewalValue),
        items: renewals.map(r => ({
          name: r.name,
          org: (r.organizations as unknown as { name: string } | null)?.name || 'Unknown',
          amount: Number(r.value_amount) || 0,
          dueDate: r.end_date,
        })),
      },
    });
  } catch (error) {
    console.error('Pipeline stats error:', error);
    return NextResponse.json({ error: 'Failed to compute pipeline stats' }, { status: 500 });
  }
}
