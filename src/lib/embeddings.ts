/**
 * Text chunking utilities for the transcript pipeline.
 * Search uses PostgreSQL full-text search (pg_trgm) instead of vector embeddings.
 */

/**
 * Split text into overlapping chunks of approximate token size.
 * Uses sentence boundaries to avoid splitting mid-sentence.
 */
export function chunkText(
  text: string,
  chunkSize: number = 600,
  overlap: number = 100
): string[] {
  const sentences = text.split(/(?<=\.)\s+/);
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentWordCount = 0;

  for (const sentence of sentences) {
    const sentenceWordCount = sentence.split(/\s+/).length;

    if (currentWordCount + sentenceWordCount > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));

      // Build overlap from the end of the current chunk
      const overlapSentences: string[] = [];
      let overlapWordCount = 0;
      for (let i = currentChunk.length - 1; i >= 0; i--) {
        const words = currentChunk[i].split(/\s+/).length;
        if (overlapWordCount + words > overlap) break;
        overlapSentences.unshift(currentChunk[i]);
        overlapWordCount += words;
      }

      currentChunk = [...overlapSentences, sentence];
      currentWordCount = overlapWordCount + sentenceWordCount;
    } else {
      currentChunk.push(sentence);
      currentWordCount += sentenceWordCount;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }

  return chunks;
}
