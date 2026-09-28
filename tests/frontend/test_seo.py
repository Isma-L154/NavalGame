import re
import xml.etree.ElementTree as ET
from pathlib import Path

PUBLIC = Path(__file__).parents[2] / "public"
ORIGIN = "https://naval.cloudils.com"
SITEMAP_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
PAGES = {f"{ORIGIN}/": "index.html", f"{ORIGIN}/terms": "terms.html"}


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
