import type { SupabaseClient } from '@supabase/supabase-js';

export interface BusinessContext {
  profile: Record<string, unknown> | null;
  orgRevenue: Record<string, { total: number; deals: number; active_value: number; next_renewal: string | null }>;
}

export async function getBusinessContext(supabase: SupabaseClient): Promise<BusinessContext> {
  const [profileRes, engagementsRes] = await Promise.all([
    supabase
      .from('josh_profile')
      .select('profile_data')
      .eq('profile_type', 'business_context')
      .single(),
    supabase
      .from('engagements')
      .select('org_id, value_amount, status, end_date')
      .not('org_id', 'is', null),
  ]);

  const profile = profileRes.data?.profile_data || null;

  // Aggregate revenue by org
  const orgRevenue: BusinessContext['orgRevenue'] = {};
  for (const e of engagementsRes.data || []) {
    if (!e.org_id) continue;
    if (!orgRevenue[e.org_id]) {
      orgRevenue[e.org_id] = { total: 0, deals: 0, active_value: 0, next_renewal: null };
    }
    const entry = orgRevenue[e.org_id];
    entry.total += Number(e.value_amount) || 0;
    entry.deals += 1;
    if (e.status === 'active' || e.status === 'pending') {
      entry.active_value += Number(e.value_amount) || 0;
      if (e.end_date) {
        if (!entry.next_renewal || e.end_date < entry.next_renewal) {
          entry.next_renewal = e.end_date;
        }
      }
    }
  }

  return { profile, orgRevenue };
}

export function formatBusinessContextForPrompt(ctx: BusinessContext): string {
  if (!ctx.profile) return '';

  const p = ctx.profile as Record<string, unknown>;
  const lines: string[] = ['=== BUSINESS CONTEXT ==='];

  if (p.role) lines.push(`Role: ${p.role}`);

  const rm = p.revenue_model as Record<string, unknown> | undefined;
  if (rm) {
    const cq = rm.current_quarter as Record<string, unknown> | undefined;
    if (cq) {
      lines.push(`Quarterly target: $${(cq.target as number || 0).toLocaleString()} | Closed: $${(cq.closed as number || 0).toLocaleString()} | Gap: $${(cq.gap as number || 0).toLocaleString()}`);
    }
  }

  const sp = p.service_portfolio as Array<{ name: string; typical_price: string; description: string }> | undefined;
  if (sp) {
    lines.push('\nService Portfolio:');
    for (const s of sp) {
      lines.push(`- ${s.name} ($${s.typical_price}): ${s.description}`);
    }
  }

  const cs = p.cross_sell_patterns as string[] | undefined;
  if (cs) {
    lines.push('\nCross-sell patterns:');
    for (const c of cs) lines.push(`- ${c}`);
  }

  const si = p.strategic_insights as Record<string, string> | undefined;
  if (si) {
    lines.push('\nStrategic insights:');
    for (const [k, v] of Object.entries(si)) {
      lines.push(`- ${k.replace(/_/g, ' ')}: ${v}`);
    }
  }

  const ap = p.active_priorities as string[] | undefined;
  if (ap) {
    lines.push('\nActive priorities:');
    for (const a of ap) lines.push(`- ${a}`);
  }

  lines.push('=== END BUSINESS CONTEXT ===');
  return lines.join('\n');
}

export function formatOrgRevenueForPrompt(
  orgId: string,
  orgRevenue: BusinessContext['orgRevenue'],
  engagements?: Array<{ name: string; type: string; status: string; value_amount: number; start_date: string | null; end_date: string | null }>
): string {
  const rev = orgRevenue[orgId];
  if (!rev) return '';

  const lines = [`Revenue: $${rev.total.toLocaleString()} lifetime across ${rev.deals} deals`];
  if (rev.active_value > 0) {
    lines.push(`Active/pipeline value: $${rev.active_value.toLocaleString()}`);
  }
  if (rev.next_renewal) {
    lines.push(`Next renewal: ${rev.next_renewal}`);
  }

  if (engagements && engagements.length > 0) {
    lines.push('Deal history:');
    const sorted = [...engagements].sort((a, b) =>
      (b.start_date || b.end_date || '').localeCompare(a.start_date || a.end_date || '')
    );
    for (const e of sorted.slice(0, 15)) {
      const amt = e.value_amount ? `$${Number(e.value_amount).toLocaleString()}` : '$0';
      const date = e.start_date || e.end_date || '';
      lines.push(`  - ${e.name} | ${amt} | ${e.type || 'Other'} | ${e.status} | ${date}`);
    }
    if (sorted.length > 15) {
      lines.push(`  ... and ${sorted.length - 15} more deals`);
    }
  }

  return lines.join('\n');
}
