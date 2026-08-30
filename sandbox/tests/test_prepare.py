"""`sniff.py prepare`: the clone, the worktree, and what comes back from them.

Every test that clones clones from a **local** repository built in `tmp_path`
and handed over as a `file://` URL. That keeps the suite hermetic: no network,
no rate limit, and no demo repository that has to stay alive for CI to pass.

It costs one concession, made explicitly rather than by loosening the thing
under test. `check_clone_url` admits http and https and nothing else, which a
`file://` URL correctly fails, so the clone tests stub it out and the check gets
its own class of cases below. Admitting `file://` in production to make a test
easier would be the wrong trade in the one function whose whole job is refusing
URLs.
"""

from __future__ import annotations

import argparse
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from cujo_sniff.context import Context
from cujo_sniff.policy import PREPARE_FILE_CHARS, PREPARE_FILES, PREPARE_POLICY_CHARS
from cujo_sniff.prepare import (
    _SHA,
    _claim,
    _read,
    _replaceable,
    check_clone_url,
    cmd_prepare,
)

pytestmark = pytest.mark.harness

#: The fixture repository's one pull request. Any number would do; it is here so
#: the ref the fixture publishes and the argument the command is given cannot
#: drift apart silently.
PR_NUMBER = 7

#: The repository the fixture pull request belongs to.
REPO = "spencerjireh/demo"


def git(cwd: Path, *args: str) -> str:
    env = {
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.invalid",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.invalid",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_SYSTEM": "/dev/null",
        "PATH": "/usr/bin:/bin:/usr/local/bin",
        "HOME": str(cwd),
    }
    proc = subprocess.run(
        ["git", *args], cwd=str(cwd), env=env, capture_output=True, text=True, check=True
    )
    return proc.stdout.strip()


@pytest.fixture
def origin(tmp_path: Path) -> dict[str, str]:
    """A two-commit repository: a base, then a head that adds a dependency."""
    repo = tmp_path / "origin"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    (repo / "pyproject.toml").write_text('[project]\nname = "demo"\ndependencies = []\n')
    (repo / "Makefile").write_text("test:\n\tpytest -q\n")
    (repo / ".cujo.yml").write_text("test: pytest -q\nallow_hosts:\n  - api.example\n")
    (repo / "uv.lock").write_text("LOCKFILE" * 4000)
    workflows = repo / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "ci.yml").write_text("jobs:\n  test:\n    run: pytest\n")
    # A service under `services/<name>/`, which is the shape the demo target
    # actually has: `orders-api` holds six of them and no root manifest at all.
    service = repo / "services" / "orders-py"
    service.mkdir(parents=True)
    (service / "pyproject.toml").write_text('[project]\nname = "orders-py"\n')
    # Somebody else's manifests. Never descended into, at any depth.
    junk = repo / "services" / "node_modules" / "left-pad"
    junk.mkdir(parents=True)
    (junk / "package.json").write_text('{"name":"left-pad"}')
    # Depth 3, past the limit: a manifest this deep is not this repo's shape.
    deep = repo / "a" / "b" / "c"
    deep.mkdir(parents=True)
    (deep / "go.mod").write_text("module deep\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    base_sha = git(repo, "rev-parse", "HEAD")

    (repo / "pyproject.toml").write_text(
        '[project]\nname = "demo"\ndependencies = ["evil-package"]\n'
    )
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "head")
    head_sha = git(repo, "rev-parse", "HEAD")
    # GitHub publishes every pull request's head on the *base* repository as
    # `refs/pull/<n>/head`, which is how a fork's commit is reachable without a
    # credential. `prepare` fetches that ref rather than assuming the commit is
    # in the clone, so the fixture has to have one or the whole path is stubbed
    # out and the tests prove nothing about it.
    git(repo, "update-ref", f"refs/pull/{PR_NUMBER}/head", head_sha)
    return {"url": repo.as_uri(), "base_sha": base_sha, "head_sha": head_sha}


@pytest.fixture
def prepare(
    tmp_path: Path,
    ctx: Context,
    origin: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> Callable[..., dict[str, object]]:
    # The scheme check, stood down for the local clone only. See the module
    # docstring: it is covered on its own, and weakening it for a fixture would
    # be weakening the one function whose job is to refuse.
    monkeypatch.setattr("cujo_sniff.prepare.check_clone_url", lambda _url, _repo: None)

    def run(pr_ref: str | None = None, **overrides: str) -> dict[str, object]:
        args = argparse.Namespace(
            clone_url=origin["url"],
            head_sha=origin["head_sha"],
            base_sha=origin["base_sha"],
            pr_number=PR_NUMBER,
            repo=REPO,
            head=str(tmp_path / "work" / "head"),
            base=str(tmp_path / "work" / "base"),
        )
        for key, value in overrides.items():
            setattr(args, key, value)
        # GitHub moves `refs/pull/<n>/head` with every push, so a test that
        # commits and then reviews the new commit gets the ref moved for it.
        # `pr_ref` pins it somewhere else, which is the drift case. A head that
        # is not an object name at all belongs to the tests that check the
        # refusal happens before git runs, and there is no ref to move for it.
        target = pr_ref or args.head_sha
        if _SHA.fullmatch(str(target)):
            git(tmp_path / "origin", "update-ref", f"refs/pull/{PR_NUMBER}/head", target)
        return cmd_prepare(ctx, args)

    return run


class TestTheCloneUrl:
    """A pure function, so it is tested as one."""

    def test_a_public_https_url_is_allowed(self) -> None:
        assert check_clone_url("https://github.com/o/r.git", "o/r") is None
        assert check_clone_url("http://github.com/o/r.git", "o/r") is None

    def test_a_url_carrying_a_credential_is_refused_without_echoing_it(self) -> None:
        secret = "s3cr3t-value"
        refusal = check_clone_url(f"https://x-access-token:{secret}@github.com/o/r.git", "o/r")
        assert refusal is not None
        assert "credentials" in refusal
        # The whole point of the refusal is that the token does not travel; a
        # refusal that quotes it back has moved it into the report instead.
        assert secret not in refusal

    def test_a_credential_in_the_query_string_is_refused_too(self) -> None:
        # Userinfo is not the only place a credential rides: every signed URL
        # puts it in the query, and a fragment hides one from a careless reader.
        # A public clone URL needs neither, so both are refused outright rather
        # than inspected for which parameters look secret.
        secret = "s3cr3t-value"
        refusal = check_clone_url(f"https://github.com/o/r.git?token={secret}", "o/r")
        assert refusal is not None
        assert secret not in refusal
        assert check_clone_url("https://github.com/o/r.git#token=x", "o/r") is not None

    def test_ssh_and_scp_forms_are_refused(self) -> None:
        # Not because they are dangerous in themselves, but because both carry a
        # key by definition and neither is how a public clone is spelled.
        assert check_clone_url("ssh://git@github.com/o/r.git", "o/r") is not None
        assert check_clone_url("git@github.com:o/r.git", "o/r") is not None

    def test_a_url_that_would_be_read_as_an_option_is_refused(self) -> None:
        # Falls out of the scheme check: nothing beginning `-` has one.
        assert check_clone_url("--upload-pack=touch /tmp/pwned", "o/r") is not None

    def test_a_url_with_no_host_is_refused(self) -> None:
        assert check_clone_url("https:///o/r.git", "o/r") is not None

    def test_another_repository_on_the_same_host_is_refused(self) -> None:
        """The host was not enough; every public repository shares it.

        `--clone-url` is model-composed and the turn message carrying it also
        carries the pull request's own title and body, so a URL the model was
        talked into would otherwise have this box clone and report on somebody
        else's code under this pull request's name.
        """
        assert check_clone_url("https://github.com/o/r.git", "o/r") is None
        assert check_clone_url("https://github.com/o/r", "o/r") is None
        # Case is GitHub's to fold, and the two spellings are one repository.
        assert check_clone_url("https://github.com/O/R.git", "o/r") is None
        assert check_clone_url("https://github.com/someone/else.git", "o/r") is not None
        assert check_clone_url("https://github.com/o/r-fork.git", "o/r") is not None
        # A prefix is not a match either.
        assert check_clone_url("https://github.com/o/r/extra.git", "o/r") is not None

    def test_a_host_cujo_does_not_review_is_refused(self) -> None:
        """The URL is supposed to come from the API, and it arrives through a prompt.

        `apps/cujo` reads it from GitHub, but it reaches `prepare` in a turn
        message that also carries the pull request's own title and body, and the
        model composes the argv. A pull request that talks the model into a
        different `--clone-url` would have the sandbox clone and report on
        somebody else's code. `api.github.com` is already hardcoded on the
        trusted side, so naming the host here narrows nothing that works.
        """
        assert check_clone_url("https://evil.example/o/r.git", "o/r") is not None
        assert check_clone_url("https://github.com.evil.example/o/r.git", "o/r") is not None
        assert check_clone_url("https://127.0.0.1/o/r.git", "o/r") is not None
        assert check_clone_url("https://github.com/o/r.git", "o/r") is None

    def test_a_url_that_will_not_parse_is_refused_and_not_raised(self) -> None:
        """`urlsplit` raises on a malformed authority, and this is a refusal too.

        Uncaught it reached the CLI's error envelope, which answers with a
        traceback and no `steps` -- a different shape for the same event, on the
        path where the caller is most likely to be reading the refusal. The
        exception carries no part of the URL, so nothing leaked; what was wrong
        was the shape of the answer.
        """
        secret = "s3cr3t-value"
        for bad in ("http://[", f"https://[{secret}", "http://[::1"):
            refusal = check_clone_url(bad, "o/r")
            assert refusal is not None, bad
            assert secret not in refusal


class TestThePrepare:
    def test_it_clones_the_head_and_worktrees_the_base(
        self, prepare: Callable[..., dict[str, object]], origin: dict[str, str]
    ) -> None:
        out = prepare()
        assert out["ok"] is True, out
        head, base = Path(str(out["head"])), Path(str(out["base"]))
        assert (head / "pyproject.toml").is_file()
        assert (base / "pyproject.toml").is_file()
        # The two trees are the two commits, which is the whole reason both
        # exist: a check compares them.
        assert "evil-package" in (head / "pyproject.toml").read_text()
        assert "evil-package" not in (base / "pyproject.toml").read_text()
        # clone, fetch the pull ref, rev-parse it, checkout, worktree add.
        assert [s["exit"] for s in out["steps"]] == [0, 0, 0, 0, 0]  # type: ignore[index,union-attr]

    def test_the_policy_file_comes_from_base(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path
    ) -> None:
        out = prepare()
        assert "api.example" in str(out["cujo_yml"])

    def test_it_returns_the_build_files_and_not_the_lock(
        self, prepare: Callable[..., dict[str, object]]
    ) -> None:
        files = out_files(prepare())
        assert "pyproject.toml" in files
        assert "Makefile" in files
        assert ".github/workflows/ci.yml" in files
        # A lock file is hundreds of kilobytes and says nothing about how to run
        # anything. Reading one would crowd out the files that do.
        assert "uv.lock" not in files
        # And the head's copy, not the base's: the checks run against head.
        assert "evil-package" in files["pyproject.toml"]

    def test_it_finds_a_manifest_inside_a_service_directory(
        self, prepare: Callable[..., dict[str, object]]
    ) -> None:
        # The shape the demo target actually has. A root-only reader would hand
        # the model nothing here and it would go back to opening files one at a
        # time, which is the round trip this whole command exists to remove.
        files = out_files(prepare())
        assert "services/orders-py/pyproject.toml" in files

    def test_it_never_descends_into_somebody_elses_dependencies(
        self, prepare: Callable[..., dict[str, object]]
    ) -> None:
        files = out_files(prepare())
        assert not [name for name in files if "node_modules" in name]

    def test_it_stops_at_the_depth_limit(self, prepare: Callable[..., dict[str, object]]) -> None:
        files = out_files(prepare())
        assert "a/b/c/go.mod" not in files

    def test_the_cap_keeps_the_shallowest_and_counts_what_it_dropped(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path, monkeypatch
    ) -> None:
        monkeypatch.setattr("cujo_sniff.prepare.PREPARE_MAX_FILES", 2)
        out = prepare()
        files = out_files(out)
        assert len(files) == 2
        # Shallowest first, so what survives describes the repository as a whole
        # rather than one service inside it.
        assert all("/" not in name for name in files)
        assert out["omitted"] > 0  # type: ignore[operator]

    def test_a_long_file_is_capped_and_says_so(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path, origin: dict[str, str]
    ) -> None:
        repo = tmp_path / "origin"
        padding = "x" * (PREPARE_FILE_CHARS * 2)
        (repo / "Makefile").write_text(f"# {padding}\ntest:\n\tpytest\n")
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "long")
        out = prepare(head_sha=git(repo, "rev-parse", "HEAD"))
        assert len(out_files(out)["Makefile"]) == PREPARE_FILE_CHARS
        assert "Makefile" in out["truncated"]  # type: ignore[operator]

    def test_a_repository_with_no_policy_file_reports_none_not_empty(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path
    ) -> None:
        repo = tmp_path / "origin"
        (repo / ".cujo.yml").unlink()
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "drop policy")
        sha = git(repo, "rev-parse", "HEAD")
        out = prepare(head_sha=sha, base_sha=sha)
        # None and not "": a repository that declined to set policy is a
        # different fact from one whose policy file is empty.
        assert out["cujo_yml"] is None

    def test_it_replaces_a_previous_attempt_rather_than_cloning_into_it(
        self, prepare: Callable[..., dict[str, object]]
    ) -> None:
        first = prepare()
        stale = Path(str(first["head"])) / "LEFTOVER"
        stale.write_text("from the last attempt")
        second = prepare()
        assert second["ok"] is True, second
        # A retry that merged into the old tree would index this as the pull
        # request's own file, and nothing downstream could tell.
        assert not stale.exists()

    def test_a_symlinked_manifest_is_not_followed_out_of_the_checkout(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path
    ) -> None:
        # The name of a build file is the pull request's to choose, and so is
        # whether it is a symlink. Following one turns a manifest reader into an
        # arbitrary-file reader aimed at the box the sensors run in.
        outside = tmp_path / "outside-the-repo.txt"
        outside.write_text("NOT-FROM-THE-REPOSITORY")
        repo = tmp_path / "origin"
        (repo / "Cargo.toml").symlink_to(outside)
        (repo / "services" / "orders-py" / "go.mod").symlink_to("../../../outside-the-repo.txt")
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "symlinks")
        files = out_files(prepare(head_sha=git(repo, "rev-parse", "HEAD")))
        assert "Cargo.toml" not in files
        assert "services/orders-py/go.mod" not in files
        assert not [name for name, text in files.items() if "NOT-FROM-THE" in text]

    def test_a_symlinked_directory_is_not_descended(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path
    ) -> None:
        outside = tmp_path / "elsewhere"
        outside.mkdir()
        (outside / "pom.xml").write_text("NOT-FROM-THE-REPOSITORY")
        repo = tmp_path / "origin"
        (repo / "linked").symlink_to(outside, target_is_directory=True)
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "linked dir")
        files = out_files(prepare(head_sha=git(repo, "rev-parse", "HEAD")))
        assert "linked/pom.xml" not in files

    def test_it_covers_the_build_systems_the_demo_target_uses(self) -> None:
        # `orders-api` is C++, Go, Node, PHP, Python and Rust. A build system
        # missing from this set reads downstream as "no test suite found", which
        # skips every check and posts that as the entire review.
        for name in ("CMakeLists.txt", "go.mod", "package.json", "composer.json", "Cargo.toml"):
            assert name in PREPARE_FILES

    def test_a_sha_that_is_not_a_commit_id_is_refused_before_git_runs(
        self, prepare: Callable[..., dict[str, object]]
    ) -> None:
        out = prepare(head_sha="--upload-pack=touch /tmp/pwned")
        assert out["ok"] is False
        assert out["steps"] == []

    def test_a_sha_that_does_not_exist_fails_with_the_step_that_failed(
        self, prepare: Callable[..., dict[str, object]]
    ) -> None:
        out = prepare(base_sha="0" * 40)
        assert out["ok"] is False
        steps = out["steps"]
        assert isinstance(steps, list)
        # It gets as far as the worktree and stops there, so the report names
        # which git call went wrong rather than only that one did.
        assert len(steps) == 5
        assert [s["exit"] for s in steps[:4]] == [0, 0, 0, 0]
        assert steps[-1]["exit"] != 0
        assert "worktree" in steps[-1]["argv"]


class TestNothingUnreadableReadsAsAbsent:
    """ "I could not look" and "there is nothing there" are different answers.

    Both used to come back as silence. That is load-bearing in two places: the
    rubric reads a null policy with no error as proof the repository has none,
    and it reads an empty `files` as proof there is no test suite -- which skips
    every check and becomes the whole review.
    """

    def test_a_manifest_that_cannot_be_read_is_named_not_dropped(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path
    ) -> None:
        repo = tmp_path / "origin"
        service = repo / "services" / "orders-node"
        service.mkdir(parents=True)
        # Out of the tree, so `_read` refuses it -- the symlink guard working.
        (service / "package.json").symlink_to(tmp_path / "outside.json")
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "symlinked manifest")
        sha = git(repo, "rev-parse", "HEAD")

        out = prepare(head_sha=sha)
        assert out["ok"] is True, out
        # Refused, so its contents are not here.
        assert "services/orders-node/package.json" not in out_files(out)
        # But the fact that it exists and was not read is.
        assert "services/orders-node/package.json" in out["unreadable"]  # type: ignore[operator]

    def test_a_readable_repository_reports_nothing_unreadable(
        self, prepare: Callable[..., dict[str, object]]
    ) -> None:
        assert prepare()["unreadable"] == []

    def test_an_unreadable_policy_file_is_not_reported_as_no_policy(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path
    ) -> None:
        """A `.cujo.yml` that is a symlink out of the tree.

        `_read` refuses it, which is right. Reporting that refusal as two nulls
        would tell the rubric the repository has no policy, and the run would
        start with no `allow_hosts` and nobody the wiser.
        """
        repo = tmp_path / "origin"
        (repo / ".cujo.yml").unlink()
        (repo / ".cujo.yml").symlink_to(tmp_path / "outside.yml")
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "symlinked policy")
        base_sha = git(repo, "rev-parse", "HEAD")
        git(repo, "commit", "-qm", "head", "--allow-empty")
        head_sha = git(repo, "rev-parse", "HEAD")

        out = prepare(head_sha=head_sha, base_sha=base_sha)
        assert out["ok"] is True, out
        assert out["cujo_yml"] is None
        # `unreadable`, which the rubric must not answer by opening the path --
        # the reason it is here is that `_read` would not touch it.
        assert out["cujo_yml_status"] == "unreadable"

    def test_a_dangling_policy_symlink_is_still_not_absent(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path
    ) -> None:
        """`exists()` follows a symlink, so a dangling one answers False.

        Checking `exists()` alone would have put this case straight back into
        "the repository has no policy", which is why `is_symlink()` is asked
        first.
        """
        repo = tmp_path / "origin"
        (repo / ".cujo.yml").unlink()
        (repo / ".cujo.yml").symlink_to(repo / "nothing-here.yml")
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "dangling policy")
        base_sha = git(repo, "rev-parse", "HEAD")
        git(repo, "commit", "-qm", "head", "--allow-empty")
        head_sha = git(repo, "rev-parse", "HEAD")

        out = prepare(head_sha=head_sha, base_sha=base_sha)
        assert out["cujo_yml"] is None
        assert out["cujo_yml_status"] == "unreadable"


class TestTheReadIsBounded:
    """The cap has to bound the read itself, not only what comes back.

    `read_text()` would pull the whole file in and trim afterwards, so a
    hundred-megabyte manifest costs a hundred megabytes to discover it was too
    long. The file is written by the pull request, which makes that a lever
    rather than a curiosity.
    """

    def test_it_reads_at_most_the_budget_and_not_the_whole_file(self, tmp_path: Path) -> None:
        big = tmp_path / "Makefile"
        big.write_text("x" * (PREPARE_FILE_CHARS * 50))
        asked: list[int] = []

        real_open = Path.open

        class Spy:
            def __init__(self, handle: Any) -> None:
                self.handle = handle

            def read(self, size: int = -1) -> bytes:
                asked.append(size)
                return self.handle.read(size)  # type: ignore[no-any-return]

            def __enter__(self) -> Spy:
                return self

            def __exit__(self, *_exc: object) -> None:
                self.handle.close()

        def spy_open(self: Path, *args: Any, **kwargs: Any) -> Any:
            return Spy(real_open(self, *args, **kwargs))

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(Path, "open", spy_open)
            read = _read(big)

        assert read is not None
        text, truncated = read
        assert truncated is True
        assert len(text) == PREPARE_FILE_CHARS
        # One bounded read, and the bound is UTF-8's worst case per permitted
        # character plus the byte that tells "exactly fits" from "there is more".
        assert asked == [PREPARE_FILE_CHARS * 4 + 1]

    def test_a_file_that_exactly_fits_is_not_called_truncated(self, tmp_path: Path) -> None:
        exact = tmp_path / "Makefile"
        exact.write_text("x" * PREPARE_FILE_CHARS)
        read = _read(exact)
        assert read is not None
        assert read[1] is False

    def test_escaping_cannot_spend_more_than_the_budget(self, tmp_path: Path) -> None:
        """The cap is on what leaves, and escaping is where the size is decided.

        `\\u202e` is six characters out for one character in, so a file of
        right-to-left overrides capped before escaping would return six times
        the documented budget -- and the pull request chooses the file.
        """
        hostile = tmp_path / "Makefile"
        hostile.write_text("‮" * PREPARE_FILE_CHARS, encoding="utf-8")
        read = _read(hostile)
        assert read is not None
        text, truncated = read
        assert len(text) <= PREPARE_FILE_CHARS
        assert truncated is True
        # Whole escapes only: a half-written `\\u20` is text the file never had.
        assert text == "\\u202e" * (PREPARE_FILE_CHARS // 6)

    def test_a_kept_newline_still_costs_one_character(self, tmp_path: Path) -> None:
        """Escaping expands, but `keep` is why the common file is not penalised."""
        plain = tmp_path / "Makefile"
        plain.write_text("a\nb\tc")
        read = _read(plain)
        assert read is not None
        assert read == ("a\nb\tc", False)


class TestTheHeadComesFromThePullRef:
    """A fork's head commit is not in a clone of the base repository.

    `apps/cujo` sends the base repository's clone URL and nothing else -- the
    sandbox gets no credential, and the fork's own URL would be a second
    untrusted host at the boundary. GitHub publishes the commit on the base
    repository as `refs/pull/<n>/head`, so that is what `prepare` fetches, for
    every pull request and not only for forks.
    """

    def test_the_pull_ref_is_fetched_before_the_checkout(
        self, prepare: Callable[..., dict[str, object]]
    ) -> None:
        out = prepare()
        assert out["ok"] is True, out
        steps = out["steps"]
        assert isinstance(steps, list)
        argvs = [" ".join(s["argv"]) for s in steps]
        assert f"refs/pull/{PR_NUMBER}/head" in argvs[1]
        assert "fetch" in argvs[1]
        # And the fetch happens before anything is checked out, because the
        # checkout is what needs the object it brings.
        assert "checkout" in argvs[3]

    def test_a_commit_only_on_the_pull_ref_is_still_reviewed(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path, origin: dict[str, str]
    ) -> None:
        """The fork case, without a fork.

        A commit reachable from no branch is exactly the shape a fork's head has
        from the base repository's point of view: the object is published on the
        pull ref and on nothing else. If `prepare` still checks it out, the fork
        path works for the same reason.
        """
        repo = tmp_path / "origin"
        (repo / "pyproject.toml").write_text(
            '[project]\nname = "demo"\ndependencies = ["only-here"]\n'
        )
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "fork head")
        forked = git(repo, "rev-parse", "HEAD")
        # Put the branch back, so the commit is reachable from the pull ref only.
        git(repo, "reset", "-q", "--hard", origin["head_sha"])

        out = prepare(head_sha=forked, pr_ref=forked)
        assert out["ok"] is True, out
        assert "only-here" in out_files(out)["pyproject.toml"]

    def test_a_ref_that_moved_under_the_run_is_refused(
        self, prepare: Callable[..., dict[str, object]], origin: dict[str, str]
    ) -> None:
        """Someone pushed between the webhook and the clone.

        Reviewing the newer commit would attach every finding to a SHA the run
        does not claim. `supersede` handles a new push properly, so this refuses
        rather than quietly reviewing something else.
        """
        out = prepare(pr_ref=origin["base_sha"])
        assert out["ok"] is False
        error = str(out["error"])
        # Both SHAs, so the reader can tell which one moved.
        assert origin["base_sha"][:12] in error
        assert origin["head_sha"][:12] in error

    def test_a_missing_pull_ref_is_a_diagnosable_step(
        self, prepare: Callable[..., dict[str, object]]
    ) -> None:
        out = prepare(pr_number=999)
        assert out["ok"] is False
        steps = out["steps"]
        assert isinstance(steps, list)
        assert "fetch" in steps[-1]["argv"]
        assert steps[-1]["exit"] != 0

    def test_a_pr_number_that_is_not_one_is_refused_before_git_runs(
        self, prepare: Callable[..., dict[str, object]]
    ) -> None:
        out = prepare(pr_number=0)
        assert out["ok"] is False
        assert out["steps"] == []


class TestItReplacesOnlyItsOwnCheckouts:
    """`prepare` used to `rmtree` whatever it was pointed at.

    The paths come in on argv, argv is composed by the model, and the model has
    just read a pull request. "The caller would not do that" is a fact about
    today's prompt, not a property of this command.
    """

    def test_an_absent_path_is_replaceable(self, tmp_path: Path) -> None:
        assert _replaceable(tmp_path / "nothing-here") is None

    def test_a_path_this_command_claimed_is_replaceable(self, tmp_path: Path) -> None:
        ours = tmp_path / "head"
        (ours / ".git").mkdir(parents=True)
        _claim(ours).write_text("")
        assert _replaceable(ours) is None

    def test_an_unrelated_git_checkout_is_not(self, tmp_path: Path) -> None:
        """Ownership is the marker, not the `.git`.

        The first version of this guard asked whether the directory held a
        `.git`, which is true of every checkout on the machine. That enforced
        "never delete a directory that is not a git repository" while the
        docstring claimed "never delete a directory it did not create" -- a much
        weaker property wearing the stronger one's name, and `--head` is
        model-composed, so the gap between them was reachable.
        """
        theirs = tmp_path / "somebody-elses-repo"
        (theirs / ".git").mkdir(parents=True)
        (theirs / "README.md").write_text("not ours")
        assert _replaceable(theirs) is not None
        assert (theirs / "README.md").is_file()

    def test_a_worktree_whose_git_is_a_file_is_replaceable_when_claimed(
        self, tmp_path: Path
    ) -> None:
        """`git worktree add` writes `.git` as a file, not a directory.

        The marker is a sibling for the same reason: both git commands want a
        target that does not exist yet, so a marker inside the directory could
        not be written until after the thing it is meant to authorise.
        """
        ours = tmp_path / "base"
        ours.mkdir()
        (ours / ".git").write_text("gitdir: /work/head/.git/worktrees/base\n")
        _claim(ours).write_text("")
        assert _replaceable(ours) is None

    def test_somebody_elses_directory_is_not(self, tmp_path: Path) -> None:
        theirs = tmp_path / "home"
        theirs.mkdir()
        (theirs / "notes.txt").write_text("mine")
        assert _replaceable(theirs) is not None
        # And it is still there afterwards, which is the whole point.
        assert (theirs / "notes.txt").is_file()

    def test_a_symlink_is_not(self, tmp_path: Path) -> None:
        target = tmp_path / "elsewhere"
        (target / ".git").mkdir(parents=True)
        link = tmp_path / "head"
        link.symlink_to(target)
        assert _replaceable(link) is not None

    def test_a_file_is_not(self, tmp_path: Path) -> None:
        f = tmp_path / "head"
        f.write_text("x")
        assert _replaceable(f) is not None

    def test_prepare_refuses_rather_than_deleting_and_runs_no_git(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path
    ) -> None:
        precious = tmp_path / "precious"
        precious.mkdir()
        (precious / "keep.txt").write_text("do not delete me")
        out = prepare(head=str(precious))
        assert out["ok"] is False
        assert out["steps"] == []
        assert (precious / "keep.txt").read_text() == "do not delete me"

    def test_the_same_path_twice_is_refused(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path
    ) -> None:
        both = str(tmp_path / "work" / "same")
        out = prepare(head=both, base=both)
        assert out["ok"] is False
        assert out["steps"] == []


class TestThePolicyFileIsNeverPartial:
    """`.cujo.yml` decides `allow_hosts`, and it comes from base for that reason.

    It used to share the `truncated` list with the head's build files, and the
    rubric tells the model to re-read anything in that list from `/work/head` --
    which would have let a pull request supply its own policy by making the base
    copy long enough to cap.
    """

    def test_a_normal_policy_file_comes_back_with_no_error(
        self, prepare: Callable[..., dict[str, object]]
    ) -> None:
        out = prepare()
        assert "api.example" in str(out["cujo_yml"])
        assert out["cujo_yml_status"] == "read"
        assert ".cujo.yml" not in out["truncated"]  # type: ignore[operator]

    def test_a_policy_file_past_the_build_file_cap_still_comes_back_whole(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path
    ) -> None:
        """The budget is the policy file's own, and it is much larger.

        A `.cujo.yml` of eight thousand characters is unusual but not absurd,
        and it is well past `PREPARE_FILE_CHARS`. Reading it under the build
        files' cap would have cut it in half, which for this one file means
        losing the allowlist and not merely losing detail.
        """
        assert PREPARE_POLICY_CHARS > PREPARE_FILE_CHARS * 2
        repo = tmp_path / "origin"
        filler = "\n".join(f"# note {i}" for i in range(PREPARE_FILE_CHARS // 4))
        assert PREPARE_FILE_CHARS < len(filler) < PREPARE_POLICY_CHARS
        (repo / ".cujo.yml").write_text(
            f"test: pytest -q\n{filler}\nallow_hosts:\n  - api.example\n"
        )
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "big but reasonable policy")
        base_sha = git(repo, "rev-parse", "HEAD")
        git(repo, "commit", "-qm", "head", "--allow-empty")
        head_sha = git(repo, "rev-parse", "HEAD")

        out = prepare(head_sha=head_sha, base_sha=base_sha)
        assert out["ok"] is True, out
        assert out["cujo_yml_status"] == "read"
        # The last line, which is the one the build files' cap would have lost.
        assert "api.example" in str(out["cujo_yml"])

    def test_an_oversized_policy_file_is_unreadable_and_not_partial(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path
    ) -> None:
        repo = tmp_path / "origin"
        # Long enough to cap, with the allowlist past the cap -- which is the
        # case that matters: reading the first half would find `test:` and miss
        # the hosts entirely.
        padding = "\n".join(f"# filler {i}" for i in range(PREPARE_POLICY_CHARS // 4))
        (repo / ".cujo.yml").write_text(
            f"test: pytest -q\n{padding}\nallow_hosts:\n  - api.example\n"
        )
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "long policy")
        base_sha = git(repo, "rev-parse", "HEAD")
        git(repo, "commit", "-qm", "head", "--allow-empty")
        head_sha = git(repo, "rev-parse", "HEAD")

        out = prepare(head_sha=head_sha, base_sha=base_sha)
        assert out["ok"] is True, out
        # Not half of it. Half a policy is worse than none, because the half
        # that did not fit may be the allowlist.
        assert out["cujo_yml"] is None
        # `too_large` and not `unreadable`: it is a real file inside the base
        # checkout, so the parent may safely open it itself.
        assert out["cujo_yml_status"] == "too_large"
        # And never routed through the list that says "re-read from head".
        assert ".cujo.yml" not in out["truncated"]  # type: ignore[operator]

    def test_a_repository_with_no_policy_file_has_no_error_either(
        self, prepare: Callable[..., dict[str, object]], tmp_path: Path
    ) -> None:
        """Absent and unreadable are different facts, and read differently."""
        repo = tmp_path / "origin"
        (repo / ".cujo.yml").unlink()
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "drop policy")
        base_sha = git(repo, "rev-parse", "HEAD")
        git(repo, "commit", "-qm", "head", "--allow-empty")
        head_sha = git(repo, "rev-parse", "HEAD")

        out = prepare(head_sha=head_sha, base_sha=base_sha)
        assert out["cujo_yml"] is None
        assert out["cujo_yml_status"] == "absent"


def out_files(out: dict[str, object]) -> dict[str, str]:
    files = out["files"]
    assert isinstance(files, dict)
    return files
