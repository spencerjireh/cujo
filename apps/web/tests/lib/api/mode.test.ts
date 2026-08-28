/**
 * The polarity table (decision 34).
 *
 * One container answers both hostnames, so this function is the whole of how a
 * request is told apart — and the direction it fails in is the point. Public
 * only on an exact match; every other input is operator, which asks the gated
 * API, gets 401 without an assertion, and shows "not signed in". The inverse
 * default would serve the public view to anything it did not recognise, which
 * is how a config typo becomes a disclosure.
 *
 * Kept pure precisely so it is testable here: this app's suite is data-layer
 * only, with no jsdom and no `next/headers`.
 */

import { describe, expect, it } from "vitest";
import { apiPrefix, modeForHost, normalizeHost } from "../../../src/lib/api/mode";

const PUBLIC = "cujo.spencerjireh.com";

describe("modeForHost", () => {
  it.each([
    ["the exact public host", PUBLIC, "public"],
    ["the public host with a port", "cujo.spencerjireh.com:3000", "public"],
    ["the public host in a different case", "CUJO.Spencerjireh.COM", "public"],
  ])("is public for %s", (_name, host, expected) => {
    expect(modeForHost(host, PUBLIC)).toBe(expected);
  });

  it.each([
    ["the admin host", "cujo-admin.spencerjireh.com"],
    ["the harness host", "cujo-harness.spencerjireh.com"],
    ["a host nobody configured", "whatever.example.com"],
    ["a near miss", "cujo.spencerjireh.com.evil.example"],
    ["a bare subdomain of the public name", "x.cujo.spencerjireh.com"],
    ["an empty host", ""],
    ["a missing host", undefined],
    ["a null host", null],
  ])("falls back to operator for %s", (_name, host) => {
    expect(modeForHost(host, PUBLIC)).toBe("operator");
  });

  /**
   * The unconfigured case matters most: a fresh environment, or a variable
   * dropped from compose, must not turn every hostname public.
   */
  it.each([
    ["", "unset"],
    ["   ", "blank"],
  ])("is operator for every host when CUJO_PUBLIC_HOST is %s", (configured) => {
    for (const host of [PUBLIC, "cujo-admin.spencerjireh.com", "", undefined]) {
      expect(modeForHost(host, configured)).toBe("operator");
    }
  });

  it("matches the configured name case-insensitively too", () => {
    expect(modeForHost(PUBLIC, "CUJO.SPENCERJIREH.COM")).toBe("public");
    expect(modeForHost("cujo.localhost", "cujo.localhost:3000")).toBe("public");
  });
});

describe("normalizeHost", () => {
  it.each([
    ["cujo.localhost:3000", "cujo.localhost"],
    ["CUJO.LOCALHOST", "cujo.localhost"],
    ["", ""],
    [undefined, ""],
    [null, ""],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
  });
});

describe("apiPrefix", () => {
  it("sends the public plane to /public and the operator plane to the root", () => {
    expect(apiPrefix("public")).toBe("/public");
    expect(apiPrefix("operator")).toBe("");
  });
});
