"""Sensor: the logging proxy.

Every process that honours HTTP_PROXY reaches the network through here, so the
host, port, and byte count of each connection are recorded without touching the
process itself. A process that opens a socket directly is invisible to this
sensor and is the Python audit hook's job instead.
"""

from __future__ import annotations

import select
import socket
import socketserver
import time
from pathlib import Path
from urllib.parse import urlsplit

from cujo_sniff.jsonl import append_jsonl


class _ProxyHandler(socketserver.BaseRequestHandler):
    """Forward one client connection upstream and log host, port, and bytes.

    CONNECT tunnels (HTTPS) are relayed opaquely. Plain HTTP requests carry an
    absolute URL in the request line; the request is rewritten to an
    origin-form line and relayed the same way.
    """

    log_path: Path

    def handle(self) -> None:
        client = self.request
        client.settimeout(30)
        head = self._read_head(client)
        if not head:
            return
        request_line = head.split(b"\r\n", 1)[0].decode("latin-1", "replace")
        parts = request_line.split()
        if len(parts) < 2:
            return
        method, target = parts[0], parts[1]
        try:
            if method == "CONNECT":
                host, port = self._split_hostport(target, 443)
                upstream = socket.create_connection((host, port), timeout=30)
                client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                initial = b""
            else:
                url = urlsplit(target)
                host, port = self._split_hostport(url.netloc, 80)
                upstream = socket.create_connection((host, port), timeout=30)
                path = url.path or "/"
                if url.query:
                    path += "?" + url.query
                version = parts[2] if len(parts) > 2 else "HTTP/1.1"
                rewritten = f"{method} {path} {version}".encode("latin-1")
                initial = rewritten + b"\r\n" + head.split(b"\r\n", 1)[1]
        except OSError:
            client.sendall(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
            return
        sent = len(initial)
        if initial:
            upstream.sendall(initial)
        up, down = _relay(client, upstream)
        upstream.close()
        append_jsonl(
            self.log_path,
            {"ts": time.time(), "host": host, "port": port, "bytes": sent + up + down},
        )

    @staticmethod
    def _read_head(sock: socket.socket) -> bytes:
        buf = b""
        while b"\r\n\r\n" not in buf and len(buf) < 65536:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
        return buf

    @staticmethod
    def _split_hostport(netloc: str, default: int) -> tuple[str, int]:
        host, _, port = netloc.rpartition(":")
        if not host or not port.isdigit():
            return netloc, default
        return host, int(port)


def _relay(a: socket.socket, b: socket.socket) -> tuple[int, int]:
    """Pump bytes both ways until either side closes; return (a->b, b->a) counts."""
    a.setblocking(False)
    b.setblocking(False)
    counts = {a: 0, b: 0}
    peer = {a: b, b: a}
    open_ends = {a, b}
    while open_ends:
        readable, _, _ = select.select(list(open_ends), [], [], 30)
        if not readable:
            break
        for s in readable:
            try:
                data = s.recv(65536)
            except (BlockingIOError, InterruptedError):
                continue
            except OSError:
                data = b""
            if not data:
                open_ends.discard(s)
                try:
                    peer[s].shutdown(socket.SHUT_WR)
                except OSError:
                    # Both ends closed at once, so the half-close this was
                    # asking for has already happened. That is an ordinary end
                    # to a relay, not a failure: there is nothing left to shut
                    # down and nothing a report would want to know.
                    pass
                continue
            counts[s] += len(data)
            try:
                peer[s].sendall(data)
            except OSError:
                open_ends.clear()
    return counts[a], counts[b]


def serve_proxy(port: int, log_path: Path) -> None:
    class Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    handler = type("Handler", (_ProxyHandler,), {"log_path": log_path})
    with Server(("127.0.0.1", port), handler) as server:
        server.serve_forever()
