import type { ReactNode } from "react";

/**
 * The manual's typography, as a handful of named pieces rather than a global
 * stylesheet.
 *
 * `.cujo-prose` in globals.css is not the thing to reuse here. That class
 * exists because a review body arrives as sanitized agent markdown — bare tags
 * with no classes to target — and so it has to style `h2` and `table` by
 * element. These pages are authored TSX and can carry their own classes, which
 * keeps the two independent: restyling the manual must not restyle what the
 * agent wrote on a pull request.
 *
 * Everything below is the house register already set in globals.css and
 * brand/brand.md: mono for the body because the UI is a log of what ran, the
 * display face on headings only, and a measure short enough to read.
 */

/** The page's own title block. One `h1` per page, and its summary under it. */
export function DocTitle({ title, summary }: { title: string; summary: string }) {
  return (
    <header className="mb-10">
      <h1 className="text-3xl leading-tight tracking-[-0.02em] sm:text-4xl">{title}</h1>
      <p className="mt-4 max-w-[60ch] font-mono text-sm leading-relaxed text-fg-muted">{summary}</p>
    </header>
  );
}

/**
 * A titled block of the page.
 *
 * The heading carries an `id` so a reader can link to the paragraph they mean
 * rather than to the page it is on — the one navigational thing a long
 * reference page owes. No visible anchor glyph: the heading itself is the
 * target, and a hover-only character is a target nobody on a touch screen can
 * reach anyway.
 */
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-12 first:mt-0 scroll-mt-8">
      <h2 id={id} className="text-lg tracking-[-0.01em]">
        <a href={`#${id}`} className="no-underline text-fg hover:text-accent">
          {title}
        </a>
      </h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** A paragraph. Measured, because a full-width line of mono is unreadable. */
export function P({ children }: { children: ReactNode }) {
  return <p className="max-w-[68ch] font-mono text-sm leading-relaxed text-fg-muted">{children}</p>;
}

/** Bone rather than muted, for the sentence a section is actually about. */
export function Lead({ children }: { children: ReactNode }) {
  return <p className="max-w-[68ch] font-mono text-sm leading-relaxed text-fg">{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="flex max-w-[68ch] list-disc flex-col gap-2 pl-5 font-mono text-sm leading-relaxed text-fg-muted marker:text-line">
      {children}
    </ul>
  );
}

export function LI({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}

/** Inline evidence: a command, a key, a status, a path. */
export function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-sm bg-bg-raised px-1.5 py-0.5 font-mono text-[0.9em] text-fg">
      {children}
    </code>
  );
}

/**
 * A block of literal text — a command, a config file, a payload.
 *
 * Scrolls inside itself. A wide line here must never make the page scroll
 * sideways, which on a phone would take the sidebar and the body with it.
 */
export function Pre({ children }: { children: ReactNode }) {
  return (
    <pre className="max-w-full overflow-x-auto rounded-md border border-line bg-bg-raised p-4 font-mono text-xs leading-relaxed text-fg">
      <code>{children}</code>
    </pre>
  );
}

/**
 * The numbered sequence, borrowed from the board's own empty state.
 *
 * Numbered markers are a device this site otherwise avoids, and they earn their
 * place in exactly the case `HeroReadout` already uses them for: steps that
 * happen in this order and have to be done in this order. The number carries
 * information rather than decorating a list.
 */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="flex max-w-[68ch] flex-col gap-4">{children}</ol>;
}

export function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="shrink-0 pt-0.5 font-mono text-xs tabular-nums text-accent">
        {String(n).padStart(2, "0")}
      </span>
      <div className="flex flex-col gap-2">
        <span className="font-mono text-sm leading-relaxed text-fg">{title}</span>
        {children}
      </div>
    </li>
  );
}

/**
 * A two- or three-column reference table.
 *
 * Given its own horizontal scroll for the same reason `Pre` has one. Header
 * cells take the house label style — mono, uppercase, tracked — which is how
 * every other column heading on this site is set.
 */
export function Table({ head, children }: { head: readonly string[]; children: ReactNode }) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full border-collapse text-left font-mono text-xs">
        <thead>
          <tr>
            {head.map((cell) => (
              <th
                key={cell}
                className="border-line border-b py-2 pr-6 font-normal uppercase tracking-[0.16em] text-fg-muted last:pr-0"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <tr className="align-baseline">{children}</tr>;
}

export function Cell({ children, head = false }: { children: ReactNode; head?: boolean }) {
  return (
    <td
      className={`border-line border-b py-2.5 pr-6 leading-relaxed last:pr-0 ${
        head ? "text-fg" : "text-fg-muted"
      }`}
    >
      {children}
    </td>
  );
}

/**
 * An aside the reader must not skip.
 *
 * A left rule and nothing else. No icon, no coloured panel, no word like
 * "Warning" — brand/brand.md asks for restraint with the accent, and a page
 * that shouts four times has not said anything the fifth time.
 */
export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[68ch] border-accent border-l-2 pl-4 font-mono text-sm leading-relaxed text-fg-muted">
      {children}
    </div>
  );
}
