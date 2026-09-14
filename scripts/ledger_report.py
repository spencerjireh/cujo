#!/usr/bin/env python3
"""Read Cujo's token ledger across runs.

Every run's projection carries a ledger (decision 141): tokens per thread, and a
check's thread is titled by the check's name. That makes "what does each check
cost" a question the database can already answer; this script asks it across
many runs at once, which nothing else does.

It reads the SQLite file directly. The read API answers only on the compose
network, and the board proxies only the event stream. Copy the file out first:

    docker compose cp cujo:/data/cujo.db ./cujo.db
    uv run scripts/ledger_report.py --db ./cujo.db --out ./ledger

Cujo itself keeps no price table (decision 53's spirit). A price is a
command-line argument here, per model, in dollars per million tokens:

    --price openrouter/glm=0.20,1.10,0.05,0.20

is input, output, cache read, cache write. Reasoning tokens are billed as output
by every provider this repo has used, so they are priced as output. A thread on
a run whose model has no price gets no dollars, not zero.

Output is two CSV files, ``runs.csv`` and ``threads.csv``, and a per-check summary
on stderr, which is the table a findings file wants.
"""

from __future__ import annotations

import argparse
import csv
import json
import sqlite3
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO

TOKEN_KINDS = ("inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens")
SEVERITIES = ("critical", "warn", "info")

RUN_COLUMNS = [
    "run_id",
    "repo",
    "pr_number",
    "head_sha",
    "status",
    "mode",
    "model",
    "budget_tokens",
    "created_at",
    "run_ms",
    "checks_ms",
    "messages",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "total_tokens",
    "cost_usd",
    "priced_usd",
    "findings_critical",
    "findings_warn",
    "findings_info",
]

THREAD_COLUMNS = [
    "run_id",
    "repo",
    "pr_number",
    "mode",
    "model",
    "thread",
    "attempt",
    "messages",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "reasoning_tokens",
    "total_tokens",
    "tool_result_bytes",
    "priced_usd",
    "findings_critical",
    "findings_warn",
    "findings_info",
]


@dataclass(frozen=True)
class Price:
    """Dollars per million tokens, by kind."""

    input: float
    output: float
    cache_read: float
    cache_write: float

    def of(self, thread: dict[str, Any]) -> float:
        # Reasoning is output for billing purposes; see the module docstring.
        output = _int(thread.get("outputTokens")) + _int(thread.get("reasoningTokens"))
        return (
            _int(thread.get("inputTokens")) * self.input
            + output * self.output
            + _int(thread.get("cacheReadTokens")) * self.cache_read
            + _int(thread.get("cacheWriteTokens")) * self.cache_write
        ) / 1_000_000


def parse_price(spec: str) -> tuple[str, Price]:
    """``model=in,out,cache_read,cache_write``; the last two default to zero."""
    model, sep, numbers = spec.partition("=")
    if not sep or not model:
        raise argparse.ArgumentTypeError(
            f"expected <model>=<in>,<out>[,<cache_read>,<cache_write>], got {spec!r}"
        )
    parts = [p.strip() for p in numbers.split(",")]
    if len(parts) < 2 or len(parts) > 4:
        raise argparse.ArgumentTypeError(f"expected two to four numbers after '=' in {spec!r}")
    try:
        values = [float(p) for p in parts] + [0.0] * (4 - len(parts))
    except ValueError as err:
        raise argparse.ArgumentTypeError(f"not a number in {spec!r}") from err
    return model.strip(), Price(*values)


def _int(value: Any) -> int:
    return int(value) if isinstance(value, (int, float)) else 0


def _ms_between(start: str | None, end: str | None) -> int | None:
    if not start or not end:
        return None
    from datetime import datetime

    try:
        a = datetime.fromisoformat(start.replace("Z", "+00:00"))
        b = datetime.fromisoformat(end.replace("Z", "+00:00"))
    except ValueError:
        return None
    return int((b - a).total_seconds() * 1000)


def _checks_span_ms(checks: list[dict[str, Any]]) -> int | None:
    starts = [c.get("startedAt") for c in checks if c.get("startedAt")]
    ends = [c.get("endedAt") for c in checks if c.get("endedAt")]
    if not starts or not ends:
        return None
    return _ms_between(min(starts), max(ends))


def _findings_by_check(findings: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for finding in findings:
        check = str(finding.get("check") or "")
        severity = str(finding.get("severity") or "")
        if severity not in SEVERITIES:
            continue
        out.setdefault(check, dict.fromkeys(SEVERITIES, 0))[severity] += 1
    return out


def _total(thread: dict[str, Any]) -> int:
    return sum(_int(thread.get(kind)) for kind in TOKEN_KINDS) + _int(thread.get("reasoningTokens"))


def load_runs(
    db_path: Path, *, since: str | None = None, repo: str | None = None
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """Every run with a projection, newest first, as ``(row, projection)``."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    where = []
    params: list[Any] = []
    if since:
        where.append("runs.created_at >= ?")
        params.append(since)
    if repo:
        where.append("runs.repo = ?")
        params.append(repo)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    rows = conn.execute(
        "SELECT runs.*, p.projection AS projection FROM runs "
        "JOIN run_projections p ON p.run_id = runs.id "
        f"{clause} ORDER BY runs.created_at DESC",
        params,
    ).fetchall()
    conn.close()
    out = []
    for row in rows:
        record = dict(row)
        try:
            projection = json.loads(record.pop("projection"))
        except (TypeError, ValueError):
            continue
        if isinstance(projection, dict):
            out.append((record, projection))
    return out


def report(
    runs: list[tuple[dict[str, Any], dict[str, Any]]],
    prices: dict[str, Price],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The two tables, one row per run and one per thread."""
    run_rows: list[dict[str, Any]] = []
    thread_rows: list[dict[str, Any]] = []
    for record, projection in runs:
        model = record.get("model") or ""
        price = prices.get(model)
        usage = projection.get("usage") or {}
        ledger = projection.get("ledger") or {}
        threads = [t for t in ledger.get("threads") or [] if isinstance(t, dict)]
        checks = [c for c in projection.get("checks") or [] if isinstance(c, dict)]
        findings = [f for f in projection.get("findings") or [] if isinstance(f, dict)]
        by_check = _findings_by_check(findings)
        totals = dict.fromkeys(SEVERITIES, 0)
        for counts in by_check.values():
            for severity in SEVERITIES:
                totals[severity] += counts[severity]

        priced_run = 0.0 if price else None
        for thread in threads:
            title = str(thread.get("title") or "")
            counts = by_check.get(title, dict.fromkeys(SEVERITIES, 0))
            priced = price.of(thread) if price else None
            if price and priced_run is not None and priced is not None:
                priced_run += priced
            thread_rows.append(
                {
                    "run_id": record["id"],
                    "repo": record["repo"],
                    "pr_number": record["pr_number"],
                    "mode": record.get("mode") or "",
                    "model": model,
                    "thread": title,
                    "attempt": _int(thread.get("attempt")) or 1,
                    "messages": _int(thread.get("messages")),
                    "input_tokens": _int(thread.get("inputTokens")),
                    "output_tokens": _int(thread.get("outputTokens")),
                    "cache_read_tokens": _int(thread.get("cacheReadTokens")),
                    "cache_write_tokens": _int(thread.get("cacheWriteTokens")),
                    "reasoning_tokens": _int(thread.get("reasoningTokens")),
                    "total_tokens": _total(thread),
                    "tool_result_bytes": _int(thread.get("toolResultBytes")),
                    "priced_usd": _round(priced),
                    "findings_critical": counts["critical"],
                    "findings_warn": counts["warn"],
                    "findings_info": counts["info"],
                }
            )

        run_rows.append(
            {
                "run_id": record["id"],
                "repo": record["repo"],
                "pr_number": record["pr_number"],
                "head_sha": record["head_sha"],
                "status": record["status"],
                "mode": record.get("mode") or "",
                "model": model,
                "budget_tokens": record.get("budget_tokens") or "",
                "created_at": record["created_at"],
                "run_ms": _ms_between(record.get("created_at"), record.get("updated_at")),
                "checks_ms": _checks_span_ms(checks),
                "messages": _int(usage.get("messages")),
                "input_tokens": _int(usage.get("inputTokens")),
                "output_tokens": _int(usage.get("outputTokens")),
                "cache_read_tokens": _int(usage.get("cacheReadTokens")),
                "cache_write_tokens": _int(usage.get("cacheWriteTokens")),
                "reasoning_tokens": _int(usage.get("reasoningTokens")),
                "total_tokens": _total(usage),
                "cost_usd": _round(usage.get("costUsd")),
                "priced_usd": _round(priced_run),
                "findings_critical": totals["critical"],
                "findings_warn": totals["warn"],
                "findings_info": totals["info"],
            }
        )
    return run_rows, thread_rows


def _round(value: Any) -> str:
    if not isinstance(value, (int, float)):
        return ""
    return f"{value:.4f}"


def _percentile(values: list[int], q: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[index]


def summary(run_rows: list[dict[str, Any]], thread_rows: list[dict[str, Any]], out: TextIO) -> None:
    """Per check, across runs: how often it ran, what it cost, what it found."""
    grand = sum(int(r["total_tokens"]) for r in thread_rows) or 1
    by_thread: dict[str, list[dict[str, Any]]] = {}
    for row in thread_rows:
        by_thread.setdefault(str(row["thread"]), []).append(row)
    n_runs = len(run_rows) or 1
    print(f"runs: {len(run_rows)}", file=out)
    priced = [float(r["priced_usd"]) for r in run_rows if r["priced_usd"]]
    reported = [float(r["cost_usd"]) for r in run_rows if r["cost_usd"]]
    if reported:
        print(
            f"cost_usd per run (harness estimate): median {statistics.median(reported):.4f}, "
            f"p90 {_percentile_f(reported, 0.9):.4f}, n {len(reported)}",
            file=out,
        )
    if priced:
        print(
            f"priced_usd per run (--price): median {statistics.median(priced):.4f}, "
            f"p90 {_percentile_f(priced, 0.9):.4f}, n {len(priced)}",
            file=out,
        )
    print(
        f"{'thread':<12} {'runs':>5} {'median':>9} {'p90':>9} {'share':>6} "
        f"{'crit/run':>9} {'warn/run':>9} {'info/run':>9}",
        file=out,
    )
    for title in sorted(by_thread, key=lambda t: (t != "main", t)):
        rows = by_thread[title]
        tokens = [int(r["total_tokens"]) for r in rows]
        share = sum(tokens) / grand
        runs_seen = len({r["run_id"] for r in rows})
        crit = sum(int(r["findings_critical"]) for r in rows) / n_runs
        warn = sum(int(r["findings_warn"]) for r in rows) / n_runs
        info = sum(int(r["findings_info"]) for r in rows) / n_runs
        print(
            f"{title:<12} {runs_seen:>5} {int(statistics.median(tokens)):>9} "
            f"{_percentile(tokens, 0.9):>9} {share:>6.1%} {crit:>9.2f} {warn:>9.2f} {info:>9.2f}",
            file=out,
        )


def _percentile_f(values: list[float], q: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[index]


def write_csv(rows: list[dict[str, Any]], columns: list[str], out: TextIO) -> None:
    writer = csv.DictWriter(out, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({c: ("" if row.get(c) is None else row.get(c)) for c in columns})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--db", required=True, type=Path, help="path to a copy of cujo.db")
    parser.add_argument("--since", help="ISO date; runs created before it are skipped")
    parser.add_argument("--repo", help="owner/name; other repositories are skipped")
    parser.add_argument(
        "--price",
        action="append",
        default=[],
        type=parse_price,
        metavar="MODEL=IN,OUT[,CACHE_READ,CACHE_WRITE]",
        help="dollars per million tokens for a model, repeatable",
    )
    parser.add_argument(
        "--out", type=Path, help="directory for runs.csv and threads.csv; stdout when unset"
    )
    args = parser.parse_args(argv)

    if not args.db.is_file():
        parser.error(f"--db: no such file: {args.db}")
    runs = load_runs(args.db, since=args.since, repo=args.repo)
    run_rows, thread_rows = report(runs, dict(args.price))
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        with (args.out / "runs.csv").open("w", encoding="utf8") as fh:
            write_csv(run_rows, RUN_COLUMNS, fh)
        with (args.out / "threads.csv").open("w", encoding="utf8") as fh:
            write_csv(thread_rows, THREAD_COLUMNS, fh)
    else:
        write_csv(run_rows, RUN_COLUMNS, sys.stdout)
        print(file=sys.stdout)
        write_csv(thread_rows, THREAD_COLUMNS, sys.stdout)
    summary(run_rows, thread_rows, sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
