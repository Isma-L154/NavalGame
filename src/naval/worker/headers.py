from collections.abc import Mapping
from types import MappingProxyType

_CSP = "; ".join(
    (
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    )
)

SECURITY_HEADERS: Mapping[str, str] = MappingProxyType(
    {
        # Report-only until the UI is verified against it (baseline control 7).
        "Content-Security-Policy-Report-Only": _CSP,
        "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Cross-Origin-Opener-Policy": "same-origin",
    }
)

API_HEADERS: Mapping[str, str] = MappingProxyType({**SECURITY_HEADERS, "Cache-Control": "no-store"})
