"""`sniff.py smoke`: a real server booted under the sensors, hit, and stopped."""

from __future__ import annotations

from pathlib import Path

import pytest

from cujo_sniff.smoke import parse_request, port_from_boot
from tests.conftest import Cli

pytestmark = pytest.mark.harness

SERVER = """
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}')
        else:
            self.send_response(500); self.end_headers(); self.wfile.write(b"boom")
    def log_message(self, *a):
        sys.stderr.write("served %s\\n" % self.path)

print("listening", flush=True)
HTTPServer(("127.0.0.1", int(sys.argv[-1])), H).serve_forever()
"""


def test_port_from_boot() -> None:
    assert port_from_boot("uv run uvicorn app:app --port 8000") == 8000
    assert port_from_boot("uvicorn app:app --port=8001") == 8001
    assert port_from_boot("node server.js -p 3000") == 3000
    assert port_from_boot("PORT=4000 npm start") == 4000
    assert port_from_boot("gunicorn -b 127.0.0.1:9000 app") == 9000
    assert port_from_boot("npm start") is None


def test_parse_request() -> None:
    assert parse_request("GET /health") == ("GET", "/health")
    assert parse_request(" POST /orders ") == ("POST", "/orders")
    assert parse_request("curl /x") is None
    assert parse_request("GET health") is None


def _free_port() -> int:
    import socket

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def test_boots_hits_and_stops_the_app(tmp_path: Path, cli: Cli) -> None:
    (tmp_path / "server.py").write_text(SERVER)
    port = _free_port()
    cli(["setup", "--proxy-port", "0"])
    try:
        entry = cli(
            [
                "smoke",
                "--boot",
                f"python3 server.py --port {port}",
                "--request",
                "GET /health",
                "--request",
                "GET /orders/1",
                "--cwd",
                str(tmp_path),
                "--tree",
                "head",
            ]
        )
        assert entry["ready"] is True
        assert entry["port"] == port
        assert entry["port_source"] == "boot line"
        assert entry["tree"] == "head"
        assert [(r["request"], r["status"]) for r in entry["requests"]] == [
            ("GET /health", 200),
            ("GET /orders/1", 500),
        ]
        assert entry["requests"][0]["tail"] == '{"ok":true}'
        # The boot's own output is the log, and it was stopped by this command.
        assert "listening" in entry["stdout_tail"]
        assert "served /health" in entry["stderr_tail"]
        assert entry["exit"] != 0
        assert entry["window_exclusive"] is True
        # It is on the ledger, so the envelope can be assembled from it.
        envelope = cli(["report", "--check", "smoke", "--extra", '{"log_tail": "x"}'])
        assert envelope["check"] == "smoke"
        assert len(envelope["runs"]) == 1
        assert envelope["log_tail"] == "x"
    finally:
        cli(["teardown"])
    import socket

    with pytest.raises(OSError):
        socket.create_connection(("127.0.0.1", port), timeout=0.2).close()


def test_reports_a_boot_that_never_listens(tmp_path: Path, cli: Cli) -> None:
    port = _free_port()
    cli(["setup", "--proxy-port", "0"])
    try:
        entry = cli(
            [
                "smoke",
                "--boot",
                "python3 -c 'import sys; print(\"nope\"); sys.exit(3)'",
                "--request",
                "GET /health",
                "--port",
                str(port),
                "--cwd",
                str(tmp_path),
            ]
        )
        assert entry["ready"] is False
        assert entry["exit"] == 3
        assert entry["port_source"] == "argument"
        assert entry["requests"] == [
            {"request": "GET /health", "status": None, "tail": "", "error": "app never listened"}
        ]
        assert "nope" in entry["stdout_tail"]
    finally:
        cli(["teardown"])


def test_refuses_a_request_that_is_not_one(tmp_path: Path, cli: Cli) -> None:
    result = cli.raw(["smoke", "--boot", "true", "--request", "curl /x", "--cwd", str(tmp_path)])
    assert result.returncode != 0
    assert "METHOD /path" in result.stderr + result.stdout
