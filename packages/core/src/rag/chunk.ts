export interface Chunk {
  /** The document this came from, as a path relative to the knowledge base root. */
  source: string;
  /** The heading it sits under, so an answer can say where it came from. */
  heading: string | null;
  text: string;
}

export interface ChunkOptions {
  /** Rough target, measured in characters rather than tokens — see the note below. */
  maxChars: number;
  overlapChars: number;
}

/**
 * Splits markdown on its own structure before falling back to size. Hand-written because the
 * heading a passage sits under is its citation, and generic splitters discard it.
 */
export function chunkMarkdown(source: string, markdown: string, options: ChunkOptions): Chunk[] {
  const sections = splitOnHeadings(markdown);

  return sections.flatMap((section) => {
    const rows = tableRows(section.text);
    const prose = splitLongText(withoutTables(section.text), options)
      .filter((text) => text.trim().length > 0)
      .map((text) => ({ source, heading: section.heading, text }));

    return [
      ...prose,
      // Each row is its own passage, headed, so it is a sharp vector rather than part of an average.
      ...rows.map((row) => ({
        source,
        heading: section.heading,
        text: section.heading ? `${section.heading} — ${row}` : row,
      })),
    ];
  });
}

/**
 * Each table row becomes its own headed passage: `Fees — Routine check-up: £55`.
 * A whole table embeds as one blurry vector. See architecture.md#table-chunking.
 */
function tableRows(text: string): string[] {
  const lines = text.split("\n");
  const rows: string[] = [];
  let header: string[] = [];
  let inTable = false;

  const cells = (line: string): string[] =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

  for (const [index, line] of lines.entries()) {
    if (!isTableLine(line)) {
      inTable = false;
      header = [];
      continue;
    }
    const values = cells(line);
    if (values.every((cell) => /^:?-{2,}:?$/.test(cell))) {
      inTable = true;
      header = cells(lines[index - 1] ?? "");
      continue;
    }
    if (!inTable || values.length < 2) continue;

    const [subject, ...rest] = values;
    const described = rest
      .map((value, position) => {
        const label = header[position + 1];
        return label && rest.length > 1 ? `${label} ${value}` : value;
      })
      .join(", ");
    if (subject && described) rows.push(`${subject}: ${described}`);
  }
  return rows;
}

const isTableLine = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line);

/** The prose around a table, with the table itself removed — it is chunked separately. */
const withoutTables = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !isTableLine(line))
    .join("\n");

interface Section {
  heading: string | null;
  text: string;
}

/**
 * Groups lines under the nearest heading.
 *
 * Sub-headings carry their parent — "Fees > Paying" rather than "Paying" — because a chunk
 * labelled only "Paying" is ambiguous across a dozen documents.
 */
function splitOnHeadings(markdown: string): Section[] {
  const sections: Section[] = [];
  const trail: string[] = [];
  let current: string[] = [];
  let heading: string | null = null;

  const flush = () => {
    const text = current.join("\n").trim();
    if (text.length > 0) sections.push({ heading, text });
    current = [];
  };

  for (const line of markdown.split("\n")) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!match?.[1] || !match[2]) {
      current.push(line);
      continue;
    }

    flush();
    const depth = match[1].length;
    trail.length = Math.max(0, depth - 1);
    trail[depth - 1] = match[2].trim();
    heading = trail.filter(Boolean).join(" > ");
  }

  flush();
  return sections;
}

/**
 * Breaks an oversized section on paragraph boundaries.
 *
 * Overlap repeats the tail of the previous chunk so a sentence split across the boundary is still
 * retrievable from either side — without it, the one passage that answers a question can be the
 * one passage that matches nothing.
 */
function splitLongText(text: string, { maxChars, overlapChars }: ChunkOptions): string[] {
  if (text.length <= maxChars) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current.length > 0 && current.length + paragraph.length + 2 > maxChars) {
      chunks.push(current.trim());
      current = current.slice(-overlapChars);
    }
    current += (current.length > 0 ? "\n\n" : "") + paragraph;
  }

  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks;
}
