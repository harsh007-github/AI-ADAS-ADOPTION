from collections import deque
from dataclasses import dataclass
from typing import Deque, Tuple
import time


@dataclass
class AlertEvent:
    """Single ADAS raw trigger record for temporal analysis."""
    timestamp: float           # epoch seconds
    trigger_class: str         # e.g. "AEB", "LKA", "FCW"
    vehicle_speed: float       # km/h
    severity_hint: int         # 1=info, 2=warn, 3=critical (raw)


class NuisanceFilter:
    """
    Temporal clustering + low-speed context throttling.
    Suppresses HMI escalation when alert density spikes
    under city/bumper-to-bumper conditions.
    """

    WINDOW_SEC = 30.0
    DENSITY_THRESHOLD = 3
    LOW_SPEED_CUTOFF = 25.0  # km/h
    THROTTLE_COOLDOWN_SEC = 20.0

    def __init__(self) -> None:
        self._window: Deque[AlertEvent] = deque()
        self._throttle_until: float = 0.0

    def _evict(self, now: float) -> None:
        cutoff = now - self.WINDOW_SEC
        while self._window and self._window[0].timestamp < cutoff:
            self._window.popleft()

    def evaluate(self, evt: AlertEvent) -> Tuple[int, str]:
        """
        Returns (throttle_level, reason).
        throttle_level: 0 = normal, 1 = downgrade one tier.
        """
        now = evt.timestamp
        self._evict(now)

        if now < self._throttle_until:
            return 1, "cooldown_active"

        recent_low_speed = [
            e for e in self._window
            if e.vehicle_speed < self.LOW_SPEED_CUTOFF
        ]
        self._window.append(evt)

        if (
            evt.vehicle_speed < self.LOW_SPEED_CUTOFF
            and len(recent_low_speed) >= self.DENSITY_THRESHOLD
        ):
            self._throttle_until = now + self.THROTTLE_COOLDOWN_SEC
            return 1, "density_spike_low_speed"

        return 0, "ok"
