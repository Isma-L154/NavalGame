import asyncio
import random
from collections.abc import Awaitable, Callable


class GaveUp(Exception):
    """The call kept failing, or failed in a way that must not be retried."""


def _flag(error: BaseException, name: str) -> bool:
    # Pyodide exposes JavaScript error properties either directly or via `js_error`.
    for source in (error, getattr(error, "js_error", None)):
        if bool(getattr(source, name, False)):
            return True
    return False


async def call_with_retry[T](
    call: Callable[[], Awaitable[T]],
    *,
    attempts: int = 3,
    base_delay: float = 0.05,
    max_delay: float = 1.0,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> T:
    """Retries Durable Object calls whose errors are marked retryable and not overloaded.

    `call` must build a fresh stub each time: a failed stub can stay broken.
    """
    for attempt in range(attempts):
        try:
            return await call()
        except Exception as error:
            retryable = _flag(error, "retryable") and not _flag(error, "overloaded")
            if not retryable or attempt == attempts - 1:
                raise GaveUp(f"{type(error).__name__}: {error}") from error
            await sleep(min(max_delay, base_delay * random.random() * 2**attempt))  # noqa: S311
    raise GaveUp("no attempts made")
