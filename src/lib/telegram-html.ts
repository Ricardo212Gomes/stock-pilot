// Reads a notification written in Telegram's HTML into a small tree the page renders as React elements, never as
// HTML: bold (<b>, <strong>), italics (<i>, <em>) and links (<a href>) are kept, everything else is plain text, and
// links go only to http(s) addresses or StockPilot's own paths. Links to the app's public address (APP_URL) become
// its own paths, so they open in place.

export type MessageNode =
  | { type: "text"; text: string }
  | { type: "bold" | "italic"; children: MessageNode[] }
  | { type: "link"; href: string; external: boolean; children: MessageNode[] };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

// A link target that's safe to render, or null: http(s), or a path in the app (never "//host", "javascript:" or
// "data:"). An address on the app's own host becomes its path.
export function safeHref(raw: string, appUrl?: string | null): { href: string; external: boolean } | null {
  const href = raw.trim();
  const base = appUrl?.replace(/\/$/, "");
  if (base && (href === base || href.startsWith(`${base}/`) || href.startsWith(`${base}?`))) {
    const path = href.slice(base.length) || "/";
    return { href: path.startsWith("/") ? path : `/${path}`, external: false };
  }
  if (/^\/(?!\/)/.test(href)) return { href, external: false };
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? { href: url.toString(), external: true } : null;
  } catch {
    return null;
  }
}

const TAG = /<(\/?)(b|strong|i|em|a)\b([^>]*)>/gi;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

type Open = { node: Extract<MessageNode, { children: MessageNode[] }> | null; tag: string; children: MessageNode[] };

export function parseTelegramHtml(html: string, appUrl?: string | null): MessageNode[] {
  const root: Open = { node: null, tag: "", children: [] };
  const stack: Open[] = [root];
  const pushText = (raw: string) => {
    if (!raw) return;
    // Any other tag stays visible as text, the way it was written.
    const text = decodeEntities(raw);
    const target = stack[stack.length - 1].children;
    const last = target[target.length - 1];
    if (last?.type === "text") last.text += text;
    else target.push({ type: "text", text });
  };

  let index = 0;
  for (const match of html.matchAll(TAG)) {
    pushText(html.slice(index, match.index));
    index = match.index + match[0].length;
    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    const kind = tag === "b" || tag === "strong" ? "bold" : tag === "a" ? "link" : "italic";
    if (closing) {
      // Close the nearest matching tag, and anything left open inside it; a stray closing tag is dropped.
      const at = stack.findLastIndex((open, position) => position > 0 && open.tag === kind);
      if (at > 0) stack.length = at;
      continue;
    }
    let node: Open["node"];
    if (kind === "link") {
      const found = HREF.exec(match[3]);
      const safe = found ? safeHref(decodeEntities(found[1] ?? found[2] ?? ""), appUrl) : null;
      node = safe ? { type: "link", href: safe.href, external: safe.external, children: [] } : null;
    } else {
      node = { type: kind, children: [] };
    }
    // A link that isn't safe keeps its text without the link.
    const holder: Open = { node, tag: kind, children: node ? node.children : stack[stack.length - 1].children };
    if (node) stack[stack.length - 1].children.push(node);
    stack.push(holder);
  }
  pushText(html.slice(index));
  return root.children;
}

// The message as plain text, for previews.
export function plainText(nodes: MessageNode[]): string {
  return nodes.map((node) => (node.type === "text" ? node.text : plainText(node.children))).join("");
}
