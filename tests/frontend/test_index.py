import re
from pathlib import Path

PUBLIC = Path(__file__).parents[2] / "public"


def test_every_module_is_preloaded() -> None:
    html = (PUBLIC / "index.html").read_text(encoding="utf-8")
    preloaded = set(re.findall(r'<link rel="modulepreload" href="/js/([a-z]+\.js)">', html))
    modules = {path.name for path in (PUBLIC / "js").glob("*.js")} - {"app.js"}
    assert preloaded == modules


def test_no_inline_scripts_styles_or_handlers() -> None:
    html = (PUBLIC / "index.html").read_text(encoding="utf-8")
    assert re.search(r"<script(?![^>]*\bsrc=)", html) is None
    assert "<style" not in html
    assert re.search(r"\sstyle=", html) is None
    assert re.search(r"\son[a-z]+=", html) is None


def test_scripts_never_write_html_from_strings() -> None:
    for path in (PUBLIC / "js").glob("*.js"):
        source = path.read_text(encoding="utf-8")
        for sink in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval("):
            assert sink not in source, f"{path.name} uses {sink}"
