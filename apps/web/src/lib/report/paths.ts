/**
 * Reading a list of paths the way a PR author would. Pure, so the tests cover
 * it the way they cover `format.ts`.
 *
 * A files-read table in a sandbox report is two hundred rows that all start
 * with `/work/repo/`, and the eye has to find where the rows stop agreeing
 * before it can read any of them. The base is said once and the rows carry
 * what is left. The classification helpers below mirror the sandbox's own
 * lists so a path the report did not mark still reads the way the sandbox
 * would have read it.
 */

/**
 * The longest directory prefix every path shares, ending in `/`.
 *
 * Empty when there is nothing to share: fewer than two paths, or a common
 * part that is only the root, which would strip one character from every row
 * and buy nothing. Directory-wise, not character-wise: `/work/a/x` and
 * `/work/ab/y` share `/work/` and not `/work/a`.
 */
export function commonPrefix(paths: string[]): string {
  if (paths.length < 2) return "";
  const first = paths[0];
  if (first === undefined) return "";
  let shared = first.split("/").slice(0, -1);
  for (const path of paths.slice(1)) {
    const parts = path.split("/").slice(0, -1);
    let i = 0;
    while (i < shared.length && i < parts.length && shared[i] === parts[i]) i += 1;
    shared = shared.slice(0, i);
    if (shared.length === 0) return "";
  }
  const prefix = `${shared.join("/")}/`;
  return prefix === "/" ? "" : prefix;
}

/** The same list with the shared base taken off the front of every path. */
export function relativize(paths: string[]): { base: string; rel: string[] } {
  const base = commonPrefix(paths);
  if (!base) return { base, rel: paths };
  return { base, rel: paths.map((path) => path.slice(base.length)) };
}

const ARTIFACT_SEGMENTS = [
  "__pycache__/",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  "node_modules/.cache/",
];

/**
 * A path a toolchain writes for itself. Bytecode and tool caches are the bulk
 * of most filesystem-change lists and never the reason a row is worth reading,
 * so the table folds them behind one count.
 */
export function isArtifact(path: string): boolean {
  if (path.endsWith(".pyc")) return true;
  return ARTIFACT_SEGMENTS.some(
    (segment) => path.includes(`/${segment}`) || path.startsWith(segment),
  );
}

// Copied from `sandbox/cujo_sniff/policy.py` (`SENSITIVE_HOME_PATHS` and
// `SENSITIVE_ABS_PATHS`). Nothing under `sandbox/` can be imported here, so the
// two lists are restated and have to be kept in step by hand.
const SENSITIVE_HOME_PATHS = [
  ".ssh",
  ".aws",
  ".bashrc",
  ".profile",
  ".zshrc",
  ".bash_profile",
  ".config/gcloud",
  ".config/gh",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".kube",
  ".docker/config.json",
  ".git-credentials",
  ".gitconfig",
  ".gnupg",
];

const SENSITIVE_ABS_PATHS = [
  "/etc/crontab",
  "/etc/cron.d",
  "/etc/cron.hourly",
  "/etc/cron.daily",
  "/etc/cron.weekly",
  "/etc/cron.monthly",
  "/etc/cron.allow",
  "/etc/cron.deny",
  "/etc/shadow",
  "/etc/gshadow",
  "/etc/passwd",
  "/etc/group",
  "/etc/sudoers",
  "/etc/sudoers.d",
  "/etc/ssh",
  "/etc/pam.d",
  "/etc/systemd",
  "/etc/profile",
  "/etc/profile.d",
  "/etc/ld.so.preload",
];

/** The path itself, or anything under it as a directory. Never a string prefix. */
function under(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * The part of a path after its home directory, when it has one: `~/x`,
 * `/root/x`, or `/home/<user>/x`. Null for any other path.
 */
function homeRelative(path: string): string | null {
  if (path.startsWith("~/")) return path.slice(2);
  if (path.startsWith("/root/")) return path.slice("/root/".length);
  const match = /^\/home\/[^/]+\/(.*)$/.exec(path);
  return match?.[1] ?? null;
}

/**
 * Whether a path is one the sandbox would flag: a credentials, shell-rc, or
 * cron location. The same policy as `is_sensitive` in the sandbox, less the
 * normalisation: the report's paths are already what the sensor recorded, and
 * the sandbox has flagged what it could. This is the second reading, for a
 * row an older sensor did not mark.
 */
export function isSensitive(path: string): boolean {
  const rel = homeRelative(path);
  if (rel !== null && SENSITIVE_HOME_PATHS.some((home) => under(rel, home))) return true;
  return SENSITIVE_ABS_PATHS.some((abs) => under(path, abs));
}
