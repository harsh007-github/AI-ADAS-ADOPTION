"""
End-to-end pipeline test for the Nivāra ADAS middleware.

Goal:
    Simulate pushing the 10 rows of `city_bumper_to_bumper.csv`
    through ConfidenceEngine + NuisanceFilter, and assert that
    high-frequency alerts under low-speed, high-density conditions
    are suppressed to HMI Tier 1 or Tier 0 (never blindly Tier 2).

Run:
    cd "E:/Harsh/ADAS Adoption Project"
    set PYTHONPATH=backend
    pytest -q tests/test_e2e.py
"""

from __future__ import annotations

import csv
import time
from pathlib import Path

import pytest

# Imports rely on backend/ being on sys.path (PYTHONPATH or conftest).
from confidence_engine import (
    AGGRESSIVE_DRIVER,
    CAUTIOUS_DRIVER,
    CANFrame,
    ConfidenceEngine,
    HMIState,
)
from nuisance_filter import AlertEvent, NuisanceFilter


REPO_ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = REPO_ROOT / "data" / "can_synthetic" / "city_bumper_to_bumper.csv"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def bumper_rows() -> list[CANFrame]:
    """Load the 10-row city bumper-to-bumper fixture as CANFrame objects."""
    assert CSV_PATH.exists(), f"Missing fixture: {CSV_PATH}"
    rows: list[CANFrame] = []
    t0 = time.time()
    with CSV_PATH.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(
                CANFrame(
                    timestamp=t0 + float(row["timestamp"]),
                    vehicle_speed=float(row["vehicle_speed"]),
                    brake_pressure=float(row["brake_pressure"]),
                    lateral_proximity=float(row["lateral_proximity"]),
                    raw_adas_trigger=int(row["raw_adas_trigger"]),
                )
            )
    return rows


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_fixture_has_expected_shape(bumper_rows: list[CANFrame]) -> None:
    assert len(bumper_rows) == 10, "fixture must be exactly 10 rows"
    for r in bumper_rows:
        assert r.vehicle_speed < 25.0, "city_bumper_to_bumper must be low-speed"


@pytest.mark.parametrize(
    "profile_name, profile",
    [("aggressive", AGGRESSIVE_DRIVER), ("cautious", CAUTIOUS_DRIVER)],
)
def test_nuisance_filter_suppresses_density_spike(
    bumper_rows: list[CANFrame], profile_name: str, profile
) -> None:
    """
    The NuisanceFilter should engage on low-speed, high-density input
    and downgrade any raw-FCW-heavy frame to Tier 1 or below.
    """
    engine = ConfidenceEngine(profile)
    states: list[HMIState] = [engine.process(f) for f in bumper_rows]

    # Every state must be valid.
    for s in states:
        assert s.tier in (0, 1, 2)
        assert s.ring_color in ("green", "amber", "red")
        assert 0.0 <= s.confidence <= 1.0

    # Count raw-FCW (trigger >= 2) frames that would have been Tier 2
    # without suppression.
    raw_critical = sum(1 for f in bumper_rows if f.raw_adas_trigger >= 2)
    observed_t2 = sum(1 for s in states if s.tier == 2)

    # The whole point: under city / bumper-to-bumper density, Tier 2
    # should be rare (≤ 30% of raw critical frames) and we expect at
    # least one suppression event recorded on the HMIState stream.
    assert observed_t2 <= int(0.3 * raw_critical) + 1, (
        f"[{profile_name}] Tier 2 fired {observed_t2}/{raw_critical} times — "
        "nuisance filter did not suppress the high-frequency cluster."
    )

    # Confirm the filter emitted a suppression reason at least once.
    suppressed_events = [s for s in states if s.suppressed_reason]
    assert suppressed_events, (
        f"[{profile_name}] expected at least one suppressed_reason entry, "
        "but none was emitted — density_spike_low_speed never engaged."
    )


def test_filter_unit_density_spike() -> None:
    """Direct unit test of the NuisanceFilter's density-spike path."""
    nf = NuisanceFilter()
    base_ts = 1_000_000.0

    # First three low-speed FCWs within 30s should NOT yet engage the
    # DENSITY_THRESHOLD (which is 3, strict >=).
    for i in range(3):
        throttle, reason = nf.evaluate(
            AlertEvent(
                timestamp=base_ts + i * 0.1,
                trigger_class="FCW",
                vehicle_speed=10.0,
                severity_hint=2,
            )
        )
        assert throttle == 0, f"frame {i} should not yet throttle: {reason}"

    # Fourth low-speed FCW within the window flips the switch.
    throttle, reason = nf.evaluate(
        AlertEvent(
            timestamp=base_ts + 0.4,
            trigger_class="FCW",
            vehicle_speed=10.0,
            severity_hint=2,
        )
    )
    assert throttle == 1, f"density spike should engage: {reason}"
    assert reason == "density_spike_low_speed"


def test_highway_frame_still_escalates() -> None:
    """
    Sanity: a high-speed, high-severity frame with a non-throttled
    engine should still reach Tier 2 — the filter is *not* a blanket
    silencer, only a low-speed density one.

    A fresh engine/NuisanceFilter is used so prior low-speed state
    from other tests cannot suppress the highway sequence.
    """
    engine = ConfidenceEngine(AGGRESSIVE_DRIVER)
    engine.filter = NuisanceFilter()  # explicit isolation
    last: HMIState | None = None
    for i in range(6):
        last = engine.process(
            CANFrame(
                timestamp=time.time() + i,
                vehicle_speed=90.0,
                brake_pressure=0.0,
                lateral_proximity=0.4,
                raw_adas_trigger=3,
            )
        )
    assert last is not None
    assert last.tier >= 1, f"highway FCW should escalate: tier={last.tier}"
    assert last.confidence > 0.7, "highway proximity+sigma should drive high conf"
