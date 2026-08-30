"""The mechanical half of setup: clone, worktree, and read what decides the rest.

Four rubric steps that have no decision in them — clone the head, check it out,
add the base worktree, read `.cujo.yml` and the build files — were four separate
commands, and therefore four model round trips, because the rubric numbered them
separately. Nothing in any of them depends on what the model made of the one
before, so they are one command here (decision 71).

**It does not parse `.cujo.yml`.** Nothing under `sandbox/` may import a
third-party module (decision 46), and hand-rolling a YAML reader to save one
round trip is a bad trade. The raw text goes back and the model still decides
its own `--allow-host` list, so `setup` is unchanged and the floor stays two
commands: this, then `setup`.

Everything it reads is written by the pull request, so every byte comes back
through `scrub` and a length cap, exactly as a check report's does.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from cujo_sniff.context import Context
from cujo_sniff.policy import (
    PREPARE_FILE_CHARS,
    PREPARE_FILES,
    PREPARE_GIT_TIMEOUT_S,
    PREPARE_MAX_DEPTH,
    PREPARE_MAX_FILES,
    PREPARE_POLICY_CHARS,
    PREPARE_SKIP_DIRS,
    SCHEMA_VERSION,
    WORKFLOW_DIR,
)
from cujo_sniff.scrub import KEEP_IN_TEXT, scrub, scrub_head, scrub_tail

#: A full commit SHA, or an abbreviation long enough for git to resolve.
_SHA = re.compile(r"[0-9a-fA-F]{7,40}")

#: Hosts a clone may come from.
#:
#: The URL is supposed to arrive from `apps/cujo`, which reads it from the
#: GitHub API — but it reaches this command through a turn message that also
#: carries the pull request's own title and body, and the model composes the
#: argv. So "it comes from the API" describes where it starts, not where it has
#: to have come from, and a pull request that talks the model into a different
#: `--clone-url` would have this box clone and report on somebody else's code.
#:
#: `api.github.com` is hardcoded on the trusted side (`clients/github.ts`), so
#: naming the same host here narrows nothing that works today. It is a list
#: because a GitHub Enterprise deployment would add to it, and that day the
#: trusted side has to change too.
CLONE_HOSTS = frozenset({"github.com", "www.github.com"})


#: `owner/name`, the way GitHub spells a repository.
_REPO = re.compile(r"[A-Za-z0-9._-]+/[A-Za-z0-9._-]+")


def check_clone_url(url: str, repo: str) -> str | None:
    """Why this URL may not be cloned, or None when it may.

    The trust boundary says no token, key or clone credential may ever reach
    the sandbox, and until now nothing enforced it — the rule lived in
    `AGENTS.md` and in the fact that private repositories are a non-goal, so no
    credential existed to leak. That is an argument about today's callers, not
    a property of this box. A URL carrying `user:token@` is refused here, so the
    day something upstream starts minting clone URLs the refusal is already in
    the code path rather than in a paragraph.

    Scheme first, and only `http`/`https`: it rejects `ssh://` and the scp-like
    `git@host:path` (which parses with no scheme at all) for the same reason,
    and it also means the URL can never begin with `-` and be read by git as an
    option.

    **Userinfo is not the only place a credential rides.** A query string
    carries them too — `https://host/repo?token=…` is how every signed URL is
    spelled — and a fragment can hide one from a careless reader. A public clone
    URL needs neither, so both are refused rather than inspected: deciding which
    query parameters are secret is a guessing game, and having no query at all
    is a property that can simply be required.
    """
    try:
        parts = urlsplit(url)
    except ValueError:
        # `http://[` and anything else with a malformed authority. Uncaught this
        # reached the CLI's error envelope, which answers with a traceback and
        # no `steps` -- a different shape for the same event, on the one path
        # where a caller is most likely to be reading the refusal rather than
        # the exception. It is a refusal like every other branch here.
        #
        # (The exception itself says only "Invalid IPv6 URL" and carries no part
        # of the URL, so nothing leaked either way. The reason is the shape.)
        return "clone url could not be parsed"
    if parts.scheme not in ("http", "https"):
        return f"clone url must be http or https, got {scrub(parts.scheme or '(none)')!r}"
    if parts.username or parts.password or "@" in parts.netloc:
        # Never echo the URL back: the thing being refused is a credential.
        return "clone url carries credentials, which may not enter the sandbox"
    if parts.query or parts.fragment:
        return "clone url carries a query or fragment, which may hold a credential"
    if not parts.netloc:
        return "clone url has no host"
    if parts.hostname not in CLONE_HOSTS:
        return f"clone url host is not one Cujo reviews: {scrub(parts.hostname or '(none)')!r}"
    # The host alone was not enough. Every public repository on GitHub shares it,
    # so a pull request that talked the model into a different `--clone-url`
    # could still have this box clone and report on somebody else's code, under
    # this pull request's name. The path has to name the repository the run is
    # for. Case-insensitively, because GitHub resolves owners and names that way
    # and the two spellings are the same repository.
    wanted = repo.strip("/").removesuffix(".git").lower()
    got = parts.path.strip("/").removesuffix(".git").lower()
    if got != wanted:
        return f"clone url is not the repository under review: {scrub(parts.path)!r}"
    return None


def _git(argv: list[str], redact: str = "") -> tuple[dict[str, Any], str]:
    """One git invocation: the step to record, and what it printed.

    `redact` is replaced wherever it appears in the recorded argv. The URL check
    above should already have refused anything secret, so this is the second
    line and not the first: a refusal that is bypassed should not also publish
    what it failed to refuse, and `steps[]` goes back to the model verbatim.

    A timeout, because a stalled remote otherwise blocks the whole run with no
    JSON at all — the one outcome the rubric cannot report. 124 is the exit code
    `timeout(1)` uses for this, and the step says so in its stderr.

    Standard output comes back beside the step rather than inside it. Only
    `rev-parse` has any, it is a commit id this function's caller compares
    against one it already holds, and putting it in the step would widen what
    `steps[]` promises for the sake of one internal read.
    """
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=PREPARE_GIT_TIMEOUT_S,
        )
        exit_code, out, err = proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        exit_code, out, err = 124, "", f"git timed out after {PREPARE_GIT_TIMEOUT_S:.0f}s"
    except FileNotFoundError as exc:
        # 127 is what `run_sensed` reports for the same condition.
        exit_code, out, err = 127, "", str(exc)
    shown = [a.replace(redact, "<clone-url>") if redact else a for a in argv]
    step = {
        "argv": [scrub(a) for a in shown],
        "exit": exit_code,
        "stderr_tail": scrub_tail(err, PREPARE_FILE_CHARS, keep=KEEP_IN_TEXT)[0],
    }
    return step, out.strip()


def _claim(path: Path) -> Path:
    """The marker recording that `prepare` owns `path`.

    A sibling rather than a file inside, because `git clone` and
    `git worktree add` both want a target that does not exist yet, so a marker
    within the directory could not be written until after the thing it is meant
    to authorise.
    """
    return path.parent / f"{path.name}.cujo-prepare"


def _replaceable(path: Path) -> str | None:
    """Why this checkout path may not be replaced, or None when it may.

    `prepare` used to `rmtree` whatever it was pointed at. The paths arrive on
    argv, argv is composed by the model, and the model has just read a pull
    request — so "the caller would not do that" is a statement about today's
    prompt rather than a property of this command. A `--head /` would have
    recursively deleted the box the sensors run on, and taken the evidence with
    it.

    The rule is that `prepare` never deletes a directory it did not create, and
    the marker is what makes that the rule rather than an approximation of it.
    The first version asked whether the directory held a `.git`, which is true
    of every checkout on the machine and not only of ours: it enforced "never
    delete a directory that is not a git repository", which is a different and
    much weaker claim than the one the docstring made. A path is ours when a
    marker this command wrote sits beside it, and otherwise it is somebody's
    data.
    """
    if not path.exists() and not path.is_symlink():
        return None
    if path.is_symlink():
        return f"{path} is a symlink; prepare replaces only its own checkouts"
    if not path.is_dir():
        return f"{path} exists and is not a directory"
    if not _claim(path).is_file():
        return f"{path} exists and was not made by prepare"
    return None


def _under(path: Path, root: Path) -> bool:
    """Is `path` a real file physically inside `root`?

    A build file's *name* is chosen by the pull request, and so is whether that
    name is a symlink. `pyproject.toml -> /etc/shadow` would otherwise be read
    and returned, which turns a manifest reader into an arbitrary-file reader
    pointed at the box the sensors run in. The walk already declines to follow
    directory symlinks (`os.walk` does not, by default); this is the file half
    of the same rule.

    Both checks, not either. Refusing symlinks alone would miss a hard link, and
    resolving alone would accept a symlink that happens to land back inside the
    tree — which is harmless today and is not a property worth depending on.
    """
    if path.is_symlink():
        return False
    try:
        return path.resolve().is_relative_to(root.resolve())
    except OSError:
        return False


def _read(
    path: Path, root: Path | None = None, limit: int = PREPARE_FILE_CHARS
) -> tuple[str, bool] | None:
    """A repository file as text, capped, or None when it may not be read.

    The head and not the tail: a manifest declares what it depends on at the
    top, which is the opposite of a command's output, where the failure is at
    the end.

    **Bounded before the read, not after it.** `read_text()` would pull the
    whole file into memory and only then cap it, so a hundred-megabyte
    `pyproject.toml` costs a hundred megabytes to discover it was too long —
    and the file is written by the pull request, which makes that a lever. At
    most four bytes per permitted character are read, which is UTF-8's maximum,
    plus one byte to tell a file that exactly fits from one that does not.
    `errors="replace"` because this is the PR's file and it is under no
    obligation to be UTF-8.

    **And bounded again after escaping**, which is why `scrub_head` does both
    at once rather than a cap and a `scrub()` in sequence: escaping expands, so
    a cap applied before it is not the cap that ships. The byte budget above
    bounds the cost of the read and this one bounds the size of the answer;
    neither substitutes for the other.
    """
    if root is not None and not _under(path, root):
        return None
    read_budget = limit * 4 + 1
    try:
        with path.open("rb") as handle:
            raw = handle.read(read_budget)
    except OSError:
        return None
    decoded = raw.decode("utf-8", errors="replace")
    text, capped = scrub_head(decoded, limit, keep=KEEP_IN_TEXT)
    # Either the escaped text overflowed the character cap, or the read stopped
    # at the byte budget with the file still going.
    return text, capped or len(raw) == read_budget


def _wanted(path: Path) -> bool:
    """A build file, or a CI workflow.

    Deliberately no lock file: a lock is hundreds of kilobytes that says nothing
    about how to run anything, and it would crowd out the files that do. The
    resolved versions it holds are the detonation check's business, and that
    check reads them from the manifest diff.
    """
    if path.name in PREPARE_FILES:
        return True
    return path.parent.name == WORKFLOW_DIR and path.suffix in (".yml", ".yaml")


def _candidates(root: Path) -> list[Path]:
    """Every build file within `PREPARE_MAX_DEPTH`, shallowest first.

    A walk and not a fixed list of root-relative names, because the repository
    this reviews need not be one project at its own root: `orders-api` holds six
    services under `services/<name>/` and has no manifest at the root at all, so
    a root-only reader would hand the model nothing and it would go back to
    opening files one at a time — which is the round trip this exists to remove.

    Sorted by depth first so that, if the cap bites, what survives is the
    shallowest and most likely to describe the repository as a whole.
    """
    found: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        here = Path(dirpath)
        depth = len(here.relative_to(root).parts)
        if depth >= PREPARE_MAX_DEPTH:
            dirnames[:] = []
        else:
            dirnames[:] = sorted(d for d in dirnames if d not in PREPARE_SKIP_DIRS)
        found += [here / name for name in sorted(filenames) if _wanted(here / name)]
    return sorted(found, key=lambda p: (len(p.relative_to(root).parts), str(p)))


def _collect(root: Path) -> tuple[dict[str, str], list[str], list[str], int]:
    """The build files a `test`, `install` or `boot` command can be inferred from.

    Returns what was read, what came back capped, what could not be read at all,
    and how many the file cap dropped. The third of those is the one that was
    missing: a manifest refused for being a symlink, or unreadable for any other
    reason, used to vanish from the result entirely. Downstream that is
    indistinguishable from a repository that does not have the file — and "no
    test suite found" skips every check and becomes the whole review, so the
    difference between "there is none" and "I could not look" decides whether a
    real suite is silently not run.
    """
    files: dict[str, str] = {}
    truncated: list[str] = []
    unreadable: list[str] = []
    candidates = _candidates(root)
    for path in candidates[:PREPARE_MAX_FILES]:
        name = str(path.relative_to(root))
        read = _read(path, root)
        if read is None:
            unreadable.append(name)
            continue
        files[name], was_capped = read
        if was_capped:
            truncated.append(name)
    return files, truncated, unreadable, max(0, len(candidates) - PREPARE_MAX_FILES)


def _same_commit(fetched: str, claimed: str) -> bool:
    """Do these two name the same commit?

    `--head-sha` is whatever the webhook carried and `_SHA` admits an
    abbreviation, while `rev-parse` always answers in full, so this is a prefix
    comparison in whichever direction is the shorter. Case-folded because git
    accepts either and the two sources are not the same program.
    """
    a, b = fetched.strip().lower(), claimed.strip().lower()
    if not a or not b:
        return False
    return a.startswith(b) or b.startswith(a)


#: Where the fetched pull ref is parked inside the clone.
_PR_REF = "refs/cujo/pr"


def cmd_prepare(_ctx: Context, args: argparse.Namespace) -> dict[str, Any]:
    head = Path(args.head)
    base = Path(args.base)
    steps: list[dict[str, Any]] = []

    def fail(error: str) -> dict[str, Any]:
        return {"schema_version": SCHEMA_VERSION, "ok": False, "error": error, "steps": steps}

    if not _REPO.fullmatch(args.repo):
        return fail(f"repo is not an owner/name: {scrub(args.repo)!r}")
    refused = check_clone_url(args.clone_url, args.repo)
    if refused:
        return fail(refused)
    for label, sha in (("head", args.head_sha), ("base", args.base_sha)):
        if not _SHA.fullmatch(sha):
            return fail(f"{label} sha is not a commit id: {scrub(sha)!r}")
    if args.pr_number <= 0:
        return fail(f"pr number is not a pull request: {args.pr_number}")
    if head == base:
        return fail("head and base must be different directories")

    # Replaced rather than reused, for the reason the rubric's fetch is one
    # `&&` chain: a leftover tree from a previous attempt would be indexed as
    # this run's code and nothing downstream could tell. Both go, and in this
    # order — `base` is a worktree registered inside `head`, so removing `head`
    # second leaves no registration pointing at a directory that is gone.
    #
    # Only ever a checkout this command made, though. See `_replaceable`.
    for path in (base, head):
        blocked = _replaceable(path)
        if blocked:
            return fail(blocked)
    head.parent.mkdir(parents=True, exist_ok=True)
    base.parent.mkdir(parents=True, exist_ok=True)
    # Claimed before anything is removed and before git runs, so a run that dies
    # in the middle leaves a state the next run can still recognise as its own.
    for path in (base, head):
        _claim(path).write_text("")
    shutil.rmtree(base, ignore_errors=True)
    shutil.rmtree(head, ignore_errors=True)

    # The head commit is fetched by pull ref rather than assumed to be in the
    # clone. `apps/cujo` sends the *base* repository's clone URL and nothing
    # else — the sandbox gets no credential, and a fork's own clone URL would be
    # a second untrusted host in the crossings table — so a pull request opened
    # from a fork has its head commit in a repository this clone never saw.
    # GitHub publishes that commit on the base repository as
    # `refs/pull/<n>/head`, which is public and needs no token.
    #
    # Always, and not as a fallback when the checkout fails. The ref exists for
    # a same-repository pull request too, so one path serves both and the fork
    # case is exercised by every run rather than only by the runs least likely
    # to be watched.
    fetch = f"+refs/pull/{args.pr_number}/head:{_PR_REF}"
    for argv in (
        ["git", "clone", args.clone_url, str(head)],
        ["git", "-C", str(head), "fetch", "--quiet", "origin", fetch],
    ):
        step, _ = _git(argv, redact=args.clone_url)
        steps.append(step)
        if step["exit"] != 0:
            return fail(f"{argv[0]} {argv[1]} failed with exit {step['exit']}")

    # What the ref points at now, against what the run was started for. The two
    # differ when somebody pushed between the webhook and this clone, and
    # reviewing the newer commit would attach every finding to a SHA the run
    # does not claim. `supersede` handles a new push properly; this refuses so
    # that it can.
    step, fetched = _git(["git", "-C", str(head), "rev-parse", _PR_REF])
    steps.append(step)
    if step["exit"] != 0:
        return fail(f"git rev-parse failed with exit {step['exit']}")
    if not _same_commit(fetched, args.head_sha):
        return fail(
            f"refs/pull/{args.pr_number}/head is at {scrub(fetched)}, "
            f"but this run is for {scrub(args.head_sha)}"
        )

    for argv in (
        ["git", "-C", str(head), "checkout", "--detach", args.head_sha],
        ["git", "-C", str(head), "worktree", "add", "--detach", str(base), args.base_sha],
    ):
        step, _ = _git(argv, redact=args.clone_url)
        steps.append(step)
        if step["exit"] != 0:
            return fail(f"{argv[0]} {argv[1]} failed with exit {step['exit']}")

    # Policy comes from base and never from head, so a pull request cannot
    # allowlist its own exfiltration host (spec Contract 2). It has its own,
    # larger budget and is deliberately *not* in `truncated`: that list tells
    # the model which files to re-read from `/work/head`, and routing the policy
    # file through that sentence would hand the pull request the allowlist. Over
    # the budget it is unreadable rather than partial.
    policy_path = base / ".cujo.yml"
    policy = _read(policy_path, base, limit=PREPARE_POLICY_CHARS)
    cujo_yml, cujo_yml_status = None, "absent"
    if policy is not None and policy[1]:
        # A real file inside the base checkout, just longer than the budget. The
        # parent may open it itself; there is nothing unsafe about the path.
        cujo_yml_status = "too_large"
    elif policy is not None:
        cujo_yml, cujo_yml_status = policy[0], "read"
    elif policy_path.is_symlink() or policy_path.exists():
        # `_read` says None for a path it would not touch and for a path that
        # would not open, and those are not the same as "there is no policy
        # file". The rubric reads two nulls as proof the repository has none, so
        # collapsing the three would let an unreadable `.cujo.yml` -- a symlink,
        # a permission, a directory of that name -- start a run with no
        # `allow_hosts` and nobody told. `is_symlink()` first, because `exists()`
        # follows one and a dangling link is exactly this case.
        # Refused, or it would not open. **Not** something to go and read
        # around: the reason it is here is that `_read` would not touch it --
        # a symlink out of the checkout, most likely -- so telling the parent to
        # open it directly would walk straight around the containment guard and
        # hand a pull request the policy file's contents from wherever it
        # pointed.
        cujo_yml_status = "unreadable"

    # The build files come from head, because they are what the checks will run.
    files, truncated, unreadable, omitted = _collect(head)

    return {
        "schema_version": SCHEMA_VERSION,
        "ok": True,
        "head": str(head),
        "base": str(base),
        "cujo_yml": cujo_yml,
        # Why `cujo_yml` is what it is: "read", "absent", "too_large", or
        # "unreadable". Four outcomes and not one nullable string, because the
        # rubric has to act differently on each and a sentence is not something
        # it can branch on. Decision 54: absence is a fact, and these absences
        # are not the same fact.
        "cujo_yml_status": cujo_yml_status,
        "files": files,
        # Named rather than counted, so the model knows which file it is
        # reasoning about half of (decision 54's rule: say what you could not
        # observe).
        "truncated": truncated,
        # Build files that matched but could not be read -- a symlink out of the
        # tree, a permission, an I/O error. Named and not counted, because the
        # parent can go and look at these itself, and because a manifest that
        # silently disappeared is how a repository with tests gets reviewed as a
        # repository without any.
        "unreadable": unreadable,
        # How many build files the cap dropped. Counted and not named: they were
        # never read, so there is nothing to say about them beyond that they
        # exist and this is not the whole picture.
        "omitted": omitted,
        "steps": steps,
    }
