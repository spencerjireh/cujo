import { type SensorBlock, alarms, unarmed } from "@/lib/api/report";

/**
 * What a block's evidence is worth, said once, at the top of it.
 *
 * The card used to answer this with four grey dots and their captions —
 * `proxy — port 8899` — which read as decoration and left the reader to infer
 * the one thing that changes the meaning of every table below: whether anybody
 * was looking. An empty egress table means "nothing was dialled" when the proxy
 * was up and "nobody was watching the wire" when it was not, and those two
 * looked identical.
 *
 * So it is a sentence. It is a qualification of this block's own tables and not
 * a second alarm, which is what keeps decision 20 intact: a report renders one
 * card for the roll-up and one per run, and the rule there was that one blind
 * interval must not be *counted* twice. Nothing here is counted.
 */

/**
 * Which table stops meaning anything when a sensor stops watching. Taken from
 * `sandbox/cujo_sniff/report.py:build_sensor_block`, which is the code that
 * fills them: the proxy's rows become egress, the audit hook's become files
 * read and subprocesses, the filesystem diff becomes the change list, and the
 * decoy watcher feeds `secret_probe` alone.
 */
const CONSEQUENCE: Record<string, string> = {
  proxy: "nothing outbound was measured",
  decoy: "a read of the decoy secret would not have been seen",
  audit: "no file read or subprocess was recorded",
  fs_diff: "the filesystem was not compared",
};

/** How many sensors a complete report describes, for the "all four" wording. */
const SENSOR_COUNT = 4;

function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * One sentence about coverage, or null when the report never said.
 *
 * Null rather than a guess: a report written before the health block existed
 * carries no claim either way, and inventing "all four sensors were watching"
 * for it would be this page asserting something no sandbox measured.
 */
export function coverageLine(block: SensorBlock): string | null {
  if (!block.sensors) return null;
  const health = Object.values(block.sensors);
  // A health block whose every entry is silent about `armed` is a report that
  // named its sensors and never said whether they ran. Same answer as no block
  // at all: say nothing rather than count zero of them as off.
  if (health.every((sensor) => sensor.armed === undefined)) return null;

  const quiet = alarms(block).length === 0;
  const down = unarmed(block);

  if (down.length === 0) {
    const armed = health.filter((sensor) => sensor.armed === true).length;
    const watching =
      armed >= SENSOR_COUNT
        ? "All four sensors were watching."
        : `${armed} of the four sensors were watching.`;
    return quiet ? `Nothing tripped. ${watching}` : watching;
  }

  // Named one by one, with what each one's silence costs. `unarmed` is the list
  // to follow rather than `sensors`: the audit hook reports itself off on every
  // check that runs no Python, which is ordinary and is not a gap.
  const cost = list(down.map((name) => `the ${name} was not running, so ${CONSEQUENCE[name]}`));
  if (quiet) return `Nothing tripped, but ${cost}.`;
  return `${cost.charAt(0).toUpperCase()}${cost.slice(1)}.`;
}

/**
 * Whether a table can speak for itself.
 *
 * `measured` — the sensor behind it was watching, so an empty table is a result
 * and renders as `none` rather than vanishing. That is the whole fix for a
 * clean check whose card used to expand to nothing at all.
 *
 * `blind` — the sensor was off. The table is not short, it is absent, and it
 * says so instead of showing zero rows.
 *
 * `unknown` — the report carries no health for that sensor. Behaves as the page
 * always has: rows when there are rows, nothing when there are none, because
 * neither `none` nor `not measured` is a claim this report supports.
 */
export type GroupState = "measured" | "blind" | "unknown";

export function groupState(block: SensorBlock, sensor: string): GroupState {
  const armed = block.sensors?.[sensor]?.armed;
  if (armed === true) return "measured";
  if (armed === false) return "blind";
  return "unknown";
}

/** What the sandbox said about the sensor behind a table, for the blind case. */
export function sensorDetail(block: SensorBlock, sensor: string): string | undefined {
  return block.sensors?.[sensor]?.detail;
}
