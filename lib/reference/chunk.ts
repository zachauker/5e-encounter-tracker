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

function packWords(text: string, maxTokens: number, overlapTokens: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (estimateTokens(text) <= maxTokens) return [text.trim()];
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    // Grow the slice word-by-word until adding another word would exceed maxTokens
    // (based on actual char-derived token estimate, not an approximate words/token ratio).
    let j = i + 1;
    while (j < words.length && estimateTokens(words.slice(i, j + 1).join(" ")) <= maxTokens) {
      j++;
    }
    out.push(words.slice(i, j).join(" "));
    if (j >= words.length) break;
    // Back up from j so the next chunk overlaps by ~overlapTokens worth of trailing words.
    let k = j;
    while (k > i && estimateTokens(words.slice(k - 1, j).join(" ")) <= overlapTokens) {
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
    const label = section.heading
      ? `${opts.sourceLabel}: ${section.heading}`
      : opts.pageOf
        ? (() => { const p = opts.pageOf!(section.startIndex); return p != null ? `${opts.sourceLabel} p.${p}` : opts.sourceLabel; })()
        : opts.sourceLabel;
    for (const piece of packWords(section.text, maxTokens, overlapTokens)) {
      out.push({ content: piece, sourceRef: label, ordinal: ordinal++, tokenCount: estimateTokens(piece) });
    }
  }
  return out;
}
