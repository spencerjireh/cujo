"""read_jsonl: offset seeking, torn-line tolerance, and dropped-row counting."""

from __future__ import annotations

from pathlib import Path

from cujo_sniff.jsonl import append_jsonl, file_size, read_jsonl


def test_read_empty_file(tmp_path: Path) -> None:
    log = tmp_path / "empty.jsonl"
    log.touch()
    result = read_jsonl(log)
    assert list(result) == []
    assert result.dropped == 0


def test_read_missing_file(tmp_path: Path) -> None:
    result = read_jsonl(tmp_path / "does-not-exist.jsonl")
    assert list(result) == []
    assert result.dropped == 0


def test_read_valid_rows(tmp_path: Path) -> None:
    log = tmp_path / "valid.jsonl"
    append_jsonl(log, {"host": "a.example", "port": 443})
    append_jsonl(log, {"host": "b.example", "port": 80})
    result = read_jsonl(log)
    assert len(result) == 2
    assert result.rows[0]["host"] == "a.example"
    assert result.rows[1]["host"] == "b.example"
    assert result.dropped == 0


def test_torn_last_line_is_dropped(tmp_path: Path) -> None:
    log = tmp_path / "torn.jsonl"
    append_jsonl(log, {"ok": True})
    with log.open("a") as fh:
        fh.write('{"broken": tr')
    result = read_jsonl(log)
    assert len(result) == 1
    assert result.rows[0] == {"ok": True}
    assert result.dropped == 1


def test_offset_skips_earlier_rows(tmp_path: Path) -> None:
    log = tmp_path / "offset.jsonl"
    append_jsonl(log, {"first": True})
    mid = file_size(log)
    append_jsonl(log, {"second": True})
    result = read_jsonl(log, offset=mid)
    assert len(result) == 1
    assert result.rows[0] == {"second": True}
    assert result.dropped == 0


def test_multiple_torn_lines_counted(tmp_path: Path) -> None:
    log = tmp_path / "multi.jsonl"
    append_jsonl(log, {"ok": True})
    with log.open("a") as fh:
        fh.write("not json\n")
        fh.write("also bad\n")
    result = read_jsonl(log)
    assert len(result) == 1
    assert result.dropped == 2


def test_result_is_iterable(tmp_path: Path) -> None:
    log = tmp_path / "iter.jsonl"
    append_jsonl(log, {"a": 1})
    append_jsonl(log, {"b": 2})
    result = read_jsonl(log)
    assert [r for r in result] == [{"a": 1}, {"b": 2}]
