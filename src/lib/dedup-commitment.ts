// Smart commitment deduplication using word overlap instead of substring matching.
// Handles cases like "Reschedule PI renewal meeting with Kathy" matching
// "Prepare for PI renewal meeting with Kathy Piotte" — same entity, different verb.

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'up', 'about', 'into', 'over', 'after', 'before', 'between',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'not', 'no', 'nor', 'if', 'then', 'than', 'so', 'as',
  // Common commitment verbs that shouldn't differentiate
  'follow', 'send', 'review', 'prepare', 'schedule', 'reschedule',
  'respond', 'contact', 'check', 'confirm', 'update', 'complete',
  'attend', 'discuss', 'reach', 'out', 'back', 'get', 'set',
  'make', 'take', 'give', 'find', 'look', 'need', 'want',
]);

function extractKeyWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Check if two commitment titles are about the same thing.
 * Uses word overlap: if 50%+ of the shorter title's key words appear in the longer one,
 * they're considered duplicates.
 */
export function isSimilarCommitment(titleA: string, titleB: string): boolean {
  // First try exact/substring (fast path)
  const a = titleA.toLowerCase().trim();
  const b = titleB.toLowerCase().trim();
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  // Extract key words and compare overlap
  const wordsA = extractKeyWords(titleA);
  const wordsB = extractKeyWords(titleB);

  if (wordsA.length === 0 || wordsB.length === 0) return false;

  const shorter = wordsA.length <= wordsB.length ? wordsA : wordsB;
  const longerSet = new Set(wordsA.length > wordsB.length ? wordsA : wordsB);

  const matches = shorter.filter(w => longerSet.has(w)).length;
  const overlapRatio = matches / shorter.length;

  // 50% overlap of key words = same thing
  return overlapRatio >= 0.5 && matches >= 2;
}
