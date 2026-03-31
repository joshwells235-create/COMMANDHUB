import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { SEED_ORGS, SEED_CONTACTS, SEED_ENGAGEMENTS, BUSINESS_CONTEXT_PROFILE } from '@/lib/seed-data';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const url = new URL(request.url);
  const keyParam = url.searchParams.get('key');
  const secret = process.env.CRON_SECRET;

  if (authHeader !== `Bearer ${secret}` && keyParam !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const results = {
    organizations: { created: 0, updated: 0, errors: [] as string[] },
    contacts: { created: 0, updated: 0, errors: [] as string[] },
    engagements: { created: 0, skipped: 0, errors: [] as string[] },
    businessContext: { success: false, error: '' },
  };

  // ── Step 1: Upsert Organizations ──────────────────────────────────
  const orgIdMap: Record<string, string> = {};

  for (const org of SEED_ORGS) {
    try {
      // Check if org exists (case-insensitive)
      const { data: existing } = await supabase
        .from('organizations')
        .select('id, name')
        .ilike('name', org.name)
        .limit(1)
        .single();

      if (existing) {
        // Update existing org
        await supabase
          .from('organizations')
          .update({
            industry: org.industry,
            strategic_value: org.strategic_value,
            notes: org.notes,
            intelligence: org.intelligence,
            is_own_business: org.is_own_business || false,
            status: org.status,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        orgIdMap[org.name] = existing.id;
        results.organizations.updated++;
      } else {
        // Create new org
        const { data: created, error } = await supabase
          .from('organizations')
          .insert({
            name: org.name,
            industry: org.industry,
            status: org.status,
            strategic_value: org.strategic_value,
            notes: org.notes,
            intelligence: org.intelligence,
            is_own_business: org.is_own_business || false,
          })
          .select('id')
          .single();

        if (error) throw new Error(error.message);
        if (created) {
          orgIdMap[org.name] = created.id;
          results.organizations.created++;
        }
      }
    } catch (err) {
      results.organizations.errors.push(`${org.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  // ── Step 2: Upsert Contacts ──────────────────────────────────
  for (const contact of SEED_CONTACTS) {
    try {
      const orgId = orgIdMap[contact.org_name];
      if (!orgId) {
        results.contacts.errors.push(`${contact.name}: org not found (${contact.org_name})`);
        continue;
      }

      // Check if contact exists for this org
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('org_id', orgId)
        .ilike('name', contact.name)
        .limit(1)
        .single();

      if (existing) {
        await supabase
          .from('contacts')
          .update({
            role: contact.role || null,
            relationship_type: contact.relationship_type,
            coaching_focus: contact.coaching_focus || null,
            personality_notes: contact.personality_notes || null,
          })
          .eq('id', existing.id);
        results.contacts.updated++;
      } else {
        const { error } = await supabase
          .from('contacts')
          .insert({
            org_id: orgId,
            name: contact.name,
            role: contact.role || null,
            relationship_type: contact.relationship_type,
            coaching_focus: contact.coaching_focus || null,
            personality_notes: contact.personality_notes || null,
          });
        if (error) throw new Error(error.message);
        results.contacts.created++;
      }
    } catch (err) {
      results.contacts.errors.push(`${contact.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  // ── Step 3: Insert Engagements ──────────────────────────────────
  for (const eng of SEED_ENGAGEMENTS) {
    try {
      const orgId = orgIdMap[eng.org_name];
      if (!orgId) {
        results.engagements.errors.push(`${eng.name}: org not found (${eng.org_name})`);
        continue;
      }

      // Check if engagement already exists (by name + org)
      const { data: existing } = await supabase
        .from('engagements')
        .select('id')
        .eq('org_id', orgId)
        .eq('name', eng.name)
        .limit(1)
        .single();

      if (existing) {
        results.engagements.skipped++;
        continue;
      }

      const { error } = await supabase
        .from('engagements')
        .insert({
          org_id: orgId,
          name: eng.name,
          type: eng.type,
          status: eng.status,
          value_amount: eng.value_amount,
          start_date: eng.close_date,
          end_date: eng.status === 'pending' ? eng.close_date : null,
          notes: eng.pipeline,
        });
      if (error) throw new Error(error.message);
      results.engagements.created++;
    } catch (err) {
      results.engagements.errors.push(`${eng.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  // ── Step 4: Upsert Business Context Profile ──────────────────────────
  try {
    const { data: existing } = await supabase
      .from('josh_profile')
      .select('id')
      .eq('profile_type', 'business_context')
      .limit(1)
      .single();

    if (existing) {
      await supabase
        .from('josh_profile')
        .update({
          profile_data: BUSINESS_CONTEXT_PROFILE,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('josh_profile')
        .insert({
          profile_type: 'business_context',
          profile_data: BUSINESS_CONTEXT_PROFILE,
        });
    }
    results.businessContext.success = true;
  } catch (err) {
    results.businessContext.error = err instanceof Error ? err.message : 'Unknown error';
  }

  return NextResponse.json({
    success: true,
    results,
    org_count: Object.keys(orgIdMap).length,
  });
}
