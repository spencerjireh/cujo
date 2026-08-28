/**
 * The field allowlist, guarded the way the public serializer is (decision 34,
 * now 37).
 *
 * `FIELD_CLASS` is `Record<FieldName, FieldClass>`, so adding a name to
 * `FIELD_NAMES` stops `fields.ts` compiling until it is classified — that is
 * the fail-closed step, and it happens at `pnpm typecheck` rather than here.
 * What this file adds is the half a type cannot express: that the two lists
 * agree, that no name is declared twice, and that the vocabulary keeps one
 * spelling per concept.
 */

import { describe, expect, it } from "vitest";
import { CAP, FIELD_CLASS, FIELD_NAMES, RESERVED_NAMES, isFieldName } from "../src/fields";

const sorted = (values: readonly string[]) => [...new Set(values)].sort();

describe("the field allowlist", () => {
  it("classifies every declared field, and none twice", () => {
    expect(sorted(Object.keys(FIELD_CLASS))).toEqual(sorted(FIELD_NAMES));
    expect(FIELD_NAMES).toHaveLength(new Set(FIELD_NAMES).size);
  });

  it("keeps one spelling per concept", () => {
    // Without this a `runId` and a `run_id` both enter the vocabulary, which
    // is how a log schema rots into two half-populated fields.
    for (const name of FIELD_NAMES) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("never declares a name emit writes itself", () => {
    for (const reserved of RESERVED_NAMES) {
      expect(FIELD_NAMES).not.toContain(reserved);
    }
  });

  it("names exactly one person, and says so", () => {
    // `actor` is the Access email the store already persists as `approver` and
    // the public serializer already withholds. A second pii field should cost
    // somebody this assertion.
    expect(FIELD_NAMES.filter((name) => FIELD_CLASS[name] === "pii")).toEqual(["actor"]);
  });

  it("caps every class that can hold a string", () => {
    for (const cls of ["id", "enum", "text", "pii"] as const) {
      expect(CAP[cls]).toBeGreaterThan(0);
    }
  });

  it("recognises a declared name and refuses an undeclared one", () => {
    expect(isFieldName("run_id")).toBe(true);
    expect(isFieldName("runId")).toBe(false);
    expect(isFieldName("password")).toBe(false);
    // Same prototype hazard as parseLevel: a Set, not an object literal.
    expect(isFieldName("constructor")).toBe(false);
  });
});
