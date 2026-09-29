import json
import os
import urllib.error
import urllib.request
from email.message import Message

import pytest

from tests.integration.client import USER_AGENT

pytestmark = pytest.mark.integration


def _get(path: str) -> tuple[int, Message, bytes]:
    request = urllib.request.Request(os.environ["NAVAL_BASE_URL"] + path)  # noqa: S310
    request.add_header("User-Agent", USER_AGENT)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()


def test_health_endpoint() -> None:
    status, headers, body = _get("/api/health")
    assert status == 200
    health = json.loads(body)
    assert health["status"] == "ok"
    assert isinstance(health["version"], str)
    assert health["version"]
    assert headers["Cache-Control"] == "no-store"
    assert "Content-Security-Policy" in headers
    assert "Content-Security-Policy-Report-Only" not in headers


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
    assert "Content-Security-Policy" in headers
    assert "Content-Security-Policy-Report-Only" not in headers


def test_sitemap_and_robots_are_served() -> None:
    status, headers, body = _get("/sitemap.xml")
    assert status == 200
    assert headers["Content-Type"].startswith("application/xml")
    assert b"<loc>https://naval.cloudils.com/terms</loc>" in body
    status, headers, body = _get("/robots.txt")
    assert status == 200
    assert headers["Content-Type"].startswith("text/plain")
    assert b"Sitemap: https://naval.cloudils.com/sitemap.xml" in body


def test_share_images_are_served() -> None:
    for path in ("/og-image.png", "/apple-touch-icon.png"):
        status, headers, body = _get(path)
        assert status == 200, path
        assert headers["Content-Type"].startswith("image/png"), path
        assert body.startswith(bytes.fromhex("89504e470d0a1a0a")), path
