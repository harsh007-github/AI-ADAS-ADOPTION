"""
Nivāra ConfidenceEngine — XGBoost-free, math-only heuristic.

ARCHITECTURE PIVOT (2026-06-03):
    ML baseline (XGBoost) was dropped from the MVP due to win32 wheel
    compilation issues. The confidence model is now a deterministic
    function of two signals:

        1. Brake-pressure standard deviation over a rolling window
           (driver intent / pedal noise).
        2. Lateral-proximity thresholding (TTC-style proximity buckets).

This keeps the engine interpretable, side-effect free, and trivially
testable in CI on Windows without compiled native extensions.
"""

from collections import deque
from dataclasses import dataclass
from math import sqrt
from statistics import fmean, pstdev
from typing import Deque, Optional

from nuisance_filter import AlertEvent, NuisanceFilter


# ---------------------------------------------------------------------------
# Telemetry / profile / HMI data classes (unchanged contract)
# ---------------------------------------------------------------------------

@dataclass
class CANFrame:
    """Single 10Hz CAN telemetry row."""
    timestamp: float
    vehicle_speed: float
    brake_pressure: float
    lateral_proximity: float
    raw_adas_trigger: int


@dataclass
class DriverProfile:
    reaction_window_sec: float
    brake_gradient_sigma: float
    following_distance_m: float
    is_aggressive: bool


@dataclass
class HMIState:
    tier: int
    confidence: float
    ring_color: str
    haptic: bool
    audio: bool
    message: str
    suppressed_reason: Optional[str] = None


AGGRESSIVE_DRIVER = DriverProfile(
    reaction_window_sec=0.55,
    brake_gradient_sigma=18.0,
    following_distance_m=2.5,
    is_aggressive=True,
)

CAUTIOUS_DRIVER = DriverProfile(
    reaction_window_sec=1.10,
    brake_gradient_sigma=7.5,
    following_distance_m=5.5,
    is_aggressive=False,
)


# ---------------------------------------------------------------------------
# Heuristic ConfidenceEngine
# ---------------------------------------------------------------------------

class ConfidenceEngine:
    """
    Deterministic confidence model.

    Two normalized signal components, blended per-frame:

        s_brake  = clamp(brake_sigma / 25.0, 0, 1)   (pedal urgency)
        s_prox   = proximity_score(lateral_proximity) (0..1, larger = closer)

    A raw ADAS trigger adds a base lift. Aggressive drivers get a
    harsher threshold curve so nuisance alerts reach Tier 2 less
    often, while cautious drivers escalate sooner.
    """

    PROXIMITY_DANGER_M = 1.2
    PROXIMITY_CAUTION_M = 2.5
    BRAKE_WINDOW = 8
    SIGMA_NORM = 25.0  # brake_pressure sigma at/above this => full credit

    def __init__(self, profile: DriverProfile) -> None:
        self.profile = profile
        self.filter = NuisanceFilter()
        self._brake_window: Deque[float] = deque(maxlen=self.BRAKE_WINDOW)

    # -- helpers --------------------------------------------------------

    def _proximity_score(self, lateral_m: float) -> float:
        """Smooth 0..1 score: 1.0 at contact, 0.0 past 2 * caution."""
        if lateral_m <= 0:
            return 1.0
        if lateral_m >= self.PROXIMITY_CAUTION_M * 2:
            return 0.0
        # Linear ramp between DANGER (1.0) and 2*CAUTION (0.0).
        return max(
            0.0,
            1.0 - (lateral_m - self.PROXIMITY_DANGER_M)
                  / (2 * self.PROXIMITY_CAUTION_M - self.PROXIMITY_DANGER_M),
        )

    def _sigma_score(self) -> float:
        """Normalized 0..1 score from rolling brake-pressure sigma."""
        if len(self._brake_window) < 2:
            return 0.0
        sigma = pstdev(self._brake_window)
        return max(0.0, min(1.0, sigma / self.SIGMA_NORM))

    def _driver_already_braking(self, frame: CANFrame) -> bool:
        return frame.brake_pressure > 12.0

    def _base_confidence(self, frame: CANFrame) -> float:
        """Blend raw ADAS trigger with proximity + sigma signals."""
        if frame.raw_adas_trigger == 0:
            return 0.0

        trigger_lift = {1: 0.30, 2: 0.55, 3: 0.80}[frame.raw_adas_trigger]
        prox = self._proximity_score(frame.lateral_proximity)
        sig = self._sigma_score()

        # Weighted blend: trigger (40%) + proximity (40%) + sigma (20%).
        conf = 0.40 * trigger_lift + 0.40 * prox + 0.20 * sig

        if frame.vehicle_speed > 60:
            conf = min(1.0, conf + 0.05)

        return max(0.0, min(1.0, conf))

    # -- public API -----------------------------------------------------

    def process(self, frame: CANFrame) -> HMIState:
        # Maintain rolling brake-pressure history.
        self._brake_window.append(frame.brake_pressure)

        if self._driver_already_braking(frame):
            return HMIState(
                tier=0, confidence=0.0, ring_color="green",
                haptic=False, audio=False,
                message="Driver in control",
            )

        conf = self._base_confidence(frame)

        throttle_level, reason = self.filter.evaluate(
            AlertEvent(
                timestamp=frame.timestamp,
                trigger_class="FCW" if frame.raw_adas_trigger >= 2 else "LKA",
                vehicle_speed=frame.vehicle_speed,
                severity_hint=frame.raw_adas_trigger,
            )
        )

        if self.profile.is_aggressive:
            conf_threshold_t1 = 0.55
            conf_threshold_t2 = 0.95
        else:
            conf_threshold_t1 = 0.40
            conf_threshold_t2 = 0.85

        effective_threshold_t2 = conf_threshold_t2
        if throttle_level == 1:
            effective_threshold_t2 = 1.01  # block Tier 2 when throttled

        if conf <= 0.05:
            tier, color, haptic, audio, msg = 0, "green", False, False, "All clear"
        elif conf < conf_threshold_t1:
            tier, color, haptic, audio, msg = 0, "green", False, False, "Holding back"
        elif conf < effective_threshold_t2:
            tier, color, haptic, audio, msg = 1, "amber", True, False, "Suggestive"
        else:
            tier, color, haptic, audio, msg = 2, "red", True, True, "Imminent"

        suppressed: Optional[str] = None
        if throttle_level == 1 and frame.raw_adas_trigger >= 2:
            suppressed = reason

        return HMIState(
            tier=tier,
            confidence=round(conf, 3),
            ring_color=color,
            haptic=haptic,
            audio=audio,
            message=msg,
            suppressed_reason=suppressed,
        )


__all__ = [
    "CANFrame",
    "DriverProfile",
    "HMIState",
    "AGGRESSIVE_DRIVER",
    "CAUTIOUS_DRIVER",
    "ConfidenceEngine",
]
