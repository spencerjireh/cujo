"""Sensor: the decoy credential and the watcher on it.

Every fact about the decoy is here — what is written, what is preserved, and
how a read of it is noticed. `seed_decoy` and `restore_decoy` are bookends
`setup` and `teardown` call; `watch_decoy` is the daemon in between.
"""

from __future__ import annotations

import os
import shutil
import sys
import time
from pathlib import Path

from cujo_sniff.jsonl import append_jsonl
from cujo_sniff.policy import DECOY_KEY

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


def seed_decoy(decoy: Path, backup: Path) -> Path:
    """Write the decoy, keeping a copy of any real credentials file it replaces."""
    decoy.parent.mkdir(parents=True, exist_ok=True)
    if decoy.exists() and DECOY_KEY not in decoy.read_text(errors="replace"):
        # A real file is in the way. Save its bytes and mode so teardown can
        # put it back exactly; a second setup must not overwrite that backup
        # with the decoy itself.
        shutil.copy2(decoy, backup)
    decoy.write_text(
        "[default]\n"
        f"aws_access_key_id = {DECOY_KEY}\n"
        "aws_secret_access_key = cujo-decoy-secret-do-not-use\n"
    )
    decoy.chmod(0o600)
    return decoy


def restore_decoy(decoy: Path, backup: Path) -> str:
    if backup.exists():
        shutil.copy2(backup, decoy)
        backup.unlink()
        return "restored"
    if decoy.exists() and DECOY_KEY in decoy.read_text(errors="replace"):
        decoy.unlink()
        return "removed"
    return "untouched"
