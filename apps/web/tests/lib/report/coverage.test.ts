import { type SensorBlock, parseReport } from "@/lib/api/report";
import { coverageLine, flaggedTables, groupState, sensorDetail } from "@/lib/report/coverage";
import { describe, expect, it } from "vitest";

function block(report: unknown): SensorBlock {
  const parsed = parseReport(report);
  if (parsed.kind !== "sensor" || !parsed.blocks[0]) throw new Error("expected a sensor block");
  return parsed.blocks[0];
}

const ALL_WATCHING = {
  proxy: { armed: true, detail: "port 8899" },
  decoy: { armed: true, detail: "inotify" },
  audit: { armed: true, detail: "9214 rows" },
  fs_diff: { armed: true, detail: "3184 paths" },
};

describe("coverageLine", () => {
  it("says nothing for a report that carries no health block", () => {
    // The shape every report written before the block existed has. Claiming
    // coverage for it would be the page asserting what no sandbox measured.
    expect(coverageLine(block({ egress: [{ host: "pypi.org" }] }))).toBeNull();
  });

  it("says nothing when the health block never says whether anything ran", () => {
    expect(coverageLine(block({ egress: [], sensors: { proxy: { detail: "port 8899" } } }))).toBe(
      null,
    );
  });

  it("states the clean case, which the card used to render as blank", () => {
    expect(coverageLine(block({ egress: [], sensors: ALL_WATCHING }))).toBe(
      "Nothing tripped. All four sensors were watching.",
    );
  });

  it("drops the verdict clause when something did trip", () => {
    // The alarm bars above it already say what tripped; repeating it here would
    // be the same fact twice in four centimetres.
    expect(
      coverageLine(block({ sensors: ALL_WATCHING, derived: { egress_to_unknown_host: true } })),
    ).toBe("All four sensors were watching.");
  });

  it("counts only the sensors that actually reported themselves armed", () => {
    // The audit hook is off on every check that runs no Python, which is
    // ordinary. It is not a gap, so it does not become a named failure — but it
    // is also not four out of four.
    expect(
      coverageLine(
        block({
          egress: [],
          sensors: { ...ALL_WATCHING, audit: { armed: false, detail: "no Python process ran" } },
        }),
      ),
    ).toBe("Nothing tripped. 3 of the four sensors were watching.");
  });

  it("names a watched sensor that was down, and what its silence costs", () => {
    expect(
      coverageLine(
        block({
          egress: [],
          sensors: { ...ALL_WATCHING, proxy: { armed: false, detail: "no longer running" } },
        }),
      ),
    ).toBe("Nothing tripped, but the proxy was not running, so nothing outbound was measured.");
  });

  it("joins two dead sensors and leads with the gap when an alarm also tripped", () => {
    expect(
      coverageLine(
        block({
          sensors: {
            ...ALL_WATCHING,
            proxy: { armed: false, detail: "" },
            decoy: { armed: false, detail: "" },
          },
          derived: { wrote_sensitive: true },
        }),
      ),
    ).toBe(
      "The proxy was not running, so nothing outbound was measured and the decoy was not running, so a read of the decoy secret would not have been seen.",
    );
  });
});

describe("flaggedTables", () => {
  it("points each flag at the table that proves it", () => {
    expect([
      ...flaggedTables(
        block({
          secret_probe: { decoy_read: true },
          derived: {
            egress_to_unknown_host: true,
            wrote_outside_workspace: true,
            spawned_subprocess: true,
          },
        }),
      ),
    ]).toEqual(["egress", "files_read", "fs_changes", "subprocesses"]);
  });

  it("opens nothing for a block that flagged nothing", () => {
    // Which is the point of it: a clean card is four headers and their counts,
    // not four tables of rows nobody asked to see.
    expect(flaggedTables(block({ egress: [{ host: "pypi.org" }] })).size).toBe(0);
  });

  it("counts a spawned subprocess even though it raises no alarm", () => {
    // An install spawns processes, so this accuses nothing on its own — but
    // when it is set, the process list is the list to read.
    const flagged = flaggedTables(block({ derived: { spawned_subprocess: true } }));
    expect([...flagged]).toEqual(["subprocesses"]);
  });
});

describe("groupState", () => {
  it("lets a watched table show its zero and an unwatched one show nothing at all", () => {
    const watched = block({ egress: [], sensors: ALL_WATCHING });
    expect(groupState(watched, "proxy")).toBe("measured");

    const down = block({
      egress: [],
      sensors: { proxy: { armed: false, detail: "no longer running" } },
    });
    expect(groupState(down, "proxy")).toBe("blind");
    expect(sensorDetail(down, "proxy")).toBe("no longer running");

    // No health at all: the table behaves exactly as the page always had it,
    // because neither a zero nor "not measured" is a claim this report supports.
    expect(groupState(block({ egress: [] }), "proxy")).toBe("unknown");
    expect(groupState(watched, "nothing_by_this_name")).toBe("unknown");
    expect(sensorDetail(watched, "nothing_by_this_name")).toBeUndefined();
  });
});
