import re
import struct
import xml.etree.ElementTree as ET
from pathlib import Path

PUBLIC = Path(__file__).parents[2] / "public"
ORIGIN = "https://naval.cloudils.com"
SITEMAP_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
PAGES = {f"{ORIGIN}/": "index.html", f"{ORIGIN}/terms": "terms.html"}
SOCIAL_TAGS = (
    "og:type",
    "og:site_name",
    "og:title",
    "og:description",
    "og:image",
    "og:image:width",
    "og:image:height",
    "og:image:alt",
    "og:locale",
)
TWITTER_TAGS = ("twitter:card", "twitter:image:alt")
PNG_SIGNATURE = bytes.fromhex("89504e470d0a1a0a")


def _sitemap_urls() -> list[str]:
    root = ET.parse(PUBLIC / "sitemap.xml").getroot()  # noqa: S314 - our own static file
    return [loc.text or "" for loc in root.findall("sm:url/sm:loc", SITEMAP_NS)]


def test_sitemap_lists_every_public_page() -> None:
    assert sorted(_sitemap_urls()) == sorted(PAGES)


def test_every_page_declares_its_canonical_url() -> None:
    for url, page in PAGES.items():
        html = (PUBLIC / page).read_text(encoding="utf-8")
        assert re.search(rf'<link rel="canonical" href="{re.escape(url)}">', html), page


def test_robots_allows_the_site_and_points_to_the_sitemap() -> None:
    robots = (PUBLIC / "robots.txt").read_text(encoding="utf-8").splitlines()
    assert "User-agent: *" in robots
    assert "Disallow: /api/" in robots
    assert f"Sitemap: {ORIGIN}/sitemap.xml" in robots


def _meta(html: str, attr: str, key: str) -> str | None:
    values = re.findall(rf'<meta {attr}="{re.escape(key)}" content="([^"]*)">', html)
    assert len(values) <= 1, f"{key} appears {len(values)} times"
    return values[0] if values else None


def _png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    assert data[:8] == PNG_SIGNATURE, path.name
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def test_every_page_has_a_complete_share_card() -> None:
    for page in PAGES.values():
        html = (PUBLIC / page).read_text(encoding="utf-8")
        for key in SOCIAL_TAGS:
            assert _meta(html, "property", key), f"{page}: {key}"
        for key in TWITTER_TAGS:
            assert _meta(html, "name", key), f"{page}: {key}"
        assert _meta(html, "name", "twitter:card") == "summary_large_image"
        assert _meta(html, "property", "og:description") == _meta(html, "name", "description")


def test_og_url_is_the_canonical_url_except_on_the_game_page() -> None:
    # Invite links are /?room=CODE: a fixed og:url would make scrapers link to the bare home.
    assert _meta((PUBLIC / "index.html").read_text(encoding="utf-8"), "property", "og:url") is None
    terms = (PUBLIC / "terms.html").read_text(encoding="utf-8")
    assert _meta(terms, "property", "og:url") == f"{ORIGIN}/terms"


def test_the_share_image_is_a_1200_by_630_png_on_this_site() -> None:
    for page in PAGES.values():
        html = (PUBLIC / page).read_text(encoding="utf-8")
        assert _meta(html, "property", "og:image") == f"{ORIGIN}/og-image.png"
        assert _meta(html, "property", "og:image:width") == "1200"
        assert _meta(html, "property", "og:image:height") == "630"
    assert _png_size(PUBLIC / "og-image.png") == (1200, 630)


def test_the_apple_touch_icon_is_linked_and_180_pixels() -> None:
    for page in PAGES.values():
        html = (PUBLIC / page).read_text(encoding="utf-8")
        assert '<link rel="apple-touch-icon" href="/apple-touch-icon.png">' in html
    assert _png_size(PUBLIC / "apple-touch-icon.png") == (180, 180)
