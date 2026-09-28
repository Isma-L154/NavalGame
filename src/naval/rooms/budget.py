class MessageBudget:
    """Token bucket for one connection, plus a count of protocol violations."""

    def __init__(self, capacity: int, window_seconds: float, max_violations: int = 5) -> None:
        self._capacity = capacity
        self._refill_per_second = capacity / window_seconds
        self._tokens = float(capacity)
        self._updated_at: float | None = None
        self._max_violations = max_violations
        self._violations = 0

    def allow(self, now: float) -> bool:
        if self._updated_at is not None:
            elapsed = max(0.0, now - self._updated_at)
            self._tokens = min(self._capacity, self._tokens + elapsed * self._refill_per_second)
        self._updated_at = now
        if self._tokens < 1:
            return False
        self._tokens -= 1
        return True

    def record_violation(self) -> bool:
        """Returns True once the connection has used up its allowed violations."""
        self._violations += 1
        return self._violations >= self._max_violations
