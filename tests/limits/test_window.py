from hypothesis import given
from hypothesis import strategies as st

from naval.limits.window import ROOM_CREATION, WS_UPGRADE, Window, consume, limiter_name


def test_allows_up_to_the_limit_within_a_period() -> None:
    window = None
    results = []
    for second in range(11):
        allowed, window = consume(window, now=float(second), limit=10, period=60.0)
        results.append(allowed)
    assert results == [True] * 10 + [False]


def test_a_new_period_starts_fresh() -> None:
    window = Window(started_at=0.0, count=10)
    allowed, window = consume(window, now=60.0, limit=10, period=60.0)
    assert allowed
    assert window == Window(started_at=60.0, count=1)


def test_rejections_do_not_extend_the_window() -> None:
    window = Window(started_at=0.0, count=10)
    allowed, after = consume(window, now=30.0, limit=10, period=60.0)
    assert not allowed
    assert after == window


@given(st.lists(st.floats(min_value=0, max_value=59.9), max_size=200))
def test_never_more_than_the_limit_in_one_window(times: list[float]) -> None:
    window = None
    allowed = 0
    for now in sorted(times):
        ok, window = consume(window, now=now, limit=10, period=60.0)
        allowed += ok
    assert allowed <= 10


def test_limiter_names_hide_the_client_ip() -> None:
    name = limiter_name(ROOM_CREATION, "203.0.113.7")
    assert "203.0.113.7" not in name
    assert name != limiter_name(WS_UPGRADE, "203.0.113.7")
    assert name == limiter_name(ROOM_CREATION, "203.0.113.7")


def test_configured_limits() -> None:
    assert (ROOM_CREATION.limit, ROOM_CREATION.period) == (10, 60.0)
    assert (WS_UPGRADE.limit, WS_UPGRADE.period) == (30, 60.0)
