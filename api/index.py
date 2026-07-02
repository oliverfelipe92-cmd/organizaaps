from __future__ import annotations

import traceback
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def _dispatch(self, method_name: str) -> None:
        try:
            from app import UBSRequestHandler, ensure_database

            ensure_database()
            getattr(UBSRequestHandler, method_name)(self)
        except Exception as exc:  # pragma: no cover - runtime safety for Vercel
            payload = (
                "OrganizaAPS API initialization failed.\n"
                f"{type(exc).__name__}: {exc}\n\n"
                f"{traceback.format_exc()}"
            ).encode("utf-8", "replace")
            self.send_response(500)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        self._dispatch("do_GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("do_POST")
