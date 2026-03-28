/**
 * Text chunking and OpenAI embedding utilities for the RAG pipeline.
 */

/**
 * Split text into overlapping chunks of approximate token size.
 * Uses sentence boundaries (period + space) to avoid splitting mid-sentence.
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

/**
 * Generate a single embedding vector via OpenAI text-embedding-3-small.
 * Returns a 1536-dimensional float array.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI embedding API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a single API call.
 * Returns an array of 1536-dimensional float arrays, one per input text.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: texts,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI embedding API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  // API returns data sorted by index, but sort explicitly to be safe
  const sorted = data.data.sort(
    (a: { index: number }, b: { index: number }) => a.index - b.index
  );
  return sorted.map((item: { embedding: number[] }) => item.embedding);
}
