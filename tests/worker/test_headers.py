from pathlib import Path

from naval.worker.headers import API_HEADERS, SECURITY_HEADERS

HEADERS_FILE = Path(__file__).parents[2] / "public" / "_headers"


def _static_headers() -> dict[str, str]:
    lines = HEADERS_FILE.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "/*"
    parsed: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip():
            name, _, value = line.strip().partition(": ")
            parsed[name] = value
    return parsed


def test_static_assets_ship_the_same_security_headers() -> None:
    assert _static_headers() == dict(SECURITY_HEADERS)


def test_csp_has_no_unsafe_sources() -> None:
    csp = SECURITY_HEADERS["Content-Security-Policy-Report-Only"]
    assert "unsafe-inline" not in csp
    assert "unsafe-eval" not in csp
    for directive in (
        "default-src 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
    ):
        assert directive in csp


def test_api_responses_are_not_cached() -> None:
    assert API_HEADERS["Cache-Control"] == "no-store"
    assert SECURITY_HEADERS.items() <= API_HEADERS.items()
