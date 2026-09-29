import pytest

from naval.protocol.requests import MAX_REQUEST_BYTES, InvalidRequest, Opponent, parse_create_room


@pytest.mark.parametrize("body", ["", "  ", "{}", '{"opponent": "friend"}'])
def test_a_plain_request_is_a_game_with_a_friend(body: str) -> None:
    assert parse_create_room(body).opponent is Opponent.FRIEND


def test_a_cpu_game_can_be_requested() -> None:
    assert parse_create_room('{"opponent": "cpu"}').opponent is Opponent.CPU


@pytest.mark.parametrize(
    "body",
    [
        '{"opponent": "robot"}',
        '{"opponent": "CPU"}',
        '{"opponent": "cpu", "level": 3}',
        '{"opponent": 1}',
        '{"opponent": null}',
        '["cpu"]',
        '"cpu"',
        "not json",
        '{"opponent": "\ud800"}',
        '{"opponent": "cpu"' + " " * MAX_REQUEST_BYTES + "}",
    ],
)
def test_anything_else_is_refused(body: str) -> None:
    with pytest.raises(InvalidRequest):
        parse_create_room(body)
