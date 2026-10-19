import type { ReactNode } from "react";

/**
 * The frame every owner page shares (decision 175): the working-page face,
 * one column, a title, an optional line under it, and actions to the right.
 * Owner pages are for getting something done, so the title says what the
 * page is for and the line under it says what can be done here.
 */
export function OwnerPage({
  title,
  lead,
  actions,
  children,
}: {
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 font-ui md:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl tracking-tight">{title}</h1>
          {lead ? <p className="mt-2 max-w-[70ch] text-sm text-fg-muted">{lead}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

/** A titled block within an owner page. */
export function OwnerSection({
  id,
  title,
  lead,
  children,
}: {
  id?: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="scroll-mt-20">
      <h2 id={id ? `${id}-title` : undefined} className="font-display text-lg">
        {title}
      </h2>
      {lead ? <p className="mt-1 max-w-[70ch] text-sm text-fg-muted">{lead}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export const BUTTON =
  "rounded-md border border-line px-3 py-1.5 font-ui text-sm text-fg transition-colors hover:border-fg-muted disabled:cursor-not-allowed disabled:opacity-50";
export const PRIMARY_BUTTON =
  "rounded-md bg-accent-fill px-3 py-1.5 font-ui text-sm font-medium text-accent-fg transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";
