"""The two predicates that decide what a sensor row means."""

from __future__ import annotations

import sys
from pathlib import Path

from cujo_sniff.policy import is_noise_read, is_sensitive, should_hash


def test_sensitive_paths(home_dir: Path) -> None:
    assert is_sensitive(str(home_dir / ".ssh" / "id_rsa"), home_dir)
    assert is_sensitive(str(home_dir / ".aws" / "credentials"), home_dir)
    assert is_sensitive(str(home_dir / ".bashrc"), home_dir)
    assert is_sensitive(str(home_dir / ".config" / "gcloud" / "x"), home_dir)
    assert is_sensitive("/etc/cron.d/job", home_dir)
    assert not is_sensitive(str(home_dir / "project" / "app.py"), home_dir)
    assert not is_sensitive(str(home_dir / ".cache" / "pip" / "x"), home_dir)


def test_sensitive_survives_traversal_and_symlink(tmp_path: Path, home_dir: Path) -> None:
    # The audit hook records a path as the program passed it, so a `..` segment
    # reached ~/.ssh while reading as an ordinary path under /tmp.
    detour = f"/tmp/..{home_dir}/.ssh/id_rsa"
    assert is_sensitive(detour, home_dir)
    assert is_sensitive(f"{home_dir}/../{home_dir.name}/.ssh/id_rsa", home_dir)
    assert is_sensitive(f"{home_dir}/./.aws/credentials", home_dir)
    assert is_sensitive(f"{home_dir}/project/../.bashrc", home_dir)
    # A link planted inside a sensitive directory is sensitive even though it
    # resolves somewhere dull, which is why both readings are checked.
    (home_dir / ".ssh").mkdir()
    dull = tmp_path / "dull"
    dull.write_text("x")
    link = home_dir / ".ssh" / "authorized_keys"
    link.symlink_to(dull)
    assert is_sensitive(str(link), home_dir)
    # Traversal that lands somewhere ordinary is still ordinary.
    assert not is_sensitive(f"{home_dir}/.ssh/../project/app.py", home_dir)


def test_noise_reads_are_dropped_but_sensitive_reads_never(home_dir: Path) -> None:
    assert is_noise_read("/usr/local/lib/python3.13/site-packages/pytest/__init__.py")
    assert is_noise_read("/usr/local/lib/python3.13/__pycache__/ast.cpython-313.pyc")
    assert is_noise_read(f"{sys.prefix}/lib/python3.12/os.py")
    assert is_noise_read("/work/head/node_modules/left-pad/index.js")
    assert not is_noise_read(str(home_dir / "work" / "app" / "orders.py"))
    assert not is_noise_read("/etc/passwd")
    # A shared object outside the interpreter tree is a real read, and
    # /usr/libexec is not /usr/lib.
    assert not is_noise_read(str(home_dir / "work" / "native.so"))
    assert not is_noise_read("/usr/libexec/git-core/git")


def test_reads_of_our_own_state_dir_are_still_evidence(tmp_path: Path) -> None:
    state = tmp_path / "cujo"
    # setup parks the real credentials file here when it seeds the decoy, so a
    # command reading it is stealing a credential, not making sensor noise.
    assert not is_noise_read(str(state / "decoy.backup"))
    assert not is_noise_read(str(state / "proxy.jsonl"))
    assert not is_noise_read(str(tmp_path / "cujo-envs" / "lib" / "payload.py"))


def test_the_credential_locations_a_sandbox_never_writes(home_dir: Path) -> None:
    """The set is what a benign install has no business touching.

    Every entry below is a path that hands over an identity or runs code as
    someone else. A write to one of them is a `critical` the agent may not
    lower, so the list is short on purpose: it holds the places where there is
    no innocent reason for an installer to be at all.
    """
    for rel in (
        ".kube/config",
        ".docker/config.json",
        ".git-credentials",
        ".gnupg/secring.gpg",
        ".config/gh/hosts.yml",
        ".bash_profile",
        ".gitconfig",
    ):
        assert is_sensitive(str(home_dir / rel), home_dir), rel
    for path in (
        "/etc/passwd",
        "/etc/shadow",
        "/etc/sudoers",
        "/etc/sudoers.d/99-pwn",
        "/etc/ssh/sshd_config",
        "/etc/pam.d/sudo",
        "/etc/systemd/system/x.service",
        "/etc/profile.d/x.sh",
    ):
        assert is_sensitive(path, home_dir), path
    assert not is_sensitive("/etc/hostname", home_dir)


def test_a_shared_prefix_is_not_a_sensitive_path(home_dir: Path) -> None:
    """`/etc/passwd` and `/etc/passwd_backup` share eight characters, and that is
    all they share.

    A `startswith` over the absolute set conflated them, and a write to a file
    the author happened to name badly became a `critical` nobody can lower. The
    entry has to be the path itself or a directory above it.
    """
    for sibling in (
        "/etc/passwd_backup",
        "/etc/shadow.bak",
        "/etc/sudoers_notes",
        "/etc/sshd_backup",
        "/etc/cronjunk",
        "/etc/profiler.conf",
        "/etc/systemdish",
    ):
        assert not is_sensitive(sibling, home_dir), sibling
    # And the directories still cover what is under them.
    assert is_sensitive("/etc/ssh/sshd_config", home_dir)
    assert is_sensitive("/etc/sudoers.d/99-pwn", home_dir)
    assert is_sensitive("/etc/cron.d/job", home_dir)


def test_ld_so_preload_is_sensitive_before_it_is_noise(home_dir: Path) -> None:
    """The shortest path from a sandbox write to code in someone else's process.

    It sits under the `/etc/ld.so` noise prefix, so it is also the case that
    proves the order: `build_sensor_block` asks whether a path is sensitive
    first, and only a path that is not consults `is_noise_read`.
    """
    assert is_noise_read("/etc/ld.so.cache")
    assert is_noise_read("/etc/ld.so.preload")
    assert is_sensitive("/etc/ld.so.preload", home_dir)
    assert not is_sensitive("/etc/ld.so.cache", home_dir)


def test_hashing_is_spent_on_credentials_and_etc(home_dir: Path) -> None:
    # (mtime, size) is defeated by a restored timestamp, and a digest is the
    # answer -- but hashing all of HOME would make a snapshot a full read of it.
    assert should_hash(str(home_dir / ".ssh" / "id_rsa"), home_dir)
    assert should_hash("/etc/hostname", home_dir)
    assert not should_hash(str(home_dir / "work" / "app.py"), home_dir)
    assert not should_hash("/usr/lib/libc.so", home_dir)
