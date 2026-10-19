/**
 * An on/off control that looks like one (decision 175). It replaced a pill
 * reading "reviewing" or "off", which read as a status badge and not as
 * something to press. The label is the thing switched, so a screen reader
 * hears "Reviews, switch, on".
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  showLabel = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Draw the label beside the track; otherwise it is for assistive technology only. */
  showLabel?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={showLabel ? undefined : label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-2 rounded-full font-ui text-sm text-fg disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
          checked ? "border-sev-live/50 bg-sev-live-bg" : "border-line bg-bg-raised"
        }`}
      >
        <span
          className={`absolute h-3.5 w-3.5 rounded-full transition-transform ${
            checked ? "translate-x-[1.1rem] bg-sev-live" : "translate-x-0.5 bg-fg-muted"
          }`}
        />
      </span>
      {showLabel ? <span>{label}</span> : null}
    </button>
  );
}
