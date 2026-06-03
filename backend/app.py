import asyncio
import csv
import time
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from confidence_engine import (
    CANFrame,
    ConfidenceEngine,
    AGGRESSIVE_DRIVER,
    CAUTIOUS_DRIVER,
)

app = FastAPI(title="Nivāra Telemetry")

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://frontend:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

CURRENT_PROFILE = AGGRESSIVE_DRIVER
engine = ConfidenceEngine(CURRENT_PROFILE)
CLIENTS: set = set()
CSV_PATH = Path(__file__).resolve().parent.parent / "data" / "can_synthetic" / "city_bumper_to_bumper.csv"


def _parse_row(row: dict, t0: float) -> CANFrame:
    return CANFrame(
        timestamp=t0 + float(row["timestamp"]),
        vehicle_speed=float(row["vehicle_speed"]),
        brake_pressure=float(row["brake_pressure"]),
        lateral_proximity=float(row["lateral_proximity"]),
        raw_adas_trigger=int(row["raw_adas_trigger"]),
    )


async def _stream_can(csv_path: Path) -> AsyncIterator[CANFrame]:
    t0 = time.time()
    with csv_path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            yield _parse_row(row, t0)
            await asyncio.sleep(0.1)


async def _broadcast(payload: dict) -> None:
    dead: list = []
    for ws in CLIENTS:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        CLIENTS.discard(ws)


async def _telemetry_loop() -> None:
    while True:
        async for frame in _stream_can(CSV_PATH):
            state = engine.process(frame)
            await _broadcast({
                "ts": frame.timestamp,
                "speed": frame.vehicle_speed,
                "brake": frame.brake_pressure,
                "lateral": frame.lateral_proximity,
                "tier": state.tier,
                "confidence": state.confidence,
                "ring_color": state.ring_color,
                "haptic": state.haptic,
                "audio": state.audio,
                "message": state.message,
                "suppressed": state.suppressed_reason,
            })
        await asyncio.sleep(1.0)


@app.on_event("startup")
async def _startup() -> None:
    asyncio.create_task(_telemetry_loop())


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "clients": len(CLIENTS)}


@app.post("/profile/{name}")
async def set_profile(name: str) -> dict:
    global engine
    if name == "aggressive":
        engine = ConfidenceEngine(AGGRESSIVE_DRIVER)
    elif name == "cautious":
        engine = ConfidenceEngine(CAUTIOUS_DRIVER)
    else:
        return {"error": "unknown profile"}
    return {"profile": name}


@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket) -> None:
    origin = ws.headers.get("origin", "")
    if origin not in ALLOWED_ORIGINS:
        await ws.close(code=1008)
        return
    await ws.accept()
    CLIENTS.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        CLIENTS.discard(ws)
