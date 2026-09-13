import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INDEX_HOSTS,
  cacheableDetonations,
  lookupCachedDetonations,
} from "../../src/review/detonation-cache";
import type { AddedSpecifier } from "../../src/review/specifiers";
import type { CheckState } from "../../src/review/types";
import type { CachedDetonation } from "../../src/store/detonations";

const EXAMPLE = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../../docs/contracts/report.example.json"), "utf8"),
);

/** A known-good `sniff.py detonate` entry, from the example's sensor block. */
const entry = (over: Record<string, unknown> = {}) => {
  const { argv: _argv, exit: _exit, ...sensors } = structuredClone(EXAMPLE.runs[0]);
  return {
    ...sensors,
    dependency: "humanize==4.9.0",
    source: "pypi",
    install_ok: true,
    window_exclusive: true,
    egress: [
      { host: "pypi.org", port: 443, known: true },
      { host: "files.pythonhosted.org", port: 443, known: true },
    ],
    // The example's probe reads the decoy on purpose; a cacheable entry did not.
    secret_probe: { decoy_read: false, decoy_in_egress: false },
    derived: {
      egress_to_unknown_host: false,
      wrote_outside_workspace: false,
      wrote_sensitive: false,
      spawned_subprocess: false,
    },
    ...over,
  };
};

const check = (runs: unknown[], over: Partial<CheckState> = {}): CheckState => ({
  threadId: "th-det",
  title: "detonation",
  isCheck: true,
  status: "done",
  report: {
    schema_version: 1,
    check: "detonation",
    runs,
    derived: structuredClone(EXAMPLE.derived),
    sensors: structuredClone(EXAMPLE.sensors),
    truncated: structuredClone(EXAMPLE.truncated),
  },
  error: null,
  startedAt: null,
  endedAt: null,
  attempts: 1,
  ...over,
});

describe("cacheableDetonations (decision 145)", () => {
  it("selects an installed, exclusive, exact, untripped entry that reached only index hosts", () => {
    const out = cacheableDetonations({ checks: [check([entry()])] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: "pypi", specifier: "humanize==4.9.0" });
    expect((out[0]?.report as { dependency: string }).dependency).toBe("humanize==4.9.0");
  });

  it("normalises the specifier into the key", () => {
    const out = cacheableDetonations({
      checks: [check([entry({ dependency: "Humanize == 4.9.0" })])],
    });
    expect(out[0]?.specifier).toBe("humanize==4.9.0");
  });

  it("skips an entry that is not exact, failed, was not exclusive, or tripped a flag", () => {
    const cases = [
      entry({ dependency: "humanize>=4" }),
      entry({ dependency: "git+https://github.com/o/p@main" }),
      entry({ install_ok: false }),
      entry({ window_exclusive: false }),
      entry({ derived: { ...entry().derived, wrote_sensitive: true } }),
      entry({ secret_probe: { decoy_read: true, decoy_in_egress: null } }),
    ];
    expect(cacheableDetonations({ checks: [check(cases)] })).toEqual([]);
  });

  it("skips an entry that reached a host outside the index list, whatever `known` said", () => {
    const reached = entry({ egress: [{ host: "internal.example.com", port: 443, known: true }] });
    expect(cacheableDetonations({ checks: [check([reached])] })).toEqual([]);
  });

  it("never re-caches an entry that was itself a cached copy", () => {
    const copy = entry({ cached_from_run: "run-1", cached_at: "2026-09-10T00:00:00Z" });
    expect(cacheableDetonations({ checks: [check([copy])] })).toEqual([]);
  });

  it("skips a report the schema rejects, a check that is not detonation, and one still running", () => {
    expect(
      cacheableDetonations({ checks: [check([{ dependency: "x==1", source: "pypi" }])] }),
    ).toEqual([]);
    expect(cacheableDetonations({ checks: [check([entry()], { title: "tests" })] })).toEqual([]);
    expect(cacheableDetonations({ checks: [check([entry()], { status: "running" })] })).toEqual([]);
  });

  it("holds the trusted-side index hosts to the sensors' own list", () => {
    const policy = readFileSync(
      join(import.meta.dirname, "../../../../sandbox/cujo_sniff/policy.py"),
      "utf8",
    );
    const block = policy.slice(
      policy.indexOf("KNOWN_INDEX_HOSTS"),
      policy.indexOf(")", policy.indexOf("KNOWN_INDEX_HOSTS")),
    );
    const hosts = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(hosts.length).toBeGreaterThan(5);
    expect([...INDEX_HOSTS].sort()).toEqual([...hosts].sort());
  });
});

describe("lookupCachedDetonations", () => {
  const added: AddedSpecifier[] = [
    { source: "pypi", specifier: "humanize==4.9.0", exact: true, path: "requirements.txt" },
    { source: "pypi", specifier: "rich>=13", exact: false, path: "requirements.txt" },
    { source: "npm", specifier: "left-pad@1.3.0", exact: true, path: "package.json" },
  ];
  const stored = (over: Partial<CachedDetonation> = {}): CachedDetonation => ({
    source: "pypi",
    specifier: "humanize==4.9.0",
    report: entry(),
    runId: "run-1",
    runIsPublic: true,
    createdAt: "2026-09-10T00:00:00.000Z",
    ...over,
  });

  it("lists only the exact specifiers the store still holds, field by field", () => {
    const asked: string[] = [];
    const store = {
      get: (source: string, specifier: string) => {
        asked.push(`${source} ${specifier}`);
        return specifier === "humanize==4.9.0" ? stored() : null;
      },
    };
    const out = lookupCachedDetonations(store, added, new Date());
    expect(asked).toEqual(["pypi humanize==4.9.0", "npm left-pad@1.3.0"]);
    expect(out).toEqual([
      {
        dependency: "humanize==4.9.0",
        source: "pypi",
        run_id: "run-1",
        cached_at: "2026-09-10T00:00:00.000Z",
        report: entry(),
      },
    ]);
  });

  it("withholds the source run's id when that run is private", () => {
    const store = { get: () => stored({ runIsPublic: false }) };
    const out = lookupCachedDetonations(store, [added[0] as AddedSpecifier], new Date());
    expect(out[0]?.run_id).toBeNull();
    expect(JSON.stringify(out)).not.toContain("run-1");
  });
});
