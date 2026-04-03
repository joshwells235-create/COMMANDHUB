import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const JOSH_OWNER_ID = '176703512';

interface HubSpotDeal {
  id: string;
  properties: {
    dealname: string;
    dealstage: string;
    amount: string | null;
    closedate: string | null;
    pipeline: string;
    hubspot_owner_id: string | null;
    hs_lastmodifieddate: string;
  };
}

interface HubSpotSearchResponse {
  results: HubSpotDeal[];
  total: number;
  paging?: { next?: { after: string } };
}

async function fetchHubSpotDeals(
  filters: Array<{ propertyName: string; operator: string; value?: string; values?: string[] }>,
  limit = 100,
  after?: string,
): Promise<HubSpotSearchResponse> {
  const body: Record<string, unknown> = {
    filterGroups: [{ filters }],
    properties: ['dealname', 'dealstage', 'amount', 'closedate', 'pipeline', 'hubspot_owner_id', 'hs_lastmodifieddate'],
    sorts: [{ propertyName: 'closedate', direction: 'DESCENDING' }],
    limit,
  };
  if (after) body.after = after;

  const resp = await fetch('https://api.hubapi.com/crm/v3/objects/deals/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`HubSpot API error ${resp.status}: ${err}`);
  }

  return resp.json();
}

function matchOrgByDealName(
  dealName: string,
  orgs: Array<{ id: string; name: string }>,
): { id: string; name: string } | null {
  const dealLower = dealName.toLowerCase();

  // Try exact prefix match (deal name starts with org name)
  // Sort by name length descending to prefer longer (more specific) matches
  const sorted = [...orgs].sort((a, b) => b.name.length - a.name.length);
  for (const org of sorted) {
    const orgLower = org.name.toLowerCase();
    if (dealLower.startsWith(orgLower)) return org;
    // Also try: deal name contains org name as a word boundary
    if (dealLower.includes(orgLower + ' ') || dealLower.includes(orgLower + ' -')) return org;
  }

  // Try fuzzy: extract first part before " - " and match
  const dashIdx = dealName.indexOf(' - ');
  if (dashIdx > 0) {
    const prefix = dealName.substring(0, dashIdx).toLowerCase().trim();
    for (const org of sorted) {
      const orgLower = org.name.toLowerCase();
      if (prefix === orgLower) return org;
      // Partial match: "BANGOR" matches "Bangor Savings Bank"
      if (orgLower.startsWith(prefix) || prefix.startsWith(orgLower)) return org;
    }
  }

  return null;
}

function mapDealStage(stage: string): string {
  switch (stage) {
    case 'closedwon': return 'completed';
    case 'closedlost': return 'cancelled';
    default: return 'pending'; // all open stages → pending
  }
}

function inferDealType(dealName: string): string {
  const lower = dealName.toLowerCase();
  if (lower.includes('coaching')) return 'Executive Coaching';
  if (lower.includes('leadership academy') || lower.includes('elite5') || lower.includes('elite 5')) return 'Leadership Academy';
  if (lower.includes('align')) return 'ALIGN';
  if (lower.includes('psl') || lower.includes('people smart')) return 'PSL';
  if (lower.includes('pup')) return 'PUP';
  if (lower.includes('pipc') || lower.includes('certification')) return 'PIPC';
  if (lower.includes('dytt') || lower.includes('dysfunction')) return 'DYTT';
  if (lower.includes('pi ') || lower.includes('pi renewal') || lower.includes('pi license') || lower.includes('pi subscription')) return 'PI License';
  if (lower.includes('renewal')) return 'PI Renewal';
  if (lower.includes('workshop') || lower.includes('change') || lower.includes('tough conversation')) return 'Workshop';
  if (lower.includes('fractional') || lower.includes('advisory')) return 'Consulting';
  return 'Other';
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!HUBSPOT_ACCESS_TOKEN) {
    return NextResponse.json({ error: 'HUBSPOT_ACCESS_TOKEN not configured' }, { status: 500 });
  }

  try {
    const supabase = createServerClient();

    // Fetch all organizations for matching
    const { data: allOrgs } = await supabase
      .from('organizations')
      .select('id, name');
    const orgs = allOrgs || [];

    let created = 0;
    let updated = 0;
    let skipped = 0;

    // --- 1. Sync Josh's closed-won deals (last 12 months for quarterly revenue) ---
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    let after: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const data = await fetchHubSpotDeals(
        [
          { propertyName: 'hubspot_owner_id', operator: 'EQ', value: JOSH_OWNER_ID },
          { propertyName: 'dealstage', operator: 'EQ', value: 'closedwon' },
          { propertyName: 'closedate', operator: 'GTE', value: oneYearAgo.toISOString() },
        ],
        100,
        after,
      );

      for (const deal of data.results) {
        const result = await upsertDeal(supabase, deal, orgs);
        if (result === 'created') created++;
        else if (result === 'updated') updated++;
        else skipped++;
      }

      after = data.paging?.next?.after;
      hasMore = !!after;
    }

    // --- 2. Sync Josh's open pipeline deals ---
    after = undefined;
    hasMore = true;

    while (hasMore) {
      const data = await fetchHubSpotDeals(
        [
          { propertyName: 'hubspot_owner_id', operator: 'EQ', value: JOSH_OWNER_ID },
          { propertyName: 'dealstage', operator: 'NEQ', value: 'closedwon' },
          { propertyName: 'dealstage', operator: 'NEQ', value: 'closedlost' },
        ],
        100,
        after,
      );

      for (const deal of data.results) {
        const result = await upsertDeal(supabase, deal, orgs);
        if (result === 'created') created++;
        else if (result === 'updated') updated++;
        else skipped++;
      }

      after = data.paging?.next?.after;
      hasMore = !!after;
    }

    return NextResponse.json({
      success: true,
      created,
      updated,
      skipped,
      ran_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('HubSpot deal sync error:', error);
    return NextResponse.json(
      { error: 'Sync failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 },
    );
  }
}

async function upsertDeal(
  supabase: ReturnType<typeof createServerClient>,
  deal: HubSpotDeal,
  orgs: Array<{ id: string; name: string }>,
): Promise<'created' | 'updated' | 'skipped'> {
  const { properties } = deal;
  const matchedOrg = matchOrgByDealName(properties.dealname, orgs);
  const status = mapDealStage(properties.dealstage);
  const dealType = inferDealType(properties.dealname);
  const amount = properties.amount ? parseFloat(properties.amount) : null;
  const closeDate = properties.closedate ? properties.closedate.split('T')[0] : null;

  // Check if this deal already exists
  const { data: existing } = await supabase
    .from('engagements')
    .select('id, status, value_amount')
    .eq('hubspot_deal_id', deal.id)
    .single();

  if (existing) {
    // Update if anything changed
    const needsUpdate =
      existing.status !== status ||
      Number(existing.value_amount) !== amount;

    if (needsUpdate) {
      await supabase
        .from('engagements')
        .update({
          status,
          value_amount: amount,
          start_date: closeDate,
          name: properties.dealname,
          type: dealType,
          org_id: matchedOrg?.id || undefined,
        })
        .eq('id', existing.id);
      return 'updated';
    }
    return 'skipped';
  }

  // Create new engagement
  await supabase.from('engagements').insert({
    hubspot_deal_id: deal.id,
    name: properties.dealname,
    type: dealType,
    status,
    value_amount: amount,
    start_date: closeDate,
    end_date: null,
    org_id: matchedOrg?.id || null,
    notes: `Synced from HubSpot deal ${deal.id}`,
  });
  return 'created';
}
