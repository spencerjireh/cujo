import type { SensorBlock } from "@/lib/api/report";

/**
 * Whether each sensor was watching, said once per report.
 *
 * This used to be listed under the raw-report disclosure, once per block, so a
 * detonation card with twelve blocks said the same four lines twelve times and
 * a reader who wanted them had to open the fallback view to find out. The
 * sensors are the sandbox's, not the block's: one report is one sandbox, and
 * the first block's health is the report's health. They are reference, not a
 * verdict: the verdict is the coverage sentence at the top of each block.
 */
const SENSOR_LABELS: Record<string, string> = {
  proxy: "proxy",
  decoy: "decoy watcher",
  audit: "python hook",
  fs_diff: "filesystem",
};

export function SensorStatus({ block }: { block: SensorBlock | undefined }) {
  const sensors = block?.sensors;
  if (!sensors) return null;
  return (
    <div className="mt-3">
      <p className="font-mono text-xs text-fg-muted">How this was measured</p>
      <dl className="mt-1 grid grid-cols-[7rem_1fr] gap-x-3 font-mono text-xs">
        {Object.entries(sensors).map(([name, sensor]) => (
          <div key={name} className="col-span-2 grid grid-cols-subgrid py-0.5">
            <dt className={sensor.armed === false ? "text-sev-high" : "text-fg-muted"}>
              {SENSOR_LABELS[name] ?? name}
            </dt>
            <dd className={sensor.armed === false ? "text-sev-high" : "text-fg-muted"}>
              {sensor.armed === false ? "off" : sensor.armed === true ? "watching" : "unknown"}
              {sensor.detail ? ` · ${sensor.detail}` : ""}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
