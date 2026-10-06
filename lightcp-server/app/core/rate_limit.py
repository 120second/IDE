from collections import deque
from threading import Lock
from time import monotonic
from typing import Callable

from app.core.errors import AppError


class RateLimiter:
    """Bounded, thread-safe sliding windows for the deployed single-worker API."""

    def __init__(self, clock: Callable[[], float] = monotonic, max_keys: int = 10_000) -> None:
        self.clock = clock
        self.max_keys = max_keys
        self.windows: dict[tuple[str, str], tuple[deque[float], int]] = {}
        self.lock = Lock()

    def check(self, scope: str, identity: str, limit: int, seconds: int) -> None:
        now = self.clock()
        key = (scope, identity)
        with self.lock:
            if key not in self.windows and len(self.windows) >= self.max_keys:
                expired = [key for key, (events, window) in self.windows.items()
                           if not events or events[-1] <= now - window]
                for expired_key in expired:
                    del self.windows[expired_key]
                if len(self.windows) >= self.max_keys:
                    raise AppError(429, "RATE_LIMITED", "请求过于频繁，请稍后重试。")
            events, _ = self.windows.setdefault(key, (deque(), seconds))
            while events and events[0] <= now - seconds:
                events.popleft()
            if len(events) >= limit:
                raise AppError(429, "RATE_LIMITED", "请求过于频繁，请稍后重试。")
            events.append(now)
