from collections.abc import Mapping
from types import MappingProxyType

_CSP = "; ".join(
    (
        "default-src 'self'",
        # Cloudflare Web Analytics is injected by the zone at the edge (not by this app).
        "script-src 'self' https://static.cloudflareinsights.com",
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self' https://cloudflareinsights.com",
        "font-src 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    )
)

SECURITY_HEADERS: Mapping[str, str] = MappingProxyType(
    {
        # Enforced after E2E runs locally and in production showed no violations.
        "Content-Security-Policy": _CSP,
        "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Cross-Origin-Opener-Policy": "same-origin",
    }
)

API_HEADERS: Mapping[str, str] = MappingProxyType({**SECURITY_HEADERS, "Cache-Control": "no-store"})
