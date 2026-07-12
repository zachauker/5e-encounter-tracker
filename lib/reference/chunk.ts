export interface Chunk { content: string; sourceRef: string; ordinal: number; tokenCount: number }

export interface ChunkOptions {
  sourceLabel: string;               // e.g. "SRD", "EGtW"
  maxTokens?: number;                // default 600
  overlapTokens?: number;            // default 80
  pageOf?: (charIndex: number) => number | null; // for PDFs: char offset -> page number
}

/** ~4 chars per token heuristic (good enough for chunk sizing; real tokenization not needed). */
export function estimateTokens(s: string): number {
  return Math.round(s.length / 4);
}

interface Section { heading: string | null; text: string; startIndex: number }

function splitSections(text: string): Section[] {
  const lines = text.split(/\r?\n/);
  const sections: Section[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  let idx = 0;
  let sectionStart = 0;
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) sections.push({ heading, text: body, startIndex: sectionStart });
    buf = [];
  };
  for (const line of lines) {
    const m = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (m) { flush(); heading = m[1].trim(); sectionStart = idx; }
    else buf.push(line);
    idx += line.length + 1;
  }
  flush();
  if (sections.length === 0) sections.push({ heading: null, text: text.trim(), startIndex: 0 });
  return sections;
}

interface Piece { text: string; startOffset: number } // startOffset: char offset of the piece within the section text

function packWords(text: string, maxTokens: number, overlapTokens: number): Piece[] {
  // Track each word's char offset within `text` so a chunk's page can be derived
  // from its own position, not the section's start (a headingless PDF is one
  // section, so per-section pages would label every chunk with page 1).
  const words: { word: string; offset: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) words.push({ word: m[0], offset: m.index });
  if (words.length === 0) return [];
  const wordText = (a: number, b: number) => words.slice(a, b).map((w) => w.word).join(" ");
  if (estimateTokens(text) <= maxTokens) return [{ text: text.trim(), startOffset: words[0].offset }];
  const out: Piece[] = [];
  let i = 0;
  while (i < words.length) {
    // Grow the slice word-by-word until adding another word would exceed maxTokens
    // (based on actual char-derived token estimate, not an approximate words/token ratio).
    let j = i + 1;
    while (j < words.length && estimateTokens(wordText(i, j + 1)) <= maxTokens) {
      j++;
    }
    out.push({ text: wordText(i, j), startOffset: words[i].offset });
    if (j >= words.length) break;
    // Back up from j so the next chunk overlaps by ~overlapTokens worth of trailing words.
    let k = j;
    while (k > i && estimateTokens(wordText(k - 1, j)) <= overlapTokens) {
      k--;
    }
    i = k < j ? k : j; // guarantee forward progress
  }
  return out;
}

export function chunkText(text: string, opts: ChunkOptions): Chunk[] {
  const maxTokens = opts.maxTokens ?? 600;
  const overlapTokens = opts.overlapTokens ?? 80;
  const out: Chunk[] = [];
  let ordinal = 0;
  for (const section of splitSections(text)) {
    const headingLabel = section.heading ? `${opts.sourceLabel}: ${section.heading}` : null;
    for (const piece of packWords(section.text, maxTokens, overlapTokens)) {
      // Heading path: label from the heading. PDF path (no heading, pageOf set):
      // derive the page from THIS piece's char offset in the whole text, not the
      // section start — otherwise a headingless single-section PDF cites every
      // chunk as p.1.
      let label: string;
      if (headingLabel) {
        label = headingLabel;
      } else if (opts.pageOf) {
        const p = opts.pageOf(section.startIndex + piece.startOffset);
        label = p != null ? `${opts.sourceLabel} p.${p}` : opts.sourceLabel;
      } else {
        label = opts.sourceLabel;
      }
      out.push({ content: piece.text, sourceRef: label, ordinal: ordinal++, tokenCount: estimateTokens(piece.text) });
    }
  }
  return out;
}
