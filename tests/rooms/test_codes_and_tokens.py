import pytest

from naval.rooms.codes import (
    ROOM_CODE_ALPHABET,
    ROOM_CODE_LENGTH,
    is_valid_room_code,
    new_room_code,
)
from naval.rooms.tokens import hash_token, new_seat_token, token_matches


def test_generated_codes_are_valid_and_vary() -> None:
    codes = {new_room_code() for _ in range(50)}
    assert len(codes) > 45
    assert all(is_valid_room_code(code) for code in codes)
    assert all(len(code) == ROOM_CODE_LENGTH for code in codes)


def test_alphabet_has_no_ambiguous_characters() -> None:
    assert not set("01ILO") & set(ROOM_CODE_ALPHABET)


@pytest.mark.parametrize("code", ["", "ABCDE", "ABCDEFG", "abcdef", "ABCDE0", "ABCDEI", "ABC DE"])
def test_malformed_codes_are_rejected(code: str) -> None:
    assert not is_valid_room_code(code)


def test_seat_tokens_are_long_and_url_safe() -> None:
    token = new_seat_token()
    assert len(token) == 43
    assert token != new_seat_token()


def test_only_the_hash_is_compared() -> None:
    token = new_seat_token()
    token_hash = hash_token(token)
    assert len(token_hash) == 64
    assert token not in token_hash
    assert token_matches(token, token_hash)
    assert not token_matches(new_seat_token(), token_hash)
