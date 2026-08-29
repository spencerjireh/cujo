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

DEFAULT_PROXY_PORT = 8899
DECOY_KEY = "AKIACUJODECOY0000000"
DECOY_REL = Path(".aws/credentials")
TAIL_CHARS = 4000
MAX_FILES_READ = 200
MAX_SNAPSHOT_FILES = 200_000
# How long one sensed command waits for another to release the sensors. Longer
# than any check should take, so the wait ends because the other command
# finished and not because the clock ran out.
SENSED_LOCK_TIMEOUT_S = 900.0

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
    ".config/gcloud",
    ".netrc",
    ".npmrc",
    ".pypirc",
)
SENSITIVE_ABS_PREFIXES = ("/etc/cron",)

NOISE_READ_PARTS = ("/site-packages/", "/dist-packages/", "/__pycache__/", "/node_modules/")
# Directory prefixes end in "/" so /usr/libexec is not taken for /usr/lib.
NOISE_READ_PREFIXES = ("/usr/lib/", "/usr/local/lib/", "/proc/", "/sys/", "/dev/", "/etc/ld.so")
NOISE_READ_SUFFIXES = (".pyc", ".dist-info/METADATA", ".dist-info/RECORD")


def tail(text: str, limit: int = TAIL_CHARS) -> str:
    return text[-limit:]


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
    return any(str(c).startswith(SENSITIVE_ABS_PREFIXES) for c in candidates)


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
