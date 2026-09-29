import re
from pathlib import Path

from naval.domain.flags import Flag

PUBLIC = Path(__file__).parents[2] / "public"
SPRITE_IDS = re.compile(r'<symbol id="flag-([a-z])"')


def test_the_sprite_draws_every_flag_the_server_accepts() -> None:
    sprite = (PUBLIC / "flags.svg").read_text(encoding="utf-8")
    assert SPRITE_IDS.findall(sprite) == [flag.value for flag in Flag]


def test_the_client_names_every_flag_the_server_accepts() -> None:
    source = (PUBLIC / "js" / "flags.js").read_text(encoding="utf-8")
    names_block = source.split("export const FLAGS = [", 1)[1].split("]", 1)[0]
    names = re.findall(r'"([A-Z][A-Za-z-]+)"', names_block)
    assert [name[0].lower() for name in names] == [flag.value for flag in Flag]


def test_pages_use_the_shared_sprite_and_only_existing_flags() -> None:
    known = set(SPRITE_IDS.findall((PUBLIC / "flags.svg").read_text(encoding="utf-8")))
    for page in PUBLIC.glob("*.html"):
        html = page.read_text(encoding="utf-8")
        assert '<symbol id="flag-' not in html, page.name
        used = re.findall(r'href="/flags\.svg#flag-([a-z])"', html)
        assert used, page.name
        assert set(used) <= known, page.name
