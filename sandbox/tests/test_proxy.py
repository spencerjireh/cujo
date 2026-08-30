"""Unit tests for the logging proxy sensor.

The proxy is one of four core sensors but until now had zero dedicated tests.
These cover request-line parsing, CONNECT tunneling, plain HTTP rewriting,
failed-connection logging, relay byte counting, and edge cases (malformed
request, early close). Each test spins up the real ``serve_proxy`` on an
ephemeral port and drives it from a plain socket or ``http.client``, so the
tests exercise the production threading and handler code, not a mock.
"""

from __future__ import annotations

import http.client
import json
import socket
import socketserver
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from cujo_sniff.jsonl import read_jsonl
from cujo_sniff.sensors.proxy import _ProxyHandler, _relay

# ── Helpers ──────────────────────────────────────────────────────────────────


def _wait_for_rows(log: Path, expected: int, timeout: float = 2.0) -> list[dict]:
    """Poll until the log has at least `expected` rows or timeout."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        rows = list(read_jsonl(log))
        if len(rows) >= expected:
            return rows
        time.sleep(0.05)
    return list(read_jsonl(log))


def _start_proxy(log_path: Path) -> tuple[int, threading.Thread]:
    """Start the proxy on an ephemeral port; return (port, thread)."""
    ready = threading.Event()
    info: dict[str, int] = {}

    def run() -> None:
        class Server(socketserver.ThreadingTCPServer):
            allow_reuse_address = True
            daemon_threads = True

        handler = type("Handler", (_ProxyHandler,), {"log_path": log_path})
        with Server(("127.0.0.1", 0), handler) as srv:
            info["port"] = srv.server_address[1]
            ready.set()
            srv.serve_forever()

    t = threading.Thread(target=run, daemon=True)
    t.start()
    ready.wait(timeout=5)
    return info["port"], t


class _EchoHandler(BaseHTTPRequestHandler):
    """Tiny HTTP server that echoes the request path and method back."""

    def do_GET(self) -> None:
        body = json.dumps({"method": "GET", "path": self.path}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        payload = self.rfile.read(length)
        body = json.dumps({"method": "POST", "path": self.path, "body": payload.decode()}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        pass


def _start_echo_server() -> tuple[int, HTTPServer]:
    server = HTTPServer(("127.0.0.1", 0), _EchoHandler)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return port, server


# ── _split_hostport ──────────────────────────────────────────────────────────


def test_split_hostport_with_port() -> None:
    host, port = _ProxyHandler._split_hostport("example.com:8080", 80)
    assert host == "example.com"
    assert port == 8080


def test_split_hostport_without_port() -> None:
    host, port = _ProxyHandler._split_hostport("example.com", 443)
    assert host == "example.com"
    assert port == 443


def test_split_hostport_non_numeric_port() -> None:
    host, port = _ProxyHandler._split_hostport("example.com:abc", 80)
    assert host == "example.com:abc"
    assert port == 80


def test_split_hostport_empty_host() -> None:
    host, port = _ProxyHandler._split_hostport(":8080", 80)
    assert host == ":8080"
    assert port == 80


# ── _relay ───────────────────────────────────────────────────────────────────


def test_relay_counts_bytes() -> None:
    """_relay should count bytes in each direction."""
    a_server, b_server = socket.socketpair()
    a_client, b_client = socket.socketpair()

    a_server.sendall(b"hello")
    a_server.shutdown(socket.SHUT_WR)
    b_client.sendall(b"world!!")
    b_client.shutdown(socket.SHUT_WR)

    up, down = _relay(a_client, b_server)
    # _relay returns (a→b, b→a): a_client reads 7 from b_client and
    # forwards to b_server; b_server reads 5 from a_server and forwards
    # to a_client.
    assert up == 7
    assert down == 5

    for s in (a_server, b_server, a_client, b_client):
        s.close()


def test_relay_handles_immediate_close() -> None:
    """_relay returns (0, 0) when both sides close immediately."""
    a, b = socket.socketpair()
    a.shutdown(socket.SHUT_WR)
    b.shutdown(socket.SHUT_WR)
    up, down = _relay(a, b)
    assert up == 0
    assert down == 0
    a.close()
    b.close()


# ── Plain HTTP GET through proxy ─────────────────────────────────────────────


def test_proxy_relays_http_get(tmp_path: Path) -> None:
    """An HTTP GET through the proxy reaches the upstream and is logged."""
    echo_port, echo_server = _start_echo_server()
    log = tmp_path / "proxy.jsonl"
    proxy_port, _ = _start_proxy(log)

    try:
        conn = http.client.HTTPConnection("127.0.0.1", proxy_port)
        conn.request(
            "GET",
            f"http://127.0.0.1:{echo_port}/test?q=1",
        )
        resp = conn.getresponse()
        body = json.loads(resp.read())
        conn.close()

        assert resp.status == 200
        assert body["method"] == "GET"
        assert body["path"] == "/test?q=1"

        rows = _wait_for_rows(log, 1)
        assert len(rows) == 1
        assert rows[0]["host"] == "127.0.0.1"
        assert rows[0]["port"] == echo_port
        assert rows[0]["bytes"] > 0
        assert "error" not in rows[0]
    finally:
        echo_server.shutdown()


def test_proxy_relays_http_post(tmp_path: Path) -> None:
    """An HTTP POST body is relayed through the proxy."""
    echo_port, echo_server = _start_echo_server()
    log = tmp_path / "proxy.jsonl"
    proxy_port, _ = _start_proxy(log)

    try:
        conn = http.client.HTTPConnection("127.0.0.1", proxy_port)
        conn.request(
            "POST",
            f"http://127.0.0.1:{echo_port}/submit",
            body="payload=test",
            headers={"Content-Length": "12"},
        )
        resp = conn.getresponse()
        body = json.loads(resp.read())
        conn.close()

        assert resp.status == 200
        assert body["method"] == "POST"
        assert body["body"] == "payload=test"
    finally:
        echo_server.shutdown()


# ── CONNECT tunnel ───────────────────────────────────────────────────────────


def test_proxy_connect_tunnel(tmp_path: Path) -> None:
    """CONNECT establishes a raw tunnel; bytes flow both ways and are logged."""
    echo_port, echo_server = _start_echo_server()
    log = tmp_path / "proxy.jsonl"
    proxy_port, _ = _start_proxy(log)

    try:
        sock = socket.create_connection(("127.0.0.1", proxy_port), timeout=5)
        connect_req = (
            f"CONNECT 127.0.0.1:{echo_port} HTTP/1.1\r\nHost: 127.0.0.1:{echo_port}\r\n\r\n"
        ).encode()
        sock.sendall(connect_req)

        resp_head = b""
        while b"\r\n\r\n" not in resp_head:
            chunk = sock.recv(4096)
            if not chunk:
                break
            resp_head += chunk
        assert b"200 Connection Established" in resp_head

        http_req = (
            f"GET /tunneled HTTP/1.1\r\nHost: 127.0.0.1:{echo_port}\r\nConnection: close\r\n\r\n"
        ).encode()
        sock.sendall(http_req)

        response = b""
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            response += chunk
        sock.close()

        body_start = response.find(b"\r\n\r\n")
        assert body_start >= 0, "response lacks header/body separator"
        body = json.loads(response[body_start + 4 :])
        assert body["path"] == "/tunneled"

        rows = _wait_for_rows(log, 1)
        assert len(rows) == 1
        assert rows[0]["host"] == "127.0.0.1"
        assert rows[0]["port"] == echo_port
        assert rows[0]["bytes"] > 0
    finally:
        echo_server.shutdown()


# ── Failed connection (502 + connect_failed row) ────────────────────────────


def test_proxy_logs_connect_failed_on_refused_port(tmp_path: Path) -> None:
    """A connection to a closed port yields 502 and a connect_failed log row."""
    log = tmp_path / "proxy.jsonl"
    proxy_port, _ = _start_proxy(log)

    # Find a port that is definitely not listening
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    dead_port = probe.getsockname()[1]
    probe.close()

    conn = http.client.HTTPConnection("127.0.0.1", proxy_port)
    conn.request("GET", f"http://127.0.0.1:{dead_port}/fail")
    resp = conn.getresponse()
    conn.close()

    assert resp.status == 502

    rows = _wait_for_rows(log, 1)
    assert len(rows) == 1
    assert rows[0]["host"] == "127.0.0.1"
    assert rows[0]["port"] == dead_port
    assert rows[0]["bytes"] == 0
    assert rows[0]["error"] == "connect_failed"


def test_proxy_connect_tunnel_to_dead_port(tmp_path: Path) -> None:
    """CONNECT to a dead port also yields 502 and connect_failed."""
    log = tmp_path / "proxy.jsonl"
    proxy_port, _ = _start_proxy(log)

    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    dead_port = probe.getsockname()[1]
    probe.close()

    sock = socket.create_connection(("127.0.0.1", proxy_port), timeout=5)
    connect_req = (
        f"CONNECT 127.0.0.1:{dead_port} HTTP/1.1\r\nHost: 127.0.0.1:{dead_port}\r\n\r\n"
    ).encode()
    sock.sendall(connect_req)

    resp = b""
    while b"\r\n\r\n" not in resp:
        chunk = sock.recv(4096)
        if not chunk:
            break
        resp += chunk
    sock.close()

    assert b"502 Bad Gateway" in resp

    rows = _wait_for_rows(log, 1)
    assert len(rows) == 1
    assert rows[0]["error"] == "connect_failed"
    assert rows[0]["port"] == dead_port


# ── Edge cases ───────────────────────────────────────────────────────────────


def test_proxy_handles_malformed_request_line(tmp_path: Path) -> None:
    """A request line with < 2 parts is silently dropped (no crash, no log)."""
    log = tmp_path / "proxy.jsonl"
    proxy_port, _ = _start_proxy(log)

    sock = socket.create_connection(("127.0.0.1", proxy_port), timeout=5)
    sock.sendall(b"GARBAGE\r\n\r\n")
    time.sleep(0.3)
    sock.close()

    # No row expected; the short sleep above gives the handler time to
    # finish (or not). A one-shot read is correct here because we are
    # asserting absence, not presence.
    assert len(list(read_jsonl(log))) == 0


def test_proxy_handles_empty_connection(tmp_path: Path) -> None:
    """A client that connects and immediately closes doesn't crash the proxy."""
    log = tmp_path / "proxy.jsonl"
    proxy_port, _ = _start_proxy(log)

    sock = socket.create_connection(("127.0.0.1", proxy_port), timeout=5)
    sock.close()
    time.sleep(0.3)

    assert len(list(read_jsonl(log))) == 0


def test_proxy_preserves_query_string(tmp_path: Path) -> None:
    """Query parameters in the URL survive the absolute-to-origin rewrite."""
    echo_port, echo_server = _start_echo_server()
    log = tmp_path / "proxy.jsonl"
    proxy_port, _ = _start_proxy(log)

    try:
        conn = http.client.HTTPConnection("127.0.0.1", proxy_port)
        conn.request(
            "GET",
            f"http://127.0.0.1:{echo_port}/search?q=hello&page=2",
        )
        resp = conn.getresponse()
        body = json.loads(resp.read())
        conn.close()

        assert body["path"] == "/search?q=hello&page=2"
    finally:
        echo_server.shutdown()


def test_proxy_multiple_requests_log_multiple_rows(tmp_path: Path) -> None:
    """Each proxied request produces its own JSONL row."""
    echo_port, echo_server = _start_echo_server()
    log = tmp_path / "proxy.jsonl"
    proxy_port, _ = _start_proxy(log)

    try:
        for i in range(3):
            conn = http.client.HTTPConnection("127.0.0.1", proxy_port)
            conn.request("GET", f"http://127.0.0.1:{echo_port}/req{i}")
            resp = conn.getresponse()
            resp.read()
            conn.close()

        rows = _wait_for_rows(log, 3)
        assert len(rows) == 3
        for row in rows:
            assert row["host"] == "127.0.0.1"
            assert row["port"] == echo_port
            assert row["bytes"] > 0
    finally:
        echo_server.shutdown()
