import { PARTS } from "./Legend";
import { SpecimenDiagram } from "./SpecimenDiagram";

/**
 * The compact key: the diagram and its four lines, and nothing else.
 *
 * Shown in the hero's bottom block while the reader is hovering a specimen,
 * in place of the readings. The full key under the record (decision 83) is
 * where the verdicts and severities are spelled out; a reader with a star
 * under the pointer wants to know what the parts of that star are, and this
 * is the part of the key that answers it. Same `PARTS`, same diagram, so the
 * two keys say one thing.
 *
 * Set inside the chamber, so it takes the viewport's own colours rather than
 * the page's, as the readings it replaces do.
 */
export function SpecimenKey() {
  return (
    <div className="pointer-events-none flex max-w-2xl items-start gap-6">
      <div className="w-40 shrink-0 border border-[var(--chamber-line)] p-2 sm:w-48">
        <SpecimenDiagram />
      </div>
      <dl className="flex max-w-sm flex-col gap-2 font-mono text-xs leading-relaxed">
        {PARTS.map((part) => (
          <div key={part.label} className="flex flex-col gap-0.5">
            <dt className="text-[var(--chamber-fg)]">{part.label}</dt>
            <dd className="text-[var(--chamber-fg-muted)]">{part.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
