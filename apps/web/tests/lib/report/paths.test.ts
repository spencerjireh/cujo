import { commonPrefix, isArtifact, isSensitive, relativize } from "@/lib/report/paths";
import { describe, expect, it } from "vitest";

describe("commonPrefix", () => {
  it("finds the shared directory, ending in a slash", () => {
    expect(commonPrefix(["/work/repo/src/a.py", "/work/repo/tests/b.py"])).toBe("/work/repo/");
  });

  it("is empty for fewer than two paths", () => {
    expect(commonPrefix([])).toBe("");
    expect(commonPrefix(["/work/repo/a.py"])).toBe("");
  });

  it("is empty when the only common part is the root", () => {
    expect(commonPrefix(["/etc/passwd", "/work/repo/a.py"])).toBe("");
  });

  it("splits on directories, not characters", () => {
    expect(commonPrefix(["/work/a/x", "/work/ab/y"])).toBe("/work/");
  });

  it("does not take a file as a directory", () => {
    // The first path is a file inside the directory the second names.
    expect(commonPrefix(["/work/repo/a.py", "/work/repo"])).toBe("/work/");
  });
});

describe("relativize", () => {
  it("strips the base from every path", () => {
    expect(relativize(["/work/repo/src/a.py", "/work/repo/tests/b.py"])).toEqual({
      base: "/work/repo/",
      rel: ["src/a.py", "tests/b.py"],
    });
  });

  it("leaves the paths alone when there is no base", () => {
    expect(relativize(["/etc/passwd", "/work/a"])).toEqual({
      base: "",
      rel: ["/etc/passwd", "/work/a"],
    });
  });
});

describe("isArtifact", () => {
  it("knows bytecode and tool caches", () => {
    expect(isArtifact("/work/repo/app/__pycache__/x.cpython-312.pyc")).toBe(true);
    expect(isArtifact("/work/repo/.pytest_cache/v/cache/nodeids")).toBe(true);
    expect(isArtifact("/work/repo/.mypy_cache/3.12/a.json")).toBe(true);
    expect(isArtifact("/work/repo/.ruff_cache/CACHEDIR.TAG")).toBe(true);
    expect(isArtifact("/work/repo/node_modules/.cache/babel/x.json")).toBe(true);
    expect(isArtifact("/work/repo/a.pyc")).toBe(true);
    expect(isArtifact("__pycache__/x.pyc")).toBe(true);
  });

  it("leaves source and ordinary dependencies alone", () => {
    expect(isArtifact("/work/repo/app/main.py")).toBe(false);
    expect(isArtifact("/work/repo/node_modules/left-pad/index.js")).toBe(false);
    expect(isArtifact("/work/repo/pycache_notes.md")).toBe(false);
  });
});

describe("isSensitive", () => {
  it("matches a home path under any spelling of home", () => {
    expect(isSensitive("~/.ssh/id_rsa")).toBe(true);
    expect(isSensitive("/root/.ssh")).toBe(true);
    expect(isSensitive("/home/dev/.aws/credentials")).toBe(true);
    expect(isSensitive("/home/dev/.docker/config.json")).toBe(true);
    expect(isSensitive("/home/dev/.config/gh/hosts.yml")).toBe(true);
  });

  it("matches an absolute path itself or anything under it", () => {
    expect(isSensitive("/etc/passwd")).toBe(true);
    expect(isSensitive("/etc/cron.d/backup")).toBe(true);
    expect(isSensitive("/etc/ld.so.preload")).toBe(true);
  });

  it("never matches by string prefix", () => {
    expect(isSensitive("/etc/passwd_backup")).toBe(false);
    expect(isSensitive("/home/dev/.sshrc")).toBe(false);
    expect(isSensitive("/etc/cron")).toBe(false);
  });

  it("leaves a home-looking path outside home alone", () => {
    expect(isSensitive("/work/repo/.ssh/known_hosts")).toBe(false);
    expect(isSensitive("/home/dev/project/.npmrc")).toBe(false);
    expect(isSensitive("/work/repo/app/main.py")).toBe(false);
  });
});
