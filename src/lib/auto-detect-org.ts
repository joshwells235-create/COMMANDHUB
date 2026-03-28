import { createServerClient } from '@/lib/supabase/server';

const COMMON_EMAIL_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'yahoo.co.uk',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'msn.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'ymail.com',
  'mail.com',
  'gmx.com',
  'gmx.net',
  'fastmail.com',
  'hey.com',
  'pm.me',
]);

export interface AutoDetectResult {
  org_id: string;
  contact_id: string;
  is_new: boolean;
}

/**
 * Auto-detect or create an organization from email sender information.
 *
 * Matching order:
 *   1. Exact email match on existing contacts
 *   2. Case-insensitive name match on existing contacts
 *   3. Org name appearing in subject or body preview
 *   4. Domain match against existing contacts' emails
 *   5. Create a new org + contact from the email domain
 *
 * Returns null for common consumer email providers (gmail, outlook, etc.)
 * since those don't represent an organisation.
 */
export async function autoDetectOrganization(
  sender_name: string,
  sender_email: string,
  subject: string,
  body_preview: string
): Promise<AutoDetectResult | null> {
  if (!sender_email) return null;

  const domain = sender_email.split('@')[1]?.toLowerCase();
  if (!domain) return null;

  // Skip consumer email providers
  if (COMMON_EMAIL_PROVIDERS.has(domain)) return null;

  const supabase = createServerClient();

  // ------------------------------------------------------------------
  // 1. Exact email match on existing contacts
  // ------------------------------------------------------------------
  const { data: emailContact } = await supabase
    .from('contacts')
    .select('id, org_id')
    .eq('email', sender_email)
    .limit(1)
    .single();

  if (emailContact?.org_id) {
    return { org_id: emailContact.org_id, contact_id: emailContact.id, is_new: false };
  }

  // ------------------------------------------------------------------
  // 2. Case-insensitive name match on existing contacts
  // ------------------------------------------------------------------
  if (sender_name) {
    const { data: nameContacts } = await supabase
      .from('contacts')
      .select('id, org_id')
      .ilike('name', sender_name)
      .not('org_id', 'is', null)
      .limit(1)
      .single();

    if (nameContacts?.org_id) {
      return { org_id: nameContacts.org_id, contact_id: nameContacts.id, is_new: false };
    }
  }

  // ------------------------------------------------------------------
  // 3. Org name appearing in subject or body preview
  // ------------------------------------------------------------------
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name');

  if (orgs && orgs.length > 0) {
    const haystack = `${subject} ${body_preview}`.toLowerCase();
    for (const org of orgs) {
      if (org.name && haystack.includes(org.name.toLowerCase())) {
        // Found the org — ensure a contact record exists for this sender
        const contact_id = await ensureContact(supabase, sender_name, sender_email, org.id);
        return { org_id: org.id, contact_id, is_new: false };
      }
    }
  }

  // ------------------------------------------------------------------
  // 4. Domain match against existing contacts' email addresses
  // ------------------------------------------------------------------
  const { data: domainContact } = await supabase
    .from('contacts')
    .select('id, org_id')
    .ilike('email', `%@${domain}`)
    .not('org_id', 'is', null)
    .limit(1)
    .single();

  if (domainContact?.org_id) {
    const contact_id = await ensureContact(supabase, sender_name, sender_email, domainContact.org_id);
    return { org_id: domainContact.org_id, contact_id, is_new: false };
  }

  // ------------------------------------------------------------------
  // 5. Create a new org + contact from the email domain
  // ------------------------------------------------------------------
  const orgName = domainToOrgName(domain);
  const today = new Date().toISOString().split('T')[0];

  const { data: newOrg, error: orgError } = await supabase
    .from('organizations')
    .insert({
      name: orgName,
      status: 'prospect',
      strategic_value: 'emerging',
      notes: `Auto-created from email on ${today}. First contact: ${sender_name} (${sender_email})`,
    })
    .select('id')
    .single();

  if (orgError || !newOrg) {
    console.error('autoDetectOrganization: failed to create org', orgError);
    return null;
  }

  const contact_id = await ensureContact(supabase, sender_name, sender_email, newOrg.id);

  return { org_id: newOrg.id, contact_id, is_new: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Ensure a contact record exists for the given sender under the given org.
 * Returns the contact id (existing or newly created).
 */
async function ensureContact(
  supabase: ReturnType<typeof createServerClient>,
  name: string,
  email: string,
  org_id: string
): Promise<string> {
  // Check for existing contact by email first
  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('email', email)
    .limit(1)
    .single();

  if (existing) return existing.id;

  const { data: newContact, error } = await supabase
    .from('contacts')
    .insert({
      name: name || email,
      email,
      org_id,
      relationship_type: 'external',
      notes: 'Auto-created from email sync',
    })
    .select('id')
    .single();

  if (error || !newContact) {
    console.error('ensureContact: failed to create contact', error);
    // Return a placeholder so callers don't break; the org was still created.
    return '';
  }

  return newContact.id;
}

/**
 * Convert an email domain to a human-friendly org name.
 * e.g. "mmg.com" → "MMG", "acme-corp.io" → "ACME-CORP"
 */
function domainToOrgName(domain: string): string {
  // Strip the TLD (.com, .co.uk, etc.)
  const parts = domain.split('.');
  // Handle two-part TLDs like .co.uk
  let namePart: string;
  if (parts.length >= 3 && parts[parts.length - 2].length <= 3) {
    // e.g. foo.co.uk → foo
    namePart = parts.slice(0, -2).join('.');
  } else {
    // e.g. foo.com → foo
    namePart = parts.slice(0, -1).join('.');
  }
  return namePart.toUpperCase();
}
