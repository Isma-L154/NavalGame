import string

from naval.domain.flags import Flag


def test_there_is_one_flag_per_letter_of_the_alphabet() -> None:
    assert [flag.value for flag in Flag] == list(string.ascii_lowercase)
