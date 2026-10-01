import re
import struct
from pathlib import Path

ROOT = Path(__file__).parents[2]
README = (ROOT / "README.md").read_text(encoding="utf-8")
BANNER = "docs/brand/readme-banner.png"


def _relative_targets() -> set[str]:
    """Paths the README links to or embeds, without their #anchors."""
    found = re.findall(r'\]\(([^)\s]+)\)|(?:src|href)="([^"]+)"', README)
    targets = {markdown or html for markdown, html in found}
    return {
        target.split("#", 1)[0]
        for target in targets
        if not target.startswith(("http://", "https://", "mailto:", "#"))
    }


def test_the_banner_is_committed_at_the_size_it_is_rendered() -> None:
    assert BANNER in _relative_targets()
    width, height = struct.unpack(">II", (ROOT / BANNER).read_bytes()[16:24])
    assert (width, height) == (1280, 640)


def test_every_relative_link_points_at_something_in_the_repository() -> None:
    for target in _relative_targets():
        assert (ROOT / target).exists(), target
