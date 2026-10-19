import { splitCommands } from "@/lib/run/next-step";

/** A sentence with each `/cujo` command set as code, so it reads as something to type. */
export function WithCommands({ text }: { text: string }) {
  // Keyed by where each part starts in the sentence, which is stable and unique.
  let offset = 0;
  return (
    <>
      {splitCommands(text).map((part, index) => {
        const at = offset;
        offset += part.length;
        return index % 2 === 1 ? (
          <code
            key={at}
            className="rounded-sm bg-bg-raised px-1 py-0.5 font-mono text-[0.9em] text-fg"
          >
            {part}
          </code>
        ) : (
          <span key={at}>{part}</span>
        );
      })}
    </>
  );
}
