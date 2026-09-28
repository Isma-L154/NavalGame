from naval.rooms.budget import MessageBudget


def test_budget_allows_a_burst_then_refills() -> None:
    budget = MessageBudget(capacity=3, window_seconds=3.0)
    assert [budget.allow(now=0.0) for _ in range(4)] == [True, True, True, False]
    assert budget.allow(now=1.0)
    assert not budget.allow(now=1.0)


def test_budget_never_exceeds_capacity() -> None:
    budget = MessageBudget(capacity=2, window_seconds=1.0)
    assert budget.allow(now=0.0)
    assert [budget.allow(now=100.0) for _ in range(3)] == [True, True, False]


def test_violations_are_counted_until_the_limit() -> None:
    budget = MessageBudget(capacity=20, window_seconds=10.0, max_violations=2)
    assert not budget.record_violation()
    assert budget.record_violation()
