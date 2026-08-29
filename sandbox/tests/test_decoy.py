"""Direct tests for the decoy sensor internals.

The watcher backends (_inotify_watch, _atime_poll) and helper functions
(seed_decoy, restore_decoy, watched_backend) are tested here. The full CLI
integration (setup -> run -> teardown with decoy reads) is in test_cli.py.
"""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path

from cujo_sniff.jsonl import append_jsonl, file_size, read_jsonl
from cujo_sniff.policy import DECOY_KEY
from cujo_sniff.sensors.decoy import (
    _atime_poll,
    restore_decoy,
    seed_decoy,
    watched_backend,
)


def test_atime_poll_detects_access(tmp_path: Path) -> None:
    """_atime_poll should log an 'access' event when the file is read."""
    target = tmp_path / "decoy"
    target.write_text("secret")
    log = tmp_path / "decoy.jsonl"

    errors: list[Exception] = []

    def poll_thread():
        try:
            _atime_poll(target, log)
        except Exception as exc:
            errors.append(exc)

    t = threading.Thread(target=poll_thread, daemon=True)
    t.start()

    # Wait for the watcher to arm
    deadline = time.monotonic() + 3.0
    armed = False
    while time.monotonic() < deadline:
        if log.exists():
            rows = list(read_jsonl(log))
            if any(r.get("event") == "watching" for r in rows):
                armed = True
                break
        time.sleep(0.05)
    assert armed, "atime poller never armed"

    # Touch the file's atime by reading it
    time.sleep(0.3)
    # Force atime update: read after a short delay
    os.utime(target, (time.time(), target.stat().st_mtime))
    time.sleep(0.5)

    rows = list(read_jsonl(log))
    watching = [r for r in rows if r.get("event") == "watching"]
    assert len(watching) >= 1
    assert watching[0]["backend"] == "atime"

    accesses = [r for r in rows if r.get("event") == "access"]
    assert len(accesses) >= 1
    assert not errors, f"poller thread raised: {errors}"


def test_atime_poll_handles_deleted_file(tmp_path: Path) -> None:
    """_atime_poll should not crash if the file is deleted mid-poll."""
    target = tmp_path / "decoy"
    target.write_text("secret")
    log = tmp_path / "decoy.jsonl"

    errors: list[Exception] = []

    def poll_thread():
        try:
            _atime_poll(target, log)
        except Exception as exc:
            errors.append(exc)

    t = threading.Thread(target=poll_thread, daemon=True)
    t.start()

    # Wait for arming
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        if log.exists():
            rows = list(read_jsonl(log))
            if any(r.get("event") == "watching" for r in rows):
                break
        time.sleep(0.05)

    # Delete the file -- the poller should handle FileNotFoundError gracefully
    target.unlink()
    time.sleep(0.5)

    # The thread should still be alive (not crashed)
    assert t.is_alive()
    assert not errors, f"poller thread raised: {errors}"


def test_watched_backend_returns_backend_name(tmp_path: Path) -> None:
    log = tmp_path / "decoy.jsonl"
    append_jsonl(log, {"ts": 1.0, "event": "watching", "backend": "atime"})
    result = watched_backend(log, timeout=1.0)
    assert result == "atime"


def test_watched_backend_returns_none_when_no_watching_event(tmp_path: Path) -> None:
    log = tmp_path / "decoy.jsonl"
    log.touch()
    result = watched_backend(log, timeout=0.2)
    assert result is None


def test_watched_backend_respects_offset(tmp_path: Path) -> None:
    log = tmp_path / "decoy.jsonl"
    append_jsonl(log, {"ts": 1.0, "event": "watching", "backend": "old"})
    mid = file_size(log)
    append_jsonl(log, {"ts": 2.0, "event": "watching", "backend": "new"})
    result = watched_backend(log, offset=mid, timeout=1.0)
    assert result == "new"


def test_seed_decoy_writes_key(tmp_path: Path) -> None:
    decoy = tmp_path / ".aws" / "credentials"
    backup = tmp_path / "backup"
    seed_decoy(decoy, backup)
    content = decoy.read_text()
    assert DECOY_KEY in content
    assert not backup.exists()


def test_seed_decoy_preserves_existing_credentials(tmp_path: Path) -> None:
    decoy = tmp_path / ".aws" / "credentials"
    decoy.parent.mkdir(parents=True)
    decoy.write_text("[default]\naws_access_key_id = REAL\n")
    backup = tmp_path / "backup"
    seed_decoy(decoy, backup)
    assert DECOY_KEY in decoy.read_text()
    assert backup.exists()
    assert "REAL" in backup.read_text()


def test_restore_decoy_puts_original_back(tmp_path: Path) -> None:
    decoy = tmp_path / ".aws" / "credentials"
    decoy.parent.mkdir(parents=True)
    original = "[default]\naws_access_key_id = REAL\n"
    decoy.write_text(original)
    backup = tmp_path / "backup"

    seed_decoy(decoy, backup)
    assert DECOY_KEY in decoy.read_text()

    result = restore_decoy(decoy, backup)
    assert result == "restored"
    assert decoy.read_text() == original
    assert not backup.exists()


def test_restore_decoy_removes_when_no_backup(tmp_path: Path) -> None:
    decoy = tmp_path / ".aws" / "credentials"
    backup = tmp_path / "backup"
    seed_decoy(decoy, backup)
    assert decoy.exists()

    result = restore_decoy(decoy, backup)
    assert result == "removed"
    assert not decoy.exists()


def test_restore_decoy_untouched_when_not_ours(tmp_path: Path) -> None:
    decoy = tmp_path / ".aws" / "credentials"
    decoy.parent.mkdir(parents=True)
    decoy.write_text("not ours")
    backup = tmp_path / "backup"

    result = restore_decoy(decoy, backup)
    assert result == "untouched"
    assert decoy.read_text() == "not ours"
