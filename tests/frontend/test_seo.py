import re
import struct
import xml.etree.ElementTree as ET
from collections import defaultdict
from html.parser import HTMLParser
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


class _Head(HTMLParser):
    """Collects every <meta> value by its property or name, and every <link> href by its rel."""

    def __init__(self, html: str) -> None:
        super().__init__()
        self.values: defaultdict[str, list[str]] = defaultdict(list)
        self.feed(html)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        found = dict(attrs)
        if tag == "meta":
            key = found.get("property") or found.get("name")
            if key:
                self.values[key].append(found.get("content") or "")
        elif tag == "link" and found.get("rel"):
            self.values[f"link:{found['rel']}"].append(found.get("href") or "")


def _head(page: str) -> dict[str, str]:
    """The page's head entries; the ones these tests check must each appear exactly once."""
    values = _Head((PUBLIC / page).read_text(encoding="utf-8")).values
    checked = (*SOCIAL_TAGS, *TWITTER_TAGS, "og:url", "link:canonical", "link:apple-touch-icon")
    duplicated = sorted(key for key in checked if len(values.get(key, [])) > 1)
    assert not duplicated, f"{page} repeats {duplicated}"
    return {key: found[0] for key, found in values.items()}


def _png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    assert data[:8] == PNG_SIGNATURE, path.name
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def test_every_page_has_a_complete_share_card() -> None:
    for page in PAGES.values():
        head = _head(page)
        for key in (*SOCIAL_TAGS, *TWITTER_TAGS):
            assert head.get(key), f"{page}: {key}"
        assert head["twitter:card"] == "summary_large_image"
        assert head["og:description"] == head["description"]


def test_og_url_matches_the_canonical_link_except_on_the_game_page() -> None:
    # Invite links are /?room=CODE: a fixed og:url would make scrapers link to the bare home.
    assert "og:url" not in _head("index.html")
    terms = _head("terms.html")
    assert terms["og:url"] == terms["link:canonical"]


def test_the_share_image_is_a_1200_by_630_png_on_this_site() -> None:
    for page in PAGES.values():
        head = _head(page)
        assert head["og:image"] == f"{ORIGIN}/og-image.png"
        assert head["og:image:width"] == "1200"
        assert head["og:image:height"] == "630"
    assert _png_size(PUBLIC / "og-image.png") == (1200, 630)


def test_the_apple_touch_icon_is_linked_and_180_pixels() -> None:
    for page in PAGES.values():
        assert _head(page)["link:apple-touch-icon"] == "/apple-touch-icon.png"
    assert _png_size(PUBLIC / "apple-touch-icon.png") == (180, 180)
