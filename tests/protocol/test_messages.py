import contextlib
import json

import pytest
from hypothesis import given
from hypothesis import strategies as st

from naval.domain.coordinates import Coordinate
from naval.domain.flags import Flag
from naval.domain.fleet import Orientation, Placement, ShipKind
from naval.protocol.messages import (
    MAX_FRAME_BYTES,
    ChooseFlagMessage,
    FireMessage,
    InvalidMessage,
    JoinMessage,
    LeaveMessage,
    PlaceFleetMessage,
    RematchMessage,
    parse_client_message,
)

TOKEN = "a" * 43
SHIPS = [
    {"kind": "carrier", "row": 0, "col": 0, "orientation": "horizontal"},
    {"kind": "battleship", "row": 1, "col": 0, "orientation": "horizontal"},
    {"kind": "cruiser", "row": 2, "col": 0, "orientation": "horizontal"},
    {"kind": "submarine", "row": 3, "col": 0, "orientation": "horizontal"},
    {"kind": "destroyer", "row": 4, "col": 0, "orientation": "vertical"},
]


def _frame(payload: object) -> str:
    return json.dumps(payload)


def test_join_without_token() -> None:
    message = parse_client_message(_frame({"type": "join", "nickname": "Ana_01"}))
    assert message == JoinMessage(type="join", nickname="Ana_01", token=None)


def test_join_with_a_flag() -> None:
    message = parse_client_message(_frame({"type": "join", "nickname": "Ana", "flag": "k"}))
    assert message == JoinMessage(type="join", nickname="Ana", flag=Flag.K)


def test_join_without_a_flag_leaves_the_choice_to_the_server() -> None:
    message = parse_client_message(_frame({"type": "join", "nickname": "Ana"}))
    assert isinstance(message, JoinMessage)
    assert message.flag is None


def test_join_with_a_join_id() -> None:
    frame = _frame({"type": "join", "nickname": "Ana", "join_id": TOKEN})
    message = parse_client_message(frame)
    assert isinstance(message, JoinMessage)
    assert message.join_id == TOKEN


def test_choose_flag() -> None:
    message = parse_client_message(_frame({"type": "choose_flag", "flag": "z"}))
    assert message == ChooseFlagMessage(type="choose_flag", flag=Flag.Z)


def test_join_with_token() -> None:
    message = parse_client_message(_frame({"type": "join", "nickname": "Bo", "token": TOKEN}))
    assert isinstance(message, JoinMessage)
    assert message.token == TOKEN


def test_place_fleet_converts_to_placements() -> None:
    message = parse_client_message(_frame({"type": "place_fleet", "ships": SHIPS}))
    assert isinstance(message, PlaceFleetMessage)
    assert message.ships[4].to_placement() == Placement(
        ShipKind.DESTROYER, Coordinate(4, 0), Orientation.VERTICAL
    )


def test_fire_rematch_and_leave() -> None:
    assert parse_client_message(_frame({"type": "fire", "row": 3, "col": 9})) == FireMessage(
        type="fire", row=3, col=9
    )
    assert isinstance(parse_client_message(_frame({"type": "rematch"})), RematchMessage)
    assert isinstance(parse_client_message(_frame({"type": "leave"})), LeaveMessage)


@pytest.mark.parametrize(
    "payload",
    [
        {"type": "hack"},
        {"nickname": "Ana"},
        {"type": "join", "nickname": "Ana", "admin": True},
        {"type": "join", "nickname": ""},
        {"type": "join", "nickname": "x" * 21},
        {"type": "join", "nickname": "<script>"},
        {"type": "join", "nickname": " padded "},
        {"type": "join", "nickname": 5},
        {"type": "join", "nickname": "Ana", "token": "short"},
        {"type": "join", "nickname": "Ana", "token": "!" * 43},
        {"type": "fire", "row": "1", "col": 1},
        {"type": "fire", "row": 1.0, "col": 1},
        {"type": "fire", "row": True, "col": 1},
        {"type": "fire", "row": 10, "col": 1},
        {"type": "fire", "row": -1, "col": 1},
        {"type": "fire", "row": 1},
        {"type": "place_fleet", "ships": SHIPS[:4]},
        {"type": "place_fleet", "ships": [*SHIPS, SHIPS[0]]},
        {"type": "place_fleet", "ships": [{**SHIPS[0], "kind": "yacht"}, *SHIPS[1:]]},
        {"type": "place_fleet", "ships": [{**SHIPS[0], "orientation": "diagonal"}, *SHIPS[1:]]},
        {"type": "rematch", "extra": 1},
        {"type": "join", "nickname": "Ana", "flag": "K"},
        {"type": "join", "nickname": "Ana", "join_id": "short"},
        {"type": "join", "nickname": "Ana", "join_id": "!" * 43},
        {"type": "join", "nickname": "Ana", "flag": "kk"},
        {"type": "join", "nickname": "Ana", "flag": 1},
        {"type": "join", "nickname": "Ana", "flag": ""},
        {"type": "choose_flag"},
        {"type": "choose_flag", "flag": None},
        {"type": "choose_flag", "flag": "ä"},
        {"type": "choose_flag", "flag": "a", "extra": 1},
        ["join"],
        "join",
        None,
    ],
)
def test_invalid_messages_are_rejected(payload: object) -> None:
    with pytest.raises(InvalidMessage):
        parse_client_message(_frame(payload))


def test_malformed_json_is_rejected() -> None:
    with pytest.raises(InvalidMessage):
        parse_client_message('{"type": "join",')


def test_binary_frames_are_rejected() -> None:
    with pytest.raises(InvalidMessage):
        parse_client_message(b'{"type": "leave"}')


def test_oversized_frames_are_rejected_before_parsing() -> None:
    padding = " " * MAX_FRAME_BYTES
    with pytest.raises(InvalidMessage):
        parse_client_message('{"type": "leave"}' + padding)


def test_multibyte_frames_are_measured_in_bytes() -> None:
    frame = '{"type": "join", "nickname": "' + "é" * (MAX_FRAME_BYTES // 2) + '"}'
    assert len(frame) < MAX_FRAME_BYTES
    with pytest.raises(InvalidMessage):
        parse_client_message(frame)


def test_deeply_nested_json_is_rejected() -> None:
    with pytest.raises(InvalidMessage):
        parse_client_message("[" * 1000 + "]" * 1000)


@given(st.text(max_size=300))
def test_arbitrary_text_only_ever_raises_invalid_message(raw: str) -> None:
    with contextlib.suppress(InvalidMessage):
        parse_client_message(raw)


def test_lone_surrogates_are_rejected() -> None:
    with pytest.raises(InvalidMessage):
        parse_client_message('{"type": "join", "nickname": "\ud800"}')


@given(st.text(alphabet=st.characters(), max_size=50))
def test_any_unicode_including_surrogates_only_raises_invalid_message(raw: str) -> None:
    with contextlib.suppress(InvalidMessage):
        parse_client_message(raw)
