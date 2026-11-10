// A small Markdown reader for the chat's answers: paragraphs, bullet and numbered lists (nested), tables,
// headings, code and rules, with bold, italics, code and links inline. It builds data, not HTML, so nothing the
// model writes is ever inserted into the page as markup. Answers are read again as each piece streams in, so
// a half-written table or **bold** shows as plain text until it's complete.

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  // Only paths inside StockPilot ("/stock?symbol=AAPL"); other links keep their text alone.
  | { type: "link"; href: string; children: Inline[] }
  | { type: "break" };

export type Alignment = "left" | "center" | "right" | null;

export type ListItem = { content: Inline[]; children: Block[] };

export type Block =
  | { type: "paragraph"; content: Inline[] }
  | { type: "heading"; content: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  // `numeric` marks columns of figures, which line up on the right; `wrap` columns of longer text, which may wrap.
  // Other columns stay on one line, and a wide table scrolls.
  | { type: "table"; header: Inline[][]; align: Alignment[]; numeric: boolean[]; wrap: boolean[]; rows: Inline[][][] }
  | { type: "code"; text: string }
  | { type: "rule" };

// Backslash escapes become private-use characters while parsing, so "\*" is never read as emphasis.
const ESCAPABLE = "\\`*_{}[]()#+-.!|~>";
const PRIVATE_BASE = 0xe000;

function protect(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, (_, char: string) => String.fromCharCode(PRIVATE_BASE + ESCAPABLE.indexOf(char)));
}

function restore(text: string, keepBackslash = false): string {
  return text.replace(/[-]/g, (char) => `${keepBackslash ? "\\" : ""}${ESCAPABLE[char.charCodeAt(0) - PRIVATE_BASE]}`);
}

// --- Inline -------------------------------------------------------------------------------------------

const INLINE = new RegExp(
  [
    "(`+)([^`]|[^`][\\s\\S]*?[^`])\\1(?!`)", // 1, 2: code
    "\\*\\*(?=\\S)([\\s\\S]*?\\S)\\*\\*", // 3: bold
    "__(?=\\S)([\\s\\S]*?\\S)__(?!\\w)", // 4: bold
    "(?<![\\w*])\\*(?=[^\\s*])([\\s\\S]*?[^\\s*])\\*(?![\\w*])", // 5: italics
    "(?<![\\w_])_(?=[^\\s_])([\\s\\S]*?[^\\s_])_(?![\\w_])", // 6: italics
    "\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)", // 7, 8: link
    "\\n", // a line break
  ].join("|"),
  "g",
);

function isInternalPath(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.includes("\\");
}

function parseInlineProtected(text: string): Inline[] {
  const nodes: Inline[] = [];
  // Neighbouring text becomes one node, including the text of a link that isn't kept as one.
  const append = (node: Inline) => {
    const last = nodes.at(-1);
    if (node.type === "text" && last?.type === "text") last.text += node.text;
    else nodes.push(node.type === "text" ? { ...node } : node);
  };
  const pushText = (value: string) => {
    if (value) append({ type: "text", text: restore(value) });
  };
  let cursor = 0;
  for (const match of text.matchAll(INLINE)) {
    pushText(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    if (match[2] !== undefined) {
      // Code spans keep their spaces inside, trimmed by one at each end as Markdown does.
      const code = match[2].length > 2 && match[2].startsWith(" ") && match[2].endsWith(" ") ? match[2].slice(1, -1) : match[2];
      nodes.push({ type: "code", text: restore(code, true) });
    } else if (match[3] !== undefined || match[4] !== undefined) {
      nodes.push({ type: "strong", children: parseInlineProtected(match[3] ?? match[4]) });
    } else if (match[5] !== undefined || match[6] !== undefined) {
      nodes.push({ type: "em", children: parseInlineProtected(match[5] ?? match[6]) });
    } else if (match[7] !== undefined) {
      const href = restore(match[8]);
      const children = parseInlineProtected(match[7]);
      if (isInternalPath(href)) nodes.push({ type: "link", href, children });
      else children.forEach(append);
    } else {
      nodes.push({ type: "break" });
    }
  }
  pushText(text.slice(cursor));
  return nodes;
}

export function parseInline(text: string): Inline[] {
  return parseInlineProtected(protect(text));
}

// --- Blocks -------------------------------------------------------------------------------------------

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const FENCE = /^\s{0,3}(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|")) text = text.slice(0, -1);
  return text.split("|").map((cell) => cell.trim());
}

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index];
  const separator = lines[index + 1];
  if (!header?.includes("|") || separator === undefined || !separator.includes("-") || !SEPARATOR.test(separator)) return false;
  // A separator without pipes ("---") would be a rule under a paragraph instead.
  if (!separator.includes("|") && splitRow(header).length < 2) return false;
  return splitRow(header).length === splitRow(separator).length;
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || LIST_ITEM.test(line) || isTableStart(lines, index);
}

function alignmentOf(cell: string): Alignment {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

// Figures like "$466.8B", "+6.4%", "(2.1%)", "28.4x" or "1,204", and blanks.
const NUMERIC = /^[([]?[-+−–]?\s?[$€£]?\s?[-+−]?\d[\d,]*(?:\.\d+)?\s?(?:%|[KMBT]|bn|x|×|pp|pts?)?[)\]]?$/i;
const BLANK = /^(?:—|–|-|n\/a|na|null)?$/i;
// Cells longer than this (in Markdown characters) may wrap; shorter columns stay on one line.
const WRAP_LENGTH = 28;

function looksNumeric(cell: string): boolean {
  const text = restore(cell).replace(/[*_`]/g, "").trim();
  return NUMERIC.test(text) || BLANK.test(text);
}

function parseTable(lines: string[], start: number): { block: Block; next: number } {
  const header = splitRow(lines[start]);
  const align = splitRow(lines[start + 1]).map((cell) => alignmentOf(cell.replace(/\s/g, "")));
  const rows: string[][] = [];
  let index = start + 2;
  while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
    const cells = splitRow(lines[index]);
    rows.push(header.map((_, column) => cells[column] ?? ""));
    index++;
  }
  const numeric = header.map((_, column) => {
    const cells = rows.map((row) => row[column]);
    return cells.some((cell) => !BLANK.test(restore(cell).trim())) && cells.every(looksNumeric);
  });
  const wrap = header.map((title, column) => !numeric[column] && [title, ...rows.map((row) => row[column])].some((cell) => cell.length > WRAP_LENGTH));
  return {
    block: {
      type: "table",
      header: header.map(parseInlineProtected),
      align,
      numeric,
      wrap,
      rows: rows.map((row) => row.map(parseInlineProtected)),
    },
    next: index,
  };
}

function dedent(lines: string[]): string[] {
  const indent = Math.min(...lines.filter((line) => line.trim()).map(indentOf));
  return lines.map((line) => line.slice(Math.min(indent, indentOf(line))));
}

function parseList(lines: string[], start: number): { block: Block; next: number } {
  const first = lines[start].match(LIST_ITEM)!;
  const base = indentOf(lines[start]);
  const ordered = /\d/.test(first[2]);
  const items: { lines: string[]; children: string[] }[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      // A blank line ends the list, unless what follows is another item or the current item's indented content.
      const after = lines[index + 1];
      const item = after?.match(LIST_ITEM);
      const continues = after !== undefined && after.trim() !== "" && (
        (item && indentOf(after) <= base + 1 && /\d/.test(item[2]) === ordered) || indentOf(after) > base + 1
      );
      if (!continues) break;
      items.at(-1)?.children.push("");
      index++;
      continue;
    }
    const match = line.match(LIST_ITEM);
    const indent = indentOf(line);
    if (match && indent <= base + 1) {
      // Another item at this level, unless a different kind of list starts.
      if (/\d/.test(match[2]) !== ordered) break;
      items.push({ lines: [match[3]], children: [] });
    } else if (indent > base + 1) {
      // A nested list or paragraph under the item.
      items.at(-1)!.children.push(line);
    } else if (!startsBlock(lines, index)) {
      // A lazy continuation of the item's text.
      const item = items.at(-1)!;
      if (item.children.some((child) => child.trim())) item.children.push(line);
      else item.lines.push(line.trim());
    } else {
      break;
    }
    index++;
  }

  return {
    block: {
      type: "list",
      ordered,
      start: ordered ? Number.parseInt(first[2], 10) : 1,
      items: items.map((item) => {
        const children = item.children.some((line) => line.trim()) ? parseBlocks(dedent(item.children)) : [];
        return { content: parseInlineProtected(item.lines.join("\n")), children };
      }),
    },
    next: index,
  };
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) code.push(lines[index++]);
      index++;
      blocks.push({ type: "code", text: restore(code.join("\n"), true) });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: "heading", content: parseInlineProtected(heading[1]) });
      index++;
      continue;
    }

    if (isTableStart(lines, index)) {
      const { block, next } = parseTable(lines, index);
      blocks.push(block);
      index = next;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      index++;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const { block, next } = parseList(lines, index);
      blocks.push(block);
      index = next;
      continue;
    }

    const paragraph = [line.trim()];
    index++;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) paragraph.push(lines[index++].trim());
    blocks.push({ type: "paragraph", content: parseInlineProtected(paragraph.join("\n")) });
  }
  return blocks;
}

export function parseMarkdown(source: string): Block[] {
  return parseBlocks(protect(source.replace(/\r\n?/g, "\n")).split("\n"));
}

// The answer as plain text, for copying: Markdown's markers removed, tables as tab-separated rows.
export function plainText(blocks: Block[]): string {
  const inline = (nodes: Inline[]): string => nodes.map((node) => {
    switch (node.type) {
      case "text":
      case "code":
        return node.text;
      case "break":
        return "\n";
      default:
        return inline(node.children);
    }
  }).join("");
  const block = (item: Block, depth: number): string => {
    switch (item.type) {
      case "paragraph":
      case "heading":
        return inline(item.content);
      case "code":
        return item.text;
      case "rule":
        return "—";
      case "table":
        return [item.header, ...item.rows].map((row) => row.map(inline).join("\t")).join("\n");
      case "list":
        return item.items.map((entry, position) => {
          const marker = item.ordered ? `${item.start + position}.` : "•";
          const children = entry.children.map((child) => block(child, depth + 1)).join("\n");
          return `${"  ".repeat(depth)}${marker} ${inline(entry.content)}${children ? `\n${children}` : ""}`;
        }).join("\n");
    }
  };
  return blocks.map((item) => block(item, 0)).join("\n\n");
}
