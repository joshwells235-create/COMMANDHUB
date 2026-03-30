/**
 * Fuzzy organization matching utilities.
 *
 * Used by email extraction, calendar sync, and the backfill cron to resolve
 * an AI-returned org name (or attendee information) to an org ID.
 */

interface OrgRecord {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface ContactRecord {
  id: string;
  name: string;
  email: string | null;
  org_id: string | null;
  [key: string]: unknown;
}

/**
 * Match an AI-returned org name against the organizations list.
 *
 * Matching strategy (in order of priority):
 *   1. Exact case-insensitive match
 *   2. One name contains the other (handles "Acme" vs "Acme Corporation")
 *   3. Word-overlap scoring (handles "First National Bank" vs "First National")
 *
 * Returns the matched org or null.
 */
export function matchOrgByName(
  orgMatch: string,
  orgs: OrgRecord[]
): OrgRecord | null {
  if (!orgMatch) return null;
  const target = orgMatch.toLowerCase().trim();
  if (!target) return null;

  // 1. Exact match
  const exact = orgs.find((o) => o.name.toLowerCase().trim() === target);
  if (exact) return exact;

  // 2. Containment match — one name contains the other
  const containment = orgs.find((o) => {
    const name = o.name.toLowerCase().trim();
    return name.includes(target) || target.includes(name);
  });
  if (containment) return containment;

  // 3. Word-overlap scoring — require at least 50% word overlap and minimum 2 shared words
  const targetWords = new Set(target.split(/\s+/).filter((w) => w.length > 1));
  if (targetWords.size === 0) return null;

  let bestOrg: OrgRecord | null = null;
  let bestScore = 0;

  for (const org of orgs) {
    const orgWords = new Set(
      org.name.toLowerCase().trim().split(/\s+/).filter((w) => w.length > 1)
    );
    if (orgWords.size === 0) continue;

    let overlap = 0;
    for (const w of targetWords) {
      if (orgWords.has(w)) overlap++;
    }

    const maxLen = Math.max(targetWords.size, orgWords.size);
    const score = overlap / maxLen;

    if (overlap >= 2 && score > bestScore && score >= 0.5) {
      bestScore = score;
      bestOrg = org;
    }
  }

  return bestOrg;
}

/**
 * Try to determine org_id from attendee emails/names by looking up the contacts table.
 * Returns the first org_id found, or null.
 */
export function matchOrgByContacts(
  emailAddresses: string[],
  names: string[],
  contacts: ContactRecord[]
): string | null {
  if (!contacts || contacts.length === 0) return null;

  // 1. Match by email address
  for (const addr of emailAddresses) {
    if (!addr) continue;
    const lower = addr.toLowerCase().trim();
    const contact = contacts.find(
      (c) => c.email && c.email.toLowerCase().trim() === lower && c.org_id
    );
    if (contact?.org_id) return contact.org_id;
  }

  // 2. Match by name (case-insensitive)
  for (const name of names) {
    if (!name) continue;
    const lower = name.toLowerCase().trim();
    const contact = contacts.find(
      (c) => c.name && c.name.toLowerCase().trim() === lower && c.org_id
    );
    if (contact?.org_id) return contact.org_id;
  }

  // 3. Match by email domain — if multiple contacts at the same domain share an org
  for (const addr of emailAddresses) {
    if (!addr) continue;
    const domain = addr.split('@')[1]?.toLowerCase();
    if (!domain) continue;
    // Skip common consumer domains
    const consumerDomains = new Set([
      'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'live.com',
      'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'msn.com',
    ]);
    if (consumerDomains.has(domain)) continue;

    const contact = contacts.find(
      (c) => c.email && c.email.toLowerCase().endsWith(`@${domain}`) && c.org_id
    );
    if (contact?.org_id) return contact.org_id;
  }

  return null;
}

/**
 * Match an event subject line against org names.
 * Returns the first matched org or null.
 */
export function matchOrgBySubject(
  subject: string,
  orgs: OrgRecord[]
): OrgRecord | null {
  if (!subject) return null;
  const lower = subject.toLowerCase();

  for (const org of orgs) {
    const orgName = org.name.toLowerCase().trim();
    // Only match org names with at least 3 characters to avoid false positives
    if (orgName.length >= 3 && lower.includes(orgName)) {
      return org;
    }
  }

  return null;
}
