import pytest

from naval.worker.policy import (
    MissingConfig,
    is_origin_allowed,
    parse_allowed_origins,
    parse_ws_path,
)


def test_origins_are_parsed_from_a_comma_separated_list() -> None:
    assert parse_allowed_origins("https://naval.cloudils.com, http://localhost:8787") == {
        "https://naval.cloudils.com",
        "http://localhost:8787",
    }


@pytest.mark.parametrize("raw", [None, "", " , "])
def test_missing_origins_fail_loudly(raw: str | None) -> None:
    with pytest.raises(MissingConfig):
        parse_allowed_origins(raw)


@pytest.mark.parametrize(
    "raw",
    ["*", "naval.cloudils.com", "http://naval.cloudils.com", "https://naval.cloudils.com/", "null"],
)
def test_wildcards_and_malformed_origins_are_rejected(raw: str) -> None:
    with pytest.raises(MissingConfig):
        parse_allowed_origins(raw)


def test_origin_must_match_exactly() -> None:
    allowed = parse_allowed_origins("https://naval.cloudils.com")
    assert is_origin_allowed("https://naval.cloudils.com", allowed)
    assert not is_origin_allowed(None, allowed)
    assert not is_origin_allowed("https://naval.cloudils.com.evil.com", allowed)
    assert not is_origin_allowed("https://evil.com", allowed)
    assert not is_origin_allowed("HTTPS://NAVAL.CLOUDILS.COM", allowed)


def test_ws_path_yields_a_valid_room_code() -> None:
    assert parse_ws_path("/api/rooms/K7QX2M/ws") == "K7QX2M"


@pytest.mark.parametrize(
    "path",
    [
        "/api/rooms/k7qx2m/ws",
        "/api/rooms/K7QX2O/ws",
        "/api/rooms/K7QX2/ws",
        "/api/rooms/K7QX2MM/ws",
        "/api/rooms/K7QX2M/ws/",
        "/api/rooms/K7QX2M",
        "/api/rooms/../ws",
    ],
)
def test_malformed_ws_paths_are_rejected(path: str) -> None:
    assert parse_ws_path(path) is None
