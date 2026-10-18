import { type ReactElement, type ReactNode, cloneElement, useId } from "react";

/** A text field's input: values are set in the evidence face, since they are values. */
export const INPUT =
  "mt-1.5 block w-full max-w-[28rem] rounded-md border border-line bg-bg px-2.5 py-1.5 font-mono text-sm text-fg outline-none focus:border-accent";

/**
 * A labelled control, with its hint under the label rather than beside it, so
 * a long hint wraps instead of pushing the input off the column. The label
 * points at the child by id, and the hint describes it.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
      {cloneElement(children, { id, "aria-describedby": hint ? hintId : undefined })}
    </div>
  );
}

/** A checkbox with its sentence as the label. */
export function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex max-w-[36rem] items-start gap-2.5 text-sm text-fg">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 accent-[var(--accent-fill)]"
      />
      <span>{children}</span>
    </label>
  );
}

/**
 * The settings most deploys never touch, folded away. A `<details>` because it
 * needs no state and works before the page is interactive.
 */
export function Advanced({ children }: { children: ReactNode }) {
  return (
    <details className="group mt-6 rounded-md border border-line">
      <summary className="cursor-pointer list-none px-4 py-2.5 text-sm text-fg-muted marker:content-[''] hover:text-fg">
        <span className="inline-block w-4 transition-transform group-open:rotate-90">›</span>
        Advanced
      </summary>
      <div className="grid gap-5 border-t border-line p-4 md:grid-cols-2">{children}</div>
    </details>
  );
}
