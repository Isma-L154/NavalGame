import pytest

from naval.worker.retry import GaveUp, call_with_retry


class InfraError(Exception):
    def __init__(self, *, retryable: bool = False, overloaded: bool = False) -> None:
        super().__init__("infrastructure error")
        self.retryable = retryable
        self.overloaded = overloaded


class Calls:
    def __init__(self, *outcomes: object) -> None:
        self.outcomes = list(outcomes)
        self.count = 0

    async def __call__(self) -> object:
        self.count += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


async def _no_sleep(_: float) -> None:
    return None


async def test_success_needs_one_call() -> None:
    calls = Calls("ok")
    assert await call_with_retry(calls, sleep=_no_sleep) == "ok"
    assert calls.count == 1


async def test_retryable_errors_are_retried_with_a_fresh_call() -> None:
    calls = Calls(InfraError(retryable=True), InfraError(retryable=True), "ok")
    assert await call_with_retry(calls, sleep=_no_sleep) == "ok"
    assert calls.count == 3


async def test_overloaded_errors_are_not_retried() -> None:
    calls = Calls(InfraError(retryable=True, overloaded=True), "ok")
    with pytest.raises(GaveUp):
        await call_with_retry(calls, sleep=_no_sleep)
    assert calls.count == 1


async def test_other_errors_are_not_retried() -> None:
    calls = Calls(ValueError("bug"), "ok")
    with pytest.raises(GaveUp):
        await call_with_retry(calls, sleep=_no_sleep)
    assert calls.count == 1


async def test_gives_up_after_the_last_attempt() -> None:
    calls = Calls(*[InfraError(retryable=True)] * 3)
    with pytest.raises(GaveUp):
        await call_with_retry(calls, attempts=3, sleep=_no_sleep)
    assert calls.count == 3


async def test_the_default_budget_waits_out_a_durable_object_restart(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Right after a deploy, objects restart with the new code; a sub-second budget gave up.
    monkeypatch.setattr("naval.worker.retry.random.random", lambda: 1.0)
    delays: list[float] = []

    async def record(delay: float) -> None:
        delays.append(delay)

    calls = Calls(*[InfraError(retryable=True)] * 5)
    with pytest.raises(GaveUp):
        await call_with_retry(calls, sleep=record)
    assert calls.count == 5
    assert delays == [0.2, 0.4, 0.8, 1.6]


async def test_backoff_grows_and_is_capped() -> None:
    delays: list[float] = []

    async def record(delay: float) -> None:
        delays.append(delay)

    calls = Calls(*[InfraError(retryable=True)] * 5)
    with pytest.raises(GaveUp):
        await call_with_retry(calls, attempts=5, sleep=record, base_delay=0.1, max_delay=0.5)
    assert len(delays) == 4
    assert all(0 <= d <= 0.5 for d in delays)
