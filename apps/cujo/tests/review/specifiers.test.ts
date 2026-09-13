import { describe, expect, it } from "vitest";
import type { PullRequestFile } from "../../src/clients/github";
import { addedSpecifiers, isExact, normalizeSpecifier } from "../../src/review/specifiers";

const file = (path: string, added: string[], removed: string[] = []): PullRequestFile => ({
  path,
  status: "modified",
  additions: added.length,
  deletions: removed.length,
  patch: [
    "@@ -1,3 +1,4 @@",
    " context",
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
  ].join("\n"),
});

describe("addedSpecifiers (decision 145)", () => {
  it("reads an exact pin added to requirements.txt and normalises the name", () => {
    const out = addedSpecifiers([file("requirements.txt", ["Requests_Toolbelt == 1.0.0  # http"])]);
    expect(out).toEqual([
      {
        source: "pypi",
        specifier: "requests-toolbelt==1.0.0",
        exact: true,
        path: "requirements.txt",
      },
    ]);
  });

  it("keeps extras in the key, sorted", () => {
    const out = addedSpecifiers([
      file("services/a/requirements-dev.txt", ["httpx[http2, socks]==0.27.0"]),
    ]);
    expect(out[0]?.specifier).toBe("httpx[http2,socks]==0.27.0");
  });

  it("reads a 40-hex git pin as exact and a branch or tag pin as not", () => {
    const sha = "a".repeat(40);
    const out = addedSpecifiers([
      file("requirements.txt", [
        `git+https://github.com/o/evil-package@${sha}`,
        "evil-package @ git+https://github.com/o/evil-package@main",
        "git+https://github.com/o/evil-package",
      ]),
    ]);
    expect(out.map((s) => [s.specifier, s.exact])).toEqual([
      [`git+https://github.com/o/evil-package@${sha}`, true],
      ["git+https://github.com/o/evil-package@main", false],
      ["git+https://github.com/o/evil-package", false],
    ]);
  });

  it("reads a pyproject dependency line, quoted", () => {
    const out = addedSpecifiers([
      file("pyproject.toml", ['    "humanize==4.9.0",', '    "rich>=13",']),
    ]);
    expect(out).toEqual([
      { source: "pypi", specifier: "humanize==4.9.0", exact: true, path: "pyproject.toml" },
      { source: "pypi", specifier: "rich>=13", exact: false, path: "pyproject.toml" },
    ]);
  });

  it("reads an exact version added to package.json and marks a range as not exact", () => {
    const out = addedSpecifiers([
      file("package.json", [
        '    "left-pad": "1.3.0",',
        '    "@scope/pkg": "^2.0.0",',
        '    "latest-thing": "latest"',
      ]),
    ]);
    expect(out.map((s) => [s.specifier, s.exact])).toEqual([
      ["left-pad@1.3.0", true],
      ["@scope/pkg@^2.0.0", false],
      ["latest-thing@latest", false],
    ]);
  });

  it("reads a go.mod require line, pseudo-versions included, and skips indirect", () => {
    const out = addedSpecifiers([
      file("go.mod", [
        "\tgithub.com/pkg/errors v0.9.1",
        "require golang.org/x/text v0.3.0-0.20200101000000-abcdef123456",
        "\tgithub.com/other/dep v1.0.0 // indirect",
      ]),
    ]);
    expect(out.map((s) => [s.specifier, s.exact])).toEqual([
      ["github.com/pkg/errors@v0.9.1", true],
      ["golang.org/x/text@v0.3.0-0.20200101000000-abcdef123456", true],
    ]);
  });

  it("reads a Gemfile gem line with an exact version, and one without as not exact", () => {
    const out = addedSpecifiers([
      file("Gemfile", ['gem "rack", "3.0.8"', "gem 'puma', '~> 6.0'", 'gem "rake"']),
    ]);
    expect(out.map((s) => [s.specifier, s.exact])).toEqual([
      ["rack:3.0.8", true],
      ["puma:~> 6.0", false],
      ["rake", false],
    ]);
  });

  it("ignores removed lines, context lines, lockfiles and files with no patch", () => {
    const out = addedSpecifiers([
      file("requirements.txt", [], ["humanize==4.9.0"]),
      file("uv.lock", ['name = "humanize"', 'version = "4.9.0"']),
      file("package-lock.json", ['"left-pad": "1.3.0",']),
      { path: "requirements.txt", status: "modified", additions: 1, deletions: 0, patch: null },
      file("app/main.py", ["import humanize"]),
    ]);
    expect(out).toEqual([]);
  });

  it("collapses the same specifier added in two manifests", () => {
    const out = addedSpecifiers([
      file("requirements.txt", ["humanize==4.9.0"]),
      file("services/b/requirements.txt", ["humanize==4.9.0"]),
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("isExact and normalizeSpecifier", () => {
  it("judge a sensor-reported specifier by the same rule", () => {
    expect(isExact("pypi", "Humanize==4.9.0")).toBe(true);
    expect(normalizeSpecifier("pypi", "Humanize==4.9.0")).toBe("humanize==4.9.0");
    expect(isExact("pypi", "humanize>=4")).toBe(false);
    expect(isExact("pypi", `git+https://x/y@${"b".repeat(40)}`)).toBe(true);
    expect(isExact("pypi", "git+https://x/y@main")).toBe(false);
    expect(isExact("npm", "@scope/pkg@2.0.0")).toBe(true);
    expect(isExact("npm", "@scope/pkg@^2.0.0")).toBe(false);
    expect(isExact("go", "github.com/pkg/errors@v0.9.1")).toBe(true);
    expect(isExact("go", "github.com/pkg/errors@latest")).toBe(false);
    expect(isExact("gem", "rack:3.0.8")).toBe(true);
    expect(isExact("gem", "rack")).toBe(false);
  });
});
