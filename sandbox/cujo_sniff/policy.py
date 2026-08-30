"""What counts as interesting: the tunables and the two predicates.

Everything a reviewer would want to argue about — which hosts an install may
talk to, which paths are credentials, which reads are noise, how much output
survives into a report — is in this one file. The sensors say what happened;
this says which of it matters.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from cujo_sniff.paths import canonical, home, under

# The report shape. Bumped when a consumer would read an old report wrongly --
# a renamed key or a changed meaning -- and not for a new one, because every
# consumer ignores fields it does not know. A consumer that meets a version it
# does not recognise reads what it can rather than rejecting the report: half
# the evidence beats none, and the sandbox is always newer than the container
# reading it (decision 54).
SCHEMA_VERSION = 1

DEFAULT_PROXY_PORT = 8899
DECOY_KEY = "AKIACUJODECOY0000000"
DECOY_REL = Path(".aws/credentials")
TAIL_CHARS = 4000
MAX_SCRIPT_CHARS = 8000
MAX_FILES_READ = 200
MAX_SNAPSHOT_FILES = 200_000
INTERPRETER_NAMES = frozenset(
    {
        "python3",
        "python",
        "python3.14",
        "python3.13",
        "python3.12",
        "python3.11",
        "python3.10",
        "node",
        "bash",
        "sh",
        "ruby",
        "perl",
        "deno",
        "bun",
        "tsx",
        "ts-node",
    }
)
# Above this a file is compared by (mtime, size) alone, and the report says so.
# The cap exists so a snapshot cannot be turned into a hashing benchmark by
# dropping a huge file somewhere sensitive -- but it is set well past any real
# credential, because a cap that quietly disables the comparison hands back the
# evasion the digest was added to close. What it cannot cover, it declares:
# see `truncated.hashes`.
HASH_MAX_BYTES = 64 * 1024 * 1024
# How long one sensed command waits for another to release the sensors. Longer
# than any check should take, so the wait ends because the other command
# finished and not because the clock ran out.
SENSED_LOCK_TIMEOUT_S = 900.0

# What `prepare` puts in front of the model, and how much of it.
#
# Human-authored build files only. Every lock file is deliberately absent:
# `uv.lock` and `pnpm-lock.yaml` run to hundreds of kilobytes, say nothing about
# how to install or test anything, and would crowd out the files that do. The
# manifest that *names* the dependencies is here; the one that pins them is the
# detonation check's business, and it reads it from the diff.
# It has to cover every language the reviewer might meet, not every language we
# happened to think of: the parent infers `test` from these, and a build system
# missing here reads downstream as "no test suite found", which skips every
# check and posts that as the entire review. The demo target alone is C++, Go,
# Node, PHP, Python and Rust.
PREPARE_FILES = frozenset(
    {
        # Python
        "pyproject.toml",
        "setup.py",
        "setup.cfg",
        "requirements.txt",
        "requirements-dev.txt",
        "tox.ini",
        "noxfile.py",
        # JavaScript and TypeScript
        "package.json",
        # Go, Rust, Ruby, PHP
        "go.mod",
        "Cargo.toml",
        "Gemfile",
        "Rakefile",
        "composer.json",
        # JVM
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        "build.sbt",
        # C, C++ and anything that just has a runner
        "CMakeLists.txt",
        "meson.build",
        "Makefile",
        "makefile",
        "GNUmakefile",
        "justfile",
        "Justfile",
    }
)
#: A CI workflow is any YAML directly inside a directory with this name.
WORKFLOW_DIR = "workflows"
# How far down to look. Zero would only find a single-project repository, and
# the demo target is not one: `orders-api` holds six services under
# `services/<name>/`, with no manifest at the root at all, and its workflows sit
# at `.github/workflows/`. Both are depth 2. Deeper than that and a monorepo's
# `node_modules` starts to look like a project.
PREPARE_MAX_DEPTH = 2
# Never descended into. Every one of these holds manifests belonging to somebody
# else's code, and `node_modules` alone can hold thousands.
PREPARE_SKIP_DIRS = frozenset(
    {
        ".git",
        ".mypy_cache",
        ".pytest_cache",
        ".tox",
        ".venv",
        "__pycache__",
        "build",
        "dist",
        "node_modules",
        "target",
        "vendor",
        "venv",
    }
)
# Enough for a polyglot repository's every service and CI workflow, capped so a
# repository with two hundred of them cannot fill the turn. Shallower paths win
# the cap, and whatever the cap dropped is counted in `omitted` — which the
# rubric reads, because a cap that silently hid the one workflow naming the test
# command would turn a real suite into "no test suite found".
PREPARE_MAX_FILES = 40
PREPARE_FILE_CHARS = 4000
# `.cujo.yml` gets its own, larger budget and is never counted against the one
# above. It comes from the *base* branch -- the code a maintainer already
# merged -- so it is not the pull request's to write, which is the whole reason
# policy is read from there. A cap still exists because a base file large
# enough to fill the turn would be a denial of service against the review, but
# a policy file this size is already unreasonable and the limit is set where no
# real one lives.
#
# Past it the file is reported *unreadable* rather than returned in part. Half a
# policy is worse than none: the half that did not fit may be `allow_hosts`, and
# a reviewer that reads `test:` and misses the allowlist proceeds confidently
# with the wrong permissions.
PREPARE_POLICY_CHARS = 32000
# Long enough for a cold clone of a large repository, short enough that a
# stalled remote fails with a diagnosable step instead of hanging the run.
PREPARE_GIT_TIMEOUT_S = 300.0

# Hosts an install legitimately talks to. Anything else, and not allowlisted,
# is `egress_to_unknown_host`.
KNOWN_INDEX_HOSTS = frozenset(
    {
        "pypi.org",
        "files.pythonhosted.org",
        "registry.npmjs.org",
        "github.com",
        "objects.githubusercontent.com",
        "codeload.github.com",
        "crates.io",
        "static.crates.io",
        "proxy.golang.org",
        "sum.golang.org",
        "rubygems.org",
        "index.rubygems.org",
    }
)

# Paths relative to $HOME (or absolute) that a benign install has no business
# touching. A write under one of them is `wrote_sensitive`; a read is flagged.
SENSITIVE_HOME_PATHS = (
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
)
# Absolute paths, each matched as itself or as a directory containing the path
# in question -- never as a string prefix. `/etc/passwd` and `/etc/passwd_backup`
# share eight characters and nothing else, and a `startswith` that conflated
# them would turn an ordinary file the author happened to name badly into a
# `critical` nobody can lower. So the directories are listed as directories and
# every file is named outright, `/etc/cron.d` and `/etc/crontab` included, where
# the single prefix `/etc/cron` used to stand for both.
SENSITIVE_ABS_PATHS = (
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
    # Writable by root only, read by every dynamic executable: the shortest path
    # from a sandbox write to code running in someone else's process. It is also
    # under the `/etc/ld.so` noise prefix below, which is why the sensitive
    # verdict has to be taken first -- see `is_noise_read`.
    "/etc/ld.so.preload",
)

NOISE_READ_PARTS = (
    "/site-packages/",
    "/dist-packages/",
    "/__pycache__/",
    "/node_modules/",
    "/.gem/",
    "/vendor/",
)
# Directory prefixes end in "/" so /usr/libexec is not taken for /usr/lib.
NOISE_READ_PREFIXES = ("/usr/lib/", "/usr/local/lib/", "/proc/", "/sys/", "/dev/", "/etc/ld.so")
NOISE_READ_SUFFIXES = (".pyc", ".dist-info/METADATA", ".dist-info/RECORD")


def is_sensitive(path: str, home_dir: Path | None = None) -> bool:
    """True when `path` is under a credentials, shell-rc, or cron location.

    The path is classified twice, lexically normalised and fully resolved,
    and either match is enough. Comparing the raw path alone missed anything
    a `..` segment could hide: the audit hook records a path as the program
    passed it, so `/tmp/../home/u/.ssh/id_rsa` never matched `~/.ssh` and the
    read went unflagged. Resolving alone would trade that for a different
    miss, a symlink planted inside a sensitive directory whose target is
    somewhere dull. A tripwire fires on either reading.
    """
    h = home_dir or home()
    p = Path(os.path.expanduser(path))
    if not p.is_absolute():
        p = Path.cwd() / p
    candidates = {Path(os.path.normpath(p)), canonical(p)}
    # HOME itself can be a symlink (macOS puts /tmp under /private), so the
    # targets are resolved the same way the candidates are.
    roots = {h, canonical(h)}
    for rel in SENSITIVE_HOME_PATHS:
        if any(under(c, root / rel) for c in candidates for root in roots):
            return True
    # `under`, not `startswith`: the entry has to be the path itself or a
    # directory above it. A shared prefix is not a relationship.
    return any(under(c, Path(abs_path)) for c in candidates for abs_path in SENSITIVE_ABS_PATHS)


def decoy_spellings(home_dir: Path | None = None) -> set[Path]:
    """Both names the seeded decoy answers to.

    The audit hook records a path as the program passed it, which need not be
    the one `setup` seeded, and HOME itself can be a symlink. Either reading is
    the decoy, so both are kept and compared against.
    """
    decoy = (home_dir or home()) / DECOY_REL
    return {decoy, canonical(decoy)}


def is_decoy(path: str | Path, decoy_paths: set[Path]) -> bool:
    """Whether `path` names the seeded decoy, under either spelling.

    `decoy_paths` is passed in rather than derived here because the callers
    that ask this most -- once per audit row -- would otherwise resolve the
    decoy again for every row.
    """
    p = Path(os.path.expanduser(str(path)))
    return p in decoy_paths or canonical(p) in decoy_paths


def should_hash(path: str, home_dir: Path | None = None, *, symlink: bool = False) -> bool:
    """Whether this path is worth a content digest as well as its metadata.

    `(mtime_ns, size)` is defeated by anything that restores the timestamp after
    a same-length overwrite -- flipping a flag, swapping a key for another key.
    Hashing every file would turn each snapshot into a full read of HOME, so it
    is spent where a silent edit is the whole attack: the credential and
    shell-rc locations, and the rest of `/etc`, which is walked anyway.

    The seeded decoy is the one sensitive path excluded, and it has to be. A
    digest means an open, the watcher is armed on that inode for exactly that
    event, and it cannot tell the snapshot's read from the read it exists to
    catch -- so hashing it made `decoy_read` true on every command, on the
    unmodified base commit included. Nothing is lost: the entry still carries
    metadata, `decoy_intact` follows the inode, and a command that overwrites
    the decoy has to open it, which the watcher sees.

    `symlink` is why the caller has to say what it `lstat`ed. A link is digested
    by its target string, which is a `readlink` and never opens what it points
    at, so a link that merely *resolves* to the decoy trips nothing and is
    hashed like any other. Excluding it would give up the retargeted-link case
    -- repoint it at another target of the same length, put the timestamp back,
    and two `lstat` calls agree -- in exchange for nothing at all.
    """
    if is_sensitive(path, home_dir):
        return symlink or not is_decoy(path, decoy_spellings(home_dir))
    p = Path(os.path.normpath(os.path.expanduser(path)))
    return str(p).startswith("/etc/")


def is_noise_read(path: str) -> bool:
    """A read the interpreter or a package manager does on its own account.

    Imports from the interpreter's own library tree, bytecode, and installed
    package metadata say nothing about what the code under test did, and
    there are thousands of them per run; dropping them keeps `files_read` to
    the reads that carry a signal. Only those roots count: a shared object or
    a module read from the workspace or anywhere else stays in the list, and
    a sensitive path is never noise, whatever it looks like.

    Cujo's own state directory is deliberately not on this list. `run_sensed`
    reads the sensor logs with the audit hook installed in its own process,
    but those rows go to the shared audit log and no report reads that one, so
    they never needed filtering. Excluding the directory would instead hide a
    command reading `decoy.backup`, which holds the real credentials file the
    decoy displaced.
    """
    p = str(path)
    if p.startswith((f"{sys.prefix}/lib/", f"{sys.base_prefix}/lib/")):
        return True
    return (
        any(part in p for part in NOISE_READ_PARTS)
        or p.startswith(NOISE_READ_PREFIXES)
        or p.endswith(NOISE_READ_SUFFIXES)
    )
