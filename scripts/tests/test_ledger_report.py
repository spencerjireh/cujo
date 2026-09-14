"""The ledger report reads what the fold wrote, and prices only what it was told to."""

from __future__ import annotations

import io
import json
import sqlite3
from pathlib import Path

import pytest

import ledger_report
from ledger_report import Price, load_runs, parse_price, report, summary


def _projection(*, threads, findings, usage, checks=()):
    return {
        "status": "clean",
        "usage": usage,
        "ledger": {"threads": threads, "largestToolResults": []},
        "checks": list(checks),
        "findings": findings,
    }


def _thread(title, inp, out, cache_read=0, cache_write=0, reasoning=None, attempt=1):
    row = {
        "title": title,
        "attempt": attempt,
        "messages": 3,
        "inputTokens": inp,
        "outputTokens": out,
        "cacheReadTokens": cache_read,
        "cacheWriteTokens": cache_write,
        "toolResultBytes": 1024,
    }
    if reasoning is not None:
        row["reasoningTokens"] = reasoning
    return row


@pytest.fixture
def db(tmp_path: Path) -> Path:
    path = tmp_path / "cujo.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE runs (
          id TEXT PRIMARY KEY, repo TEXT NOT NULL, pr_number INTEGER NOT NULL,
          head_sha TEXT NOT NULL, session_id TEXT NOT NULL, turn_ids TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL, approver TEXT, decided_at TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          model TEXT, rubric_sha256 TEXT, mode TEXT, budget_tokens INTEGER
        );
        CREATE TABLE run_projections (run_id TEXT PRIMARY KEY, projection TEXT NOT NULL);
        """
    )
    sandbox = _projection(
        threads=[
            _thread("main", 1000, 200, cache_read=500, reasoning=50),
            _thread("tests", 2000, 100),
            _thread("detonation", 300, 30, attempt=2),
        ],
        findings=[
            {"source": "hard_rule", "check": "tests", "severity": "critical", "title": "t"},
            {"source": "agent", "check": "tests", "severity": "warn", "title": "w"},
            {"source": "agent", "check": "main", "severity": "info", "title": "i"},
        ],
        usage={
            "inputTokens": 3300,
            "outputTokens": 330,
            "cacheReadTokens": 500,
            "cacheWriteTokens": 0,
            "reasoningTokens": 50,
            "costUsd": 0.0123,
            "messages": 9,
        },
        checks=[
            {
                "title": "tests",
                "isCheck": True,
                "status": "done",
                "startedAt": "2026-09-14T10:00:00.000Z",
                "endedAt": "2026-09-14T10:02:00.000Z",
            }
        ],
    )
    diff = _projection(
        threads=[_thread("main", 400, 80)],
        findings=[{"source": "agent", "check": "diff", "severity": "warn", "title": "d"}],
        usage={
            "inputTokens": 400,
            "outputTokens": 80,
            "cacheReadTokens": 0,
            "cacheWriteTokens": 0,
            "messages": 1,
        },
    )
    conn.executemany(
        "INSERT INTO runs (id, repo, pr_number, head_sha, session_id, status, created_at, "
        "updated_at, model, mode, budget_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                "r1",
                "o/r",
                7,
                "h1",
                "s",
                "blocked",
                "2026-09-14T09:59:00.000Z",
                "2026-09-14T10:03:00.000Z",
                "p/m",
                "sandbox",
                1_000_000,
            ),
            (
                "r2",
                "o/other",
                8,
                "h2",
                "s",
                "clean",
                "2026-09-13T09:00:00.000Z",
                "2026-09-13T09:01:00.000Z",
                "p/flash",
                "diff",
                400_000,
            ),
        ],
    )
    conn.executemany(
        "INSERT INTO run_projections (run_id, projection) VALUES (?, ?)",
        [("r1", json.dumps(sandbox)), ("r2", json.dumps(diff))],
    )
    conn.commit()
    conn.close()
    return path


def test_one_row_per_thread_with_the_findings_that_check_produced(db: Path) -> None:
    runs = load_runs(db)
    run_rows, thread_rows = report(runs, {})
    assert [r["run_id"] for r in run_rows] == ["r1", "r2"]
    by = {(r["run_id"], r["thread"]): r for r in thread_rows}
    tests = by[("r1", "tests")]
    assert tests["total_tokens"] == 2100
    assert (tests["findings_critical"], tests["findings_warn"], tests["findings_info"]) == (1, 1, 0)
    assert by[("r1", "detonation")]["attempt"] == 2
    # Reasoning counts toward the thread's total, and the parent's own finding lands on it.
    main = by[("r1", "main")]
    assert main["total_tokens"] == 1000 + 200 + 500 + 50
    assert main["findings_info"] == 1
    # A thread with no price for its model gets no dollars, not zero.
    assert main["priced_usd"] == ""


def test_run_rows_carry_the_harness_cost_and_the_timings(db: Path) -> None:
    run_rows, _ = report(load_runs(db), {})
    r1 = run_rows[0]
    assert r1["cost_usd"] == "0.0123"
    assert r1["run_ms"] == 4 * 60 * 1000
    assert r1["checks_ms"] == 2 * 60 * 1000
    assert (r1["findings_critical"], r1["findings_warn"], r1["findings_info"]) == (1, 1, 1)
    r2 = run_rows[1]
    assert r2["mode"] == "diff"
    assert r2["checks_ms"] is None
    assert r2["cost_usd"] == ""


def test_a_price_is_applied_per_model_and_reasoning_bills_as_output(db: Path) -> None:
    prices = {"p/m": Price(input=1.0, output=10.0, cache_read=0.1, cache_write=0.0)}
    run_rows, thread_rows = report(load_runs(db), prices)
    main = next(r for r in thread_rows if r["run_id"] == "r1" and r["thread"] == "main")
    expected = (1000 * 1.0 + (200 + 50) * 10.0 + 500 * 0.1) / 1_000_000
    assert main["priced_usd"] == f"{expected:.4f}"
    r1 = run_rows[0]
    per_thread = [float(r["priced_usd"]) for r in thread_rows if r["run_id"] == "r1"]
    assert r1["priced_usd"] == f"{sum(per_thread):.4f}"
    # The other run's model was not priced.
    assert run_rows[1]["priced_usd"] == ""


def test_filters_by_since_and_repo(db: Path) -> None:
    assert [r["id"] for r, _ in load_runs(db, since="2026-09-14")] == ["r1"]
    assert [r["id"] for r, _ in load_runs(db, repo="o/other")] == ["r2"]


def test_parse_price_shapes() -> None:
    assert parse_price("m=1,2") == ("m", Price(1.0, 2.0, 0.0, 0.0))
    assert parse_price("a/b=0.2,1.1,0.05,0.2") == ("a/b", Price(0.2, 1.1, 0.05, 0.2))
    with pytest.raises(Exception, match="expected"):
        parse_price("nope")
    with pytest.raises(Exception, match="number"):
        parse_price("m=x,y")


def test_summary_lists_the_parent_first_then_every_check(db: Path) -> None:
    run_rows, thread_rows = report(load_runs(db), {})
    out = io.StringIO()
    summary(run_rows, thread_rows, out)
    lines = out.getvalue().splitlines()
    assert lines[0] == "runs: 2"
    names = [
        line.split()[0]
        for line in lines
        if line and line.split()[0] in {"main", "tests", "detonation"}
    ]
    assert names == ["main", "detonation", "tests"]


def test_main_writes_the_two_files(
    db: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "ledger"
    assert ledger_report.main(["--db", str(db), "--out", str(out)]) == 0
    assert (out / "runs.csv").read_text().splitlines()[0].startswith("run_id,repo,pr_number")
    assert len((out / "threads.csv").read_text().splitlines()) == 1 + 4
    assert "runs: 2" in capsys.readouterr().err
