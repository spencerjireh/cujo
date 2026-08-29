"""Cujo in-sandbox sensors and detonation.

Runs inside the Daytona sandbox as the check subagents' one shared tool. Three
commands, each printing exactly one JSON object on stdout:

    python3 sniff.py setup [--allow-host H ...]
        Seed the decoy secret, start the logging proxy and the decoy watcher,
        write the Python audit hook. Prints the env the checks must export.
    python3 sniff.py run --check NAME [--cwd DIR] -- CMD...
        Run one command under the sensors and print its report.
    python3 sniff.py detonate --dependency SPEC [--source pypi|npm|auto]
        Install one dependency in a fresh environment and print its report.

`teardown` stops the daemons and restores or removes the decoy. The report
shapes and the sensor design are in docs/spec.md, Contract 2. Standard library
only: nothing here may need an install, because the sandbox is the thing being
measured.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
import select
import shutil
import signal
import socket
import socketserver
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

CUJO_DIR = Path(os.environ.get("CUJO_DIR", "/tmp/cujo"))
# Detonation environments live beside the state dir, not inside it: the
# snapshot prunes CUJO_DIR (our own logs churn on every check) but must see
# what an install writes into its environment.
ENVS_DIR = Path(os.environ.get("CUJO_ENVS_DIR", f"{CUJO_DIR}-envs"))
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

# ---------------------------------------------------------------------------
# Paths and small helpers


def home() -> Path:
    return Path(os.environ.get("HOME") or Path.home())


def decoy_path() -> Path:
    return home() / DECOY_REL


def state_paths() -> dict[str, Path]:
    return {
        "proxy_log": CUJO_DIR / "proxy.jsonl",
        "decoy_log": CUJO_DIR / "decoy.jsonl",
        "audit_log": CUJO_DIR / "audit.jsonl",
        "pyhook": CUJO_DIR / "pyhook",
        "config": CUJO_DIR / "config.json",
        "proxy_pid": CUJO_DIR / "proxy.pid",
        "watcher_pid": CUJO_DIR / "watcher.pid",
        "decoy_backup": CUJO_DIR / "decoy.backup",
        "envs": ENVS_DIR,
    }


def load_config() -> dict[str, Any]:
    path = state_paths()["config"]
    if not path.exists():
        return {"allow_hosts": [], "proxy_port": DEFAULT_PROXY_PORT}
    return json.loads(path.read_text())


def tail(text: str, limit: int = TAIL_CHARS) -> str:
    return text[-limit:]


def read_jsonl(path: Path, offset: int = 0) -> list[dict[str, Any]]:
    """Read the JSON lines written after byte `offset`; skip a torn last line."""
    if not path.exists():
        return []
    with path.open("rb") as fh:
        fh.seek(offset)
        data = fh.read()
    rows: list[dict[str, Any]] = []
    for line in data.splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    return rows


def file_size(path: Path) -> int:
    return path.stat().st_size if path.exists() else 0


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    with path.open("a") as fh:
        fh.write(json.dumps(row) + "\n")


def _under(path: Path, target: Path) -> bool:
    return path == target or target in path.parents


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
    candidates = {Path(os.path.normpath(p)), Path(os.path.realpath(p))}
    # HOME itself can be a symlink (macOS puts /tmp under /private), so the
    # targets are resolved the same way the candidates are.
    roots = {h, Path(os.path.realpath(h))}
    for rel in SENSITIVE_HOME_PATHS:
        if any(_under(c, root / rel) for c in candidates for root in roots):
            return True
    return any(str(c).startswith(SENSITIVE_ABS_PREFIXES) for c in candidates)


NOISE_READ_PARTS = ("/site-packages/", "/dist-packages/", "/__pycache__/", "/node_modules/")
# Directory prefixes end in "/" so /usr/libexec is not taken for /usr/lib.
NOISE_READ_PREFIXES = ("/usr/lib/", "/usr/local/lib/", "/proc/", "/sys/", "/dev/", "/etc/ld.so")
NOISE_READ_SUFFIXES = (".pyc", ".dist-info/METADATA", ".dist-info/RECORD")


def is_noise_read(path: str) -> bool:
    """A read the interpreter or a package manager does on its own account.

    Imports from the interpreter's own library tree, bytecode, and installed
    package metadata say nothing about what the code under test did, and
    there are thousands of them per run; dropping them keeps `files_read` to
    the reads that carry a signal. Only those roots count: a shared object or
    a module read from the workspace or anywhere else stays in the list, and
    a sensitive path is never noise, whatever it looks like.

    Our own state directory counts as noise too. `run_sensed` reads the three
    sensor logs to build the report, and it does that with the audit hook
    installed in its own process, so without this the report lists
    `proxy.jsonl` among the files the command under test read.
    """
    p = str(path)
    if p.startswith((f"{sys.prefix}/lib/", f"{sys.base_prefix}/lib/")):
        return True
    if _under(Path(p), CUJO_DIR):
        return True
    return (
        any(part in p for part in NOISE_READ_PARTS)
        or p.startswith(NOISE_READ_PREFIXES)
        or p.endswith(NOISE_READ_SUFFIXES)
    )


def display_path(path: Path, home_dir: Path | None = None) -> str:
    """Render a path with `~` for HOME so reports read the same on any box."""
    h = home_dir or home()
    try:
        return "~/" + str(path.relative_to(h))
    except ValueError:
        return str(path)


def in_any(path: Path, roots: list[Path]) -> bool:
    return any(path == r or r in path.parents for r in roots)


# ---------------------------------------------------------------------------
# Sensor: logging proxy


class _ProxyHandler(socketserver.BaseRequestHandler):
    """Forward one client connection upstream and log host, port, and bytes.

    CONNECT tunnels (HTTPS) are relayed opaquely. Plain HTTP requests carry an
    absolute URL in the request line; the request is rewritten to an
    origin-form line and relayed the same way.
    """

    log_path: Path

    def handle(self) -> None:
        client = self.request
        client.settimeout(30)
        head = self._read_head(client)
        if not head:
            return
        request_line = head.split(b"\r\n", 1)[0].decode("latin-1", "replace")
        parts = request_line.split()
        if len(parts) < 2:
            return
        method, target = parts[0], parts[1]
        try:
            if method == "CONNECT":
                host, port = self._split_hostport(target, 443)
                upstream = socket.create_connection((host, port), timeout=30)
                client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                initial = b""
            else:
                url = urlsplit(target)
                host, port = self._split_hostport(url.netloc, 80)
                upstream = socket.create_connection((host, port), timeout=30)
                path = url.path or "/"
                if url.query:
                    path += "?" + url.query
                version = parts[2] if len(parts) > 2 else "HTTP/1.1"
                rewritten = f"{method} {path} {version}".encode("latin-1")
                initial = rewritten + b"\r\n" + head.split(b"\r\n", 1)[1]
        except OSError:
            client.sendall(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
            return
        sent = len(initial)
        if initial:
            upstream.sendall(initial)
        up, down = _relay(client, upstream)
        upstream.close()
        append_jsonl(
            self.log_path,
            {"ts": time.time(), "host": host, "port": port, "bytes": sent + up + down},
        )

    @staticmethod
    def _read_head(sock: socket.socket) -> bytes:
        buf = b""
        while b"\r\n\r\n" not in buf and len(buf) < 65536:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
        return buf

    @staticmethod
    def _split_hostport(netloc: str, default: int) -> tuple[str, int]:
        host, _, port = netloc.rpartition(":")
        if not host or not port.isdigit():
            return netloc, default
        return host, int(port)


def _relay(a: socket.socket, b: socket.socket) -> tuple[int, int]:
    """Pump bytes both ways until either side closes; return (a->b, b->a) counts."""
    a.setblocking(False)
    b.setblocking(False)
    counts = {a: 0, b: 0}
    peer = {a: b, b: a}
    open_ends = {a, b}
    while open_ends:
        readable, _, _ = select.select(list(open_ends), [], [], 30)
        if not readable:
            break
        for s in readable:
            try:
                data = s.recv(65536)
            except (BlockingIOError, InterruptedError):
                continue
            except OSError:
                data = b""
            if not data:
                open_ends.discard(s)
                try:
                    peer[s].shutdown(socket.SHUT_WR)
                except OSError:
                    pass
                continue
            counts[s] += len(data)
            try:
                peer[s].sendall(data)
            except OSError:
                open_ends.clear()
    return counts[a], counts[b]


def serve_proxy(port: int, log_path: Path) -> None:
    class Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    handler = type("Handler", (_ProxyHandler,), {"log_path": log_path})
    with Server(("127.0.0.1", port), handler) as server:
        server.serve_forever()


# ---------------------------------------------------------------------------
# Sensor: decoy watcher (inotify via ctypes, atime polling as the fallback)

IN_ACCESS = 0x1
IN_OPEN = 0x20


def _inotify_watch(path: Path, log_path: Path) -> bool:
    """Block forever logging IN_OPEN/IN_ACCESS on `path`. False if unavailable."""
    if not sys.platform.startswith("linux"):
        return False
    import ctypes
    import struct

    try:
        libc = ctypes.CDLL("libc.so.6", use_errno=True)
        fd = libc.inotify_init()
        if fd < 0:
            return False
        wd = libc.inotify_add_watch(fd, str(path).encode(), IN_OPEN | IN_ACCESS)
        if wd < 0:
            return False
    except (OSError, AttributeError):
        return False
    append_jsonl(log_path, {"ts": time.time(), "event": "watching", "backend": "inotify"})
    while True:
        data = os.read(fd, 4096)
        offset = 0
        while offset + 16 <= len(data):
            _, mask, _, name_len = struct.unpack_from("iIII", data, offset)
            offset += 16 + name_len
            kind = "open" if mask & IN_OPEN else "access"
            append_jsonl(log_path, {"ts": time.time(), "event": kind, "backend": "inotify"})


def _atime_poll(path: Path, log_path: Path) -> None:
    append_jsonl(log_path, {"ts": time.time(), "event": "watching", "backend": "atime"})
    last = path.stat().st_atime_ns if path.exists() else 0
    while True:
        time.sleep(0.2)
        try:
            now = path.stat().st_atime_ns
        except FileNotFoundError:
            continue
        if now != last:
            last = now
            append_jsonl(log_path, {"ts": time.time(), "event": "access", "backend": "atime"})


def watch_decoy(path: Path, log_path: Path) -> None:
    if not _inotify_watch(path, log_path):
        _atime_poll(path, log_path)


# ---------------------------------------------------------------------------
# Sensor: Python audit hook

# Installed on PYTHONPATH so every Python process a check spawns (pip running a
# setup.py included) reports opens, connects, and subprocesses. Guarded against
# re-entry because writing the log is itself an `open` event.
SITECUSTOMIZE = r"""
import json, os, sys, threading

_LOG = os.environ.get("CUJO_AUDIT_LOG")
_RUN = os.environ.get("CUJO_RUN_ID")
_local = threading.local()


def _write(row):
    if not _LOG or getattr(_local, "busy", False):
        return
    _local.busy = True
    try:
        row["pid"] = os.getpid()
        row["run"] = _RUN
        with open(_LOG, "a") as fh:
            fh.write(json.dumps(row) + "\n")
    except Exception:
        pass
    finally:
        _local.busy = False


def _hook(event, args):
    try:
        if event == "open":
            path, mode = args[0], args[1]
            if isinstance(path, (str, bytes)) and mode is not None:
                _write({"event": "open", "path": os.fsdecode(path), "mode": str(mode)})
        elif event == "socket.connect":
            addr = args[1]
            if isinstance(addr, tuple) and len(addr) >= 2:
                _write({"event": "connect", "host": str(addr[0]), "port": int(addr[1])})
        elif event == "subprocess.Popen":
            argv = args[1]
            if isinstance(argv, (list, tuple)):
                _write({"event": "subprocess", "argv": [os.fsdecode(a) for a in argv]})
            elif argv is not None:
                _write({"event": "subprocess", "argv": [os.fsdecode(argv)]})
        elif event in ("os.exec", "os.posix_spawn"):
            argv = args[1]
            if isinstance(argv, (list, tuple)):
                _write({"event": "subprocess", "argv": [os.fsdecode(a) for a in argv]})
    except Exception:
        pass


if _LOG:
    sys.addaudithook(_hook)
"""


def write_pyhook(pyhook_dir: Path) -> None:
    pyhook_dir.mkdir(parents=True, exist_ok=True)
    (pyhook_dir / "sitecustomize.py").write_text(SITECUSTOMIZE.lstrip())


# ---------------------------------------------------------------------------
# Sensor: filesystem snapshot


def _snapshot_roots(workspace_roots: list[Path]) -> list[Path]:
    roots = [home(), *workspace_roots, Path("/etc")]
    unique: list[Path] = []
    for r in roots:
        if r.exists() and r not in unique:
            unique.append(r)
    return unique


def snapshot(workspace_roots: list[Path]) -> dict[str, tuple[int, int]]:
    """Map path -> (mtime_ns, size) for HOME, the workspace, and /etc.

    Skips our own state dir and .git internals; stops at a file cap so a huge
    tree cannot turn a check into a snapshot benchmark.
    """
    seen: dict[str, tuple[int, int]] = {}
    for root in _snapshot_roots(workspace_roots):
        for dirpath, dirnames, filenames in os.walk(root, onerror=lambda e: None):
            d = Path(dirpath)
            if d == CUJO_DIR or CUJO_DIR in d.parents or d.name == ".git":
                dirnames[:] = []
                continue
            for name in filenames:
                p = d / name
                try:
                    st = p.lstat()
                except OSError:
                    continue
                seen[str(p)] = (st.st_mtime_ns, st.st_size)
                if len(seen) >= MAX_SNAPSHOT_FILES:
                    return seen
    return seen


def diff_snapshots(
    before: dict[str, tuple[int, int]],
    after: dict[str, tuple[int, int]],
    workspace_roots: list[Path],
    home_dir: Path | None = None,
) -> list[dict[str, Any]]:
    """Rows for every path that differs between the snapshots, deletions included.

    A deletion is a write too: removing a credential or a shell rc is at least
    as interesting as creating one, so before-only paths get a `deleted` row
    with the same workspace and sensitivity classification.
    """
    changes: list[dict[str, Any]] = []
    for path in sorted(before.keys() | after.keys()):
        if path in before and path in after and before[path] == after[path]:
            continue
        if path not in after:
            kind = "deleted"
        elif path in before:
            kind = "modified"
        else:
            kind = "created"
        p = Path(path)
        changes.append(
            {
                "path": display_path(p, home_dir),
                "type": kind,
                "in_workspace": in_any(p, workspace_roots),
                "sensitive": is_sensitive(path, home_dir),
            }
        )
    return changes


# ---------------------------------------------------------------------------
# Sensor merge


def build_sensor_block(
    *,
    proxy_rows: list[dict[str, Any]],
    audit_rows: list[dict[str, Any]],
    decoy_rows: list[dict[str, Any]],
    fs_changes: list[dict[str, Any]],
    allow_hosts: list[str],
    check: str,
    home_dir: Path | None = None,
    cwd: Path | None = None,
) -> dict[str, Any]:
    """Fold the raw sensor logs into the block every check report carries.

    `cwd` is the audited command's working directory: the audit hook records
    paths as the program passed them, so a relative one is resolved here,
    against that directory, before it is classified.
    """
    base = Path(cwd) if cwd is not None else Path.cwd()
    decoy = str((home_dir or home()) / DECOY_REL)
    egress = _merge_egress(proxy_rows)
    files_read: list[dict[str, Any]] = []
    subprocesses: list[dict[str, Any]] = []
    decoy_read = any(r.get("event") in ("open", "access") for r in decoy_rows)
    seen_paths: set[str] = set()
    for row in audit_rows:
        if row.get("event") == "open":
            mode = row.get("mode", "r")
            path = str(row.get("path", ""))
            if path and not os.path.isabs(path):
                path = str(base / path)
            if path == decoy:
                decoy_read = True
            if any(ch in mode for ch in "wax+"):
                continue
            if path in seen_paths:
                continue
            seen_paths.add(path)
            sensitive = is_sensitive(path, home_dir)
            if not sensitive and is_noise_read(path):
                continue
            if sensitive or len(files_read) < MAX_FILES_READ:
                files_read.append(
                    {"path": display_path(Path(path), home_dir), "sensitive": sensitive}
                )
        elif row.get("event") == "subprocess":
            subprocesses.append({"argv": row.get("argv", [])})
        elif row.get("event") == "connect":
            host = row.get("host", "")
            if host and not host.startswith("127.") and host != "::1":
                egress.append({"host": host, "port": row.get("port", 0), "bytes": 0})
    allowed = KNOWN_INDEX_HOSTS | {h.lower() for h in allow_hosts}
    for e in egress:
        e["known"] = e["host"].lower() in allowed
    unknown = any(not e["known"] for e in egress)
    is_install = check == "detonation"
    return {
        "egress": egress,
        "files_read": files_read,
        "fs_changes": fs_changes,
        "subprocesses": subprocesses,
        "secret_probe": {"decoy_read": decoy_read, "decoy_in_egress": False},
        "derived": {
            "egress_to_unknown_host": unknown,
            "wrote_outside_workspace": any(not c["in_workspace"] for c in fs_changes),
            "wrote_sensitive": any(c["sensitive"] for c in fs_changes),
            # The install's own pip/npm processes are expected; a nested spawn is not.
            "spawned_subprocess": len(subprocesses) > (1 if is_install else 0),
        },
    }


def _merge_egress(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals: dict[tuple[str, int], int] = {}
    for r in rows:
        key = (str(r.get("host", "")), int(r.get("port", 0)))
        totals[key] = totals.get(key, 0) + int(r.get("bytes", 0))
    return [{"host": h, "port": p, "bytes": b} for (h, p), b in sorted(totals.items())]


# ---------------------------------------------------------------------------
# Running a command under the sensors


def sensor_env(config: dict[str, Any], run_id: str | None = None) -> dict[str, str]:
    paths = state_paths()
    proxy = f"http://127.0.0.1:{config.get('proxy_port', DEFAULT_PROXY_PORT)}"
    pyhook = str(paths["pyhook"])
    existing = os.environ.get("PYTHONPATH")
    pythonpath = pyhook if not existing else f"{pyhook}{os.pathsep}{existing}"
    env = {
        "HTTP_PROXY": proxy,
        "HTTPS_PROXY": proxy,
        "http_proxy": proxy,
        "https_proxy": proxy,
        "NO_PROXY": "",
        "PYTHONPATH": pythonpath,
        "CUJO_AUDIT_LOG": str(paths["audit_log"]),
        # Marks a sensed process as running inside Cujo's sandbox. The demo
        # sample (evil-package) keeps its payload inert unless this is set.
        "CUJO_SANDBOX": "1",
    }
    # Only a command `run_sensed` is watching carries one. The env `setup`
    # prints has none, so a process started outside a sensed window writes
    # rows no report claims, rather than rows the next report claims wrongly.
    if run_id is not None:
        env["CUJO_RUN_ID"] = run_id
    return env


@contextlib.contextmanager
def sensed_window(timeout: float = SENSED_LOCK_TIMEOUT_S) -> Iterator[bool]:
    """Hold the sensors for one command. Yields False when the wait timed out.

    The proxy, the watcher, and the audit hook append to three logs shared by
    every check, and a report is the slice of those logs written while one
    command ran. Two commands sensed at once therefore read each other's rows:
    `probes` reports `smoke`'s egress, and both snapshot each other's writes.
    Nothing in the rubric serialises the checks, so this does.

    A wait that times out proceeds anyway. A review that returns evidence from
    an overlapping window is worse than one that blocks forever only in the
    sense that it is wrong; a review that never finishes is wrong too, and the
    overlap is announced on stderr.
    """
    lock_path = CUJO_DIR / "sensed.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fh = lock_path.open("a+")
    deadline = time.monotonic() + timeout
    held = False
    try:
        while True:
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                held = True
                break
            except OSError:
                if time.monotonic() >= deadline:
                    print(
                        f"sniff: sensors busy after {timeout:.0f}s; this report may "
                        "carry another command's rows",
                        file=sys.stderr,
                    )
                    break
                time.sleep(0.1)
        yield held
    finally:
        if held:
            fcntl.flock(fh, fcntl.LOCK_UN)
        fh.close()


def run_sensed(
    argv: list[str], *, check: str, workspace_roots: list[Path], cwd: Path
) -> dict[str, Any]:
    """Run `argv` with the sensor env and return the report minus the header."""
    paths = state_paths()
    config = load_config()
    run_id = os.urandom(6).hex()
    with sensed_window():
        offsets = {k: file_size(paths[k]) for k in ("proxy_log", "audit_log", "decoy_log")}
        before = snapshot(workspace_roots)
        env = {**os.environ, **sensor_env(config, run_id)}
        started = time.monotonic()
        try:
            proc = subprocess.run(
                argv, cwd=str(cwd), env=env, capture_output=True, text=True, errors="replace"
            )
            exit_code, out, err = proc.returncode, proc.stdout, proc.stderr
        except FileNotFoundError as exc:
            exit_code, out, err = 127, "", str(exc)
        duration = round(time.monotonic() - started, 2)
        time.sleep(0.3)  # let the daemons flush the last events
        after = snapshot(workspace_roots)
        proxy_rows = read_jsonl(paths["proxy_log"], offsets["proxy_log"])
        # The offsets bound the window; the run id says whose rows these are.
        # A process the command left running keeps writing into the next
        # command's window, and only the id tells the two apart.
        audit_rows = [
            r
            for r in read_jsonl(paths["audit_log"], offsets["audit_log"])
            if r.get("run") == run_id
        ]
        decoy_rows = read_jsonl(paths["decoy_log"], offsets["decoy_log"])
    sensors = build_sensor_block(
        proxy_rows=proxy_rows,
        audit_rows=audit_rows,
        decoy_rows=decoy_rows,
        fs_changes=diff_snapshots(before, after, workspace_roots),
        allow_hosts=config.get("allow_hosts", []),
        check=check,
        cwd=cwd,
    )
    return {
        "argv": argv,
        "exit": exit_code,
        "duration_s": duration,
        "stdout_tail": tail(out),
        "stderr_tail": tail(err),
        **sensors,
    }


# ---------------------------------------------------------------------------
# Commands


def _daemon_env() -> dict[str, str]:
    """The environment a sensor daemon runs in: never a sensed one.

    A daemon inherits whatever the operator exported, and the rubric tells the
    operator to export the sensor env for every later command. That put the
    audit hook inside the proxy, so each upstream connection the proxy opened
    on a check's behalf was logged as a `connect` and appended to `egress` a
    second time, with a phantom `bytes: 0`. Dropping `CUJO_AUDIT_LOG` disarms
    the hook; the proxy variables go with it so a daemon can never be routed
    through the proxy it is.
    """
    strip = {
        "CUJO_AUDIT_LOG",
        "CUJO_RUN_ID",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "http_proxy",
        "https_proxy",
        "NO_PROXY",
    }
    return {k: v for k, v in os.environ.items() if k not in strip}


def _spawn_daemon(args: list[str], pid_file: Path, log_name: str) -> int:
    log = (CUJO_DIR / log_name).open("ab")
    proc = subprocess.Popen(
        [sys.executable, os.path.abspath(__file__), *args],
        stdout=log,
        stderr=log,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
        env=_daemon_env(),
    )
    pid_file.write_text(str(proc.pid))
    return proc.pid


def _wait_port(port: int, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _stop_daemons() -> list[int]:
    """SIGTERM the daemons named by the pid files; forget the files."""
    stopped: list[int] = []
    for key in ("proxy_pid", "watcher_pid"):
        pid_file = state_paths()[key]
        if not pid_file.exists():
            continue
        try:
            pid = int(pid_file.read_text())
            os.kill(pid, signal.SIGTERM)
            stopped.append(pid)
        except (ValueError, ProcessLookupError):
            pass
        pid_file.unlink(missing_ok=True)
    for pid in stopped:
        deadline = time.monotonic() + 2.0
        while _pid_alive(pid) and time.monotonic() < deadline:
            time.sleep(0.05)
    return stopped


def _port_free(port: int) -> bool:
    with socket.socket() as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def _seed_decoy(paths: dict[str, Path]) -> Path:
    """Write the decoy, keeping a copy of any real credentials file it replaces."""
    decoy = decoy_path()
    decoy.parent.mkdir(parents=True, exist_ok=True)
    if decoy.exists() and DECOY_KEY not in decoy.read_text(errors="replace"):
        # A real file is in the way. Save its bytes and mode so teardown can
        # put it back exactly; a second setup must not overwrite that backup
        # with the decoy itself.
        shutil.copy2(decoy, paths["decoy_backup"])
    decoy.write_text(
        "[default]\n"
        f"aws_access_key_id = {DECOY_KEY}\n"
        "aws_secret_access_key = cujo-decoy-secret-do-not-use\n"
    )
    decoy.chmod(0o600)
    return decoy


def _restore_decoy(paths: dict[str, Path]) -> str:
    decoy = decoy_path()
    backup = paths["decoy_backup"]
    if backup.exists():
        shutil.copy2(backup, decoy)
        backup.unlink()
        return "restored"
    if decoy.exists() and DECOY_KEY in decoy.read_text(errors="replace"):
        decoy.unlink()
        return "removed"
    return "untouched"


def cmd_setup(args: argparse.Namespace) -> dict[str, Any]:
    paths = state_paths()
    CUJO_DIR.mkdir(parents=True, exist_ok=True)
    for key in ("proxy_log", "audit_log", "decoy_log"):
        paths[key].touch()
    # Setup is idempotent: an earlier setup's daemons are stopped first so
    # their pid files never go stale and the port is ours to bind.
    _stop_daemons()
    decoy = _seed_decoy(paths)
    write_pyhook(paths["pyhook"])
    port = args.proxy_port
    if port == 0:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
    elif not _port_free(port):
        return {"ok": False, "error": f"port {port} is held by another process"}
    config = {"allow_hosts": args.allow_host, "proxy_port": port, "decoy": str(decoy)}
    paths["config"].write_text(json.dumps(config))
    proxy_pid = _spawn_daemon(["_proxy", "--port", str(port)], paths["proxy_pid"], "proxy.log")
    _spawn_daemon(["_watch"], paths["watcher_pid"], "watcher.log")
    ready = _wait_port(port) and _pid_alive(proxy_pid)
    return {"ok": ready, "proxy_port": port, "decoy": str(decoy), "env": sensor_env(config)}


def cmd_run(args: argparse.Namespace) -> dict[str, Any]:
    if not args.cmd:
        raise SystemExit("run: give the command after `--`")
    cwd = Path(args.cwd or os.getcwd()).resolve()
    report = run_sensed(args.cmd, check=args.check, workspace_roots=[cwd], cwd=cwd)
    return {"check": args.check, **report}


def detect_source(spec: str) -> str:
    if spec.startswith("npm:"):
        return "npm"
    if re.match(r"^(@[\w.-]+/)?[\w.-]+@[^=]", spec):
        return "npm"
    return "pypi"


def _pypi_install_cmds(env_dir: Path, spec: str) -> list[list[str]]:
    """Prefer venv+pip; use uv when the interpreter ships without pip."""
    python = env_dir / "bin" / "python"
    pip_ok = subprocess.run(
        [sys.executable, "-c", "import ensurepip"], capture_output=True
    ).returncode
    if pip_ok == 0:
        return [
            [sys.executable, "-m", "venv", str(env_dir)],
            [str(python), "-m", "pip", "install", "--no-input", spec],
        ]
    uv = shutil.which("uv")
    if uv is None:
        raise SystemExit("detonate: neither ensurepip nor uv is available")
    return [
        [uv, "venv", str(env_dir)],
        [uv, "pip", "install", "--python", str(python), spec],
    ]


def cmd_detonate(args: argparse.Namespace) -> dict[str, Any]:
    spec = args.dependency
    source = args.source if args.source != "auto" else detect_source(spec)
    spec_clean = spec.removeprefix("npm:")
    env_dir = state_paths()["envs"] / hashlib.sha1(spec.encode()).hexdigest()[:12]
    shutil.rmtree(env_dir, ignore_errors=True)
    env_dir.mkdir(parents=True)
    if source == "npm":
        cmds = [["npm", "install", "--prefix", str(env_dir), "--no-audit", "--no-fund", spec_clean]]
    else:
        cmds = _pypi_install_cmds(env_dir, spec_clean)
    started = time.monotonic()
    reports: list[dict[str, Any]] = []
    for cmd in cmds:
        r = run_sensed(cmd, check="detonation", workspace_roots=[env_dir], cwd=env_dir)
        reports.append(r)
        if r["exit"] != 0:
            break
    last = reports[-1]
    sensors = _merge_reports(reports)
    return {
        "dependency": spec_clean,
        "source": source,
        "install_ok": all(r["exit"] == 0 for r in reports),
        "duration_s": round(time.monotonic() - started, 2),
        "subprocesses": [{"argv": r["argv"], "exit": r["exit"]} for r in reports]
        + [{"argv": s["argv"], "exit": None} for s in sensors.pop("subprocesses")],
        "stdout_tail": tail(last["stdout_tail"]),
        "stderr_tail": tail(last["stderr_tail"]),
        **sensors,
    }


def _merge_reports(reports: list[dict[str, Any]]) -> dict[str, Any]:
    """Union the sensor blocks of several sensed commands into one block."""
    keys = ("egress", "files_read", "fs_changes", "subprocesses")
    merged: dict[str, Any] = {k: [] for k in keys}
    for r in reports:
        for k in keys:
            merged[k].extend(r[k])
    merged["egress"] = _merge_egress(merged["egress"])
    merged["secret_probe"] = {
        "decoy_read": any(r["secret_probe"]["decoy_read"] for r in reports),
        "decoy_in_egress": False,
    }
    merged["derived"] = {k: any(r["derived"][k] for r in reports) for k in reports[0]["derived"]}
    return merged


def cmd_teardown(_args: argparse.Namespace) -> dict[str, Any]:
    stopped = _stop_daemons()
    return {"ok": True, "stopped": stopped, "decoy": _restore_decoy(state_paths())}


# ---------------------------------------------------------------------------
# CLI


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sniff.py", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    setup = sub.add_parser("setup", help="seed the decoy, start the sensors")
    setup.add_argument("--allow-host", action="append", default=[], metavar="HOST")
    setup.add_argument("--proxy-port", type=int, default=DEFAULT_PROXY_PORT)
    setup.set_defaults(func=cmd_setup)

    run = sub.add_parser("run", help="run one command under the sensors")
    run.add_argument("--check", required=True)
    run.add_argument("--cwd")
    run.add_argument("cmd", nargs=argparse.REMAINDER)
    run.set_defaults(func=cmd_run)

    det = sub.add_parser("detonate", help="install one dependency under the sensors")
    det.add_argument("--dependency", required=True)
    det.add_argument("--source", choices=["pypi", "npm", "auto"], default="auto")
    det.set_defaults(func=cmd_detonate)

    down = sub.add_parser("teardown", help="stop the sensor daemons")
    down.set_defaults(func=cmd_teardown)

    proxy = sub.add_parser("_proxy")
    proxy.add_argument("--port", type=int, required=True)
    proxy.set_defaults(func=None)
    sub.add_parser("_watch").set_defaults(func=None)
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    if args.command == "_proxy":
        serve_proxy(args.port, state_paths()["proxy_log"])
        return
    if args.command == "_watch":
        watch_decoy(decoy_path(), state_paths()["decoy_log"])
        return
    if args.command == "run" and args.cmd[:1] == ["--"]:
        args.cmd = args.cmd[1:]
    print(json.dumps(args.func(args)))


if __name__ == "__main__":
    main()
