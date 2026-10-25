import type { ReactNode } from "react";

type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "del"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

type ListItem = { task: boolean | null; children: Inline[] };

type Block =
  | { type: "heading"; level: number; children: Inline[] }
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "ul"; items: ListItem[] }
  | { type: "ol"; items: Inline[][] }
  | { type: "quote"; lines: Inline[][] }
  | { type: "code"; lang: string; text: string }
  | { type: "hr" };

function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^https?:\/\//i.test(href)) return href;
  if (/^mailto:/i.test(href) && !/[\s<>]/.test(href.slice(7))) return href;
  return null;
}

function parseInline(text: string): Inline[] {
  const out: Inline[] = [];

  const pushText = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last?.type === "text") last.text += value;
    else out.push({ type: "text", text: value });
  };

  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);

    if (rest.startsWith("\\") && rest.length > 1 && /[\\`*_{}[\]()#+\-.!~]/.test(rest[1] ?? "")) {
      pushText(rest[1] ?? "");
      i += 2;
      continue;
    }

    if (rest.startsWith("`")) {
      const end = rest.indexOf("`", 1);
      if (end > 1) {
        out.push({ type: "code", text: rest.slice(1, end) });
        i += end + 1;
        continue;
      }
    }

    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const href = safeHref(link[2] ?? "");
      if (href) {
        out.push({ type: "link", href, children: parseInline(link[1] ?? "") });
        i += link[0].length;
        continue;
      }
    }

    const marker =
      rest.startsWith("**") || rest.startsWith("__")
        ? rest.slice(0, 2)
        : rest.startsWith("~~")
          ? "~~"
          : null;
    if (marker) {
      const end = rest.indexOf(marker, marker.length);
      if (end > marker.length) {
        const children = parseInline(rest.slice(marker.length, end));
        out.push(
          marker === "~~"
            ? { type: "del", children }
            : { type: "strong", children },
        );
        i += end + marker.length;
        continue;
      }
    }

    const emChar = rest[0];
    if ((emChar === "*" || emChar === "_") && rest[1] !== emChar) {
      const end = rest.indexOf(emChar, 1);
      const before = i > 0 ? text[i - 1] : "";
      const after = end > 0 ? rest[end + 1] : "";
      const touchesWord =
        (before && /[\p{L}\p{N}]/u.test(before)) || (after && /[\p{L}\p{N}]/u.test(after ?? ""));
      if (end > 1 && !touchesWord) {
        out.push({ type: "em", children: parseInline(rest.slice(1, end)) });
        i += end + 1;
        continue;
      }
    }

    pushText(rest[0] ?? "");
    i += 1;
  }

  return out;
}

function isFence(line: string): boolean {
  return line.startsWith("```");
}

function isHr(line: string): boolean {
  return /^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim());
}

function headingLevel(line: string): number {
  const match = /^(#{1,6})\s+\S/.exec(line);
  return match ? match[1]!.length : 0;
}

function isQuote(line: string): boolean {
  return /^>\s?/.test(line);
}

function listKind(line: string): "ul" | "ol" | null {
  if (/^[-*+]\s+/.test(line)) return "ul";
  if (/^\d+[.)]\s+/.test(line)) return "ol";
  return null;
}

function parseListItem(line: string): ListItem {
  const task = /^[-*+]\s+\[([ xX])\]\s+/.exec(line);
  if (task) {
    return {
      task: task[1]?.toLowerCase() === "x",
      children: parseInline(line.slice(task[0].length)),
    };
  }
  const body = line.replace(/^(?:[-*+]|\d+[.)])\s+/, "");
  return { task: null, children: parseInline(body) };
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (isFence(line)) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !isFence(lines[i] ?? "")) {
        buf.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: "code", lang, text: buf.join("\n") });
      continue;
    }

    if (isHr(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    const level = headingLevel(line);
    if (level) {
      blocks.push({
        type: "heading",
        level,
        children: parseInline(line.replace(/^#{1,6}\s+/, "")),
      });
      i += 1;
      continue;
    }

    if (isQuote(line)) {
      const quoted: Inline[][] = [];
      while (i < lines.length && isQuote(lines[i] ?? "")) {
        quoted.push(parseInline((lines[i] ?? "").replace(/^>\s?/, "")));
        i += 1;
      }
      blocks.push({ type: "quote", lines: quoted });
      continue;
    }

    const kind = listKind(line);
    if (kind === "ul") {
      const items: ListItem[] = [];
      while (i < lines.length && listKind(lines[i] ?? "") === "ul") {
        items.push(parseListItem(lines[i] ?? ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (kind === "ol") {
      const items: Inline[][] = [];
      while (i < lines.length && listKind(lines[i] ?? "") === "ol") {
        items.push(parseListItem(lines[i] ?? "").children);
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const paragraph: Inline[][] = [];
    while (i < lines.length) {
      const current = lines[i] ?? "";
      if (
        !current.trim() ||
        isFence(current) ||
        isHr(current) ||
        headingLevel(current) ||
        isQuote(current) ||
        listKind(current)
      ) {
        break;
      }
      paragraph.push(parseInline(current));
      i += 1;
    }
    blocks.push({ type: "paragraph", lines: paragraph });
  }

  return blocks;
}

function renderInline(nodes: Inline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case "text":
        return <span key={key}>{node.text}</span>;
      case "code":
        return (
          <code
            key={key}
            className="rounded-sm bg-raised px-1.5 py-0.5 font-mono text-sm text-ink"
          >
            {node.text}
          </code>
        );
      case "strong":
        return (
          <strong key={key} className="font-semibold text-ink">
            {renderInline(node.children, key)}
          </strong>
        );
      case "em":
        return (
          <em key={key} className="italic">
            {renderInline(node.children, key)}
          </em>
        );
      case "del":
        return (
          <del key={key} className="text-muted line-through">
            {renderInline(node.children, key)}
          </del>
        );
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-lamp underline decoration-lamp/40 underline-offset-4 transition-colors duration-150 hover:decoration-lamp"
          >
            {renderInline(node.children, key)}
          </a>
        );
      default:
        return null;
    }
  });
}

function headingClass(level: number): string {
  if (level <= 1) return "font-serif text-3xl font-medium leading-tight text-balance text-ink";
  if (level === 2) return "font-serif text-2xl font-medium leading-tight text-balance text-ink";
  if (level === 3) return "font-serif text-xl font-medium leading-snug text-balance text-ink";
  return "font-serif text-lg font-medium leading-snug text-ink";
}

export function MarkdownView({ source }: { source: string }) {
  const blocks = parseMarkdown(source);

  if (blocks.length === 0) {
    return <p className="font-serif text-lg text-faint">Nothing to preview yet.</p>;
  }

  return (
    <article className="flex flex-col gap-4" aria-label="Rendered note">
      {blocks.map((block, index) => {
        const key = `b-${index}`;
        switch (block.type) {
          case "heading": {
            const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
            return (
              <Tag key={key} className={headingClass(block.level)}>
                {renderInline(block.children, key)}
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={key} className="font-serif text-lg leading-relaxed text-pretty text-ink">
                {block.lines.map((line, lineIndex) => (
                  <span key={`${key}-l-${lineIndex}`}>
                    {lineIndex > 0 ? <br /> : null}
                    {renderInline(line, `${key}-${lineIndex}`)}
                  </span>
                ))}
              </p>
            );
          case "quote":
            return (
              <blockquote
                key={key}
                className="border-l-2 border-lamp pl-4 font-serif text-lg italic leading-relaxed text-muted"
              >
                {block.lines.map((line, lineIndex) => (
                  <span key={`${key}-q-${lineIndex}`}>
                    {lineIndex > 0 ? <br /> : null}
                    {renderInline(line, `${key}-q-${lineIndex}`)}
                  </span>
                ))}
              </blockquote>
            );
          case "ul":
            return (
              <ul key={key} className="flex flex-col gap-1.5 pl-1">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-i-${itemIndex}`} className="flex items-start gap-2.5">
                    {item.task === null ? (
                      <span
                        className="mt-2.5 size-1.5 shrink-0 rounded-full bg-lamp"
                        aria-hidden
                      />
                    ) : (
                      <span
                        className={
                          item.task
                            ? "mt-1 flex size-4 shrink-0 items-center justify-center rounded-sm bg-lamp text-lamp-ink"
                            : "mt-1 size-4 shrink-0 rounded-sm border border-faint"
                        }
                        aria-hidden
                      >
                        {item.task ? (
                          <svg viewBox="0 0 16 16" className="size-3" fill="none">
                            <path
                              d="M3.5 8.2 6.4 11l6.1-6.2"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : null}
                      </span>
                    )}
                    <span className="min-w-0 font-serif text-lg leading-relaxed text-ink">
                      {renderInline(item.children, `${key}-i-${itemIndex}`)}
                    </span>
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="flex list-decimal flex-col gap-1.5 pl-6 font-serif text-lg marker:text-faint">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-o-${itemIndex}`} className="leading-relaxed text-ink">
                    {renderInline(item, `${key}-o-${itemIndex}`)}
                  </li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-lg border border-line bg-raised px-4 py-3 font-mono text-sm leading-relaxed text-ink"
              >
                {block.lang ? (
                  <span className="mb-2 block font-sans text-xs tracking-wide text-faint">
                    {block.lang}
                  </span>
                ) : null}
                <code>{block.text}</code>
              </pre>
            );
          case "hr":
            return <hr key={key} className="border-0 border-t border-line" />;
          default:
            return null;
        }
      })}
    </article>
  );
}
