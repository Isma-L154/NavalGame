import json
import os
import urllib.error
import urllib.request
from email.message import Message

import pytest

pytestmark = pytest.mark.integration


def _get(path: str) -> tuple[int, Message, bytes]:
    base_url = os.environ["NAVAL_BASE_URL"]
    try:
        with urllib.request.urlopen(base_url + path, timeout=30) as response:  # noqa: S310
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()


def test_health_endpoint() -> None:
    status, headers, body = _get("/api/health")
    assert status == 200
    assert json.loads(body) == {"status": "ok"}
    assert headers["Cache-Control"] == "no-store"
    assert "Content-Security-Policy-Report-Only" in headers


def test_unknown_api_path_is_404() -> None:
    status, headers, body = _get("/api/does-not-exist")
    assert status == 404
    assert json.loads(body) == {"error": "not_found"}
    assert headers["X-Content-Type-Options"] == "nosniff"


def test_index_page_has_security_headers() -> None:
    status, headers, body = _get("/")
    assert status == 200
    assert b"NavalGame" in body
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert "Content-Security-Policy-Report-Only" in headers
