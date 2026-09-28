from hypothesis import given
from hypothesis import strategies as st

from naval.limits.window import ROOM_CREATION, WS_UPGRADE, Window, consume, limiter_name


def _ids(n: int) -> list[str]:
    return [f"req-{i}" for i in range(n)]


def test_allows_up_to_the_limit_within_a_period() -> None:
    window = None
    results = []
    for second, request_id in enumerate(_ids(11)):
        allowed, window = consume(window, float(second), 10, 60.0, request_id)
        results.append(allowed)
    assert results == [True] * 10 + [False]


def test_a_new_period_starts_fresh() -> None:
    window = Window(started_at=0.0, request_ids=tuple(_ids(10)))
    allowed, window = consume(window, 60.0, 10, 60.0, "late")
    assert allowed
    assert window == Window(started_at=60.0, request_ids=("late",))


def test_rejections_do_not_extend_the_window() -> None:
    window = Window(started_at=0.0, request_ids=tuple(_ids(10)))
    allowed, after = consume(window, 30.0, 10, 60.0, "extra")
    assert not allowed
    assert after == window


def test_a_retried_request_is_counted_once() -> None:
    allowed, window = consume(None, 0.0, 10, 60.0, "same")
    again, window = consume(window, 1.0, 10, 60.0, "same")
    assert allowed
    assert again
    assert window.request_ids == ("same",)


def test_a_retry_of_an_already_counted_request_passes_even_at_the_limit() -> None:
    window = Window(started_at=0.0, request_ids=tuple(_ids(10)))
    allowed, after = consume(window, 5.0, 10, 60.0, "req-9")
    assert allowed
    assert after == window


@given(
    st.lists(st.tuples(st.floats(min_value=0, max_value=59.9), st.text(max_size=3)), max_size=200)
)
def test_never_more_than_the_limit_distinct_requests_in_one_window(
    requests: list[tuple[float, str]],
) -> None:
    window = None
    admitted: set[str] = set()
    for now, request_id in sorted(requests):
        ok, window = consume(window, now, 10, 60.0, request_id)
        if ok:
            admitted.add(request_id)
    assert len(admitted) <= 10


def test_limiter_names_hide_the_client_ip() -> None:
    name = limiter_name(ROOM_CREATION, "203.0.113.7")
    assert "203.0.113.7" not in name
    assert name != limiter_name(WS_UPGRADE, "203.0.113.7")
    assert name == limiter_name(ROOM_CREATION, "203.0.113.7")


def test_configured_limits() -> None:
    assert (ROOM_CREATION.limit, ROOM_CREATION.period) == (10, 60.0)
    assert (WS_UPGRADE.limit, WS_UPGRADE.period) == (30, 60.0)
