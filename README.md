# Nivāra — ADAS Middleware MVP

Real-time Advanced Driver Assistance Systems middleware for HMI confidence estimation, nuisance alert filtering, and driver-adaptive telemetry.

## Architecture Pivot

The MVP originally targeted an XGBoost-based confidence model, but `xgboost` wheel compilation failed consistently on Windows (win32). The architecture was pivoted to a **deterministic math-heuristic** engine that blends brake-pressure variance, lateral proximity scoring, and driver-profile thresholds. Zero native-compiled dependencies — the entire stack runs on CPython stdlib + FastAPI.

## Local Development

### Backend
```bash
cd backend
pip install -r ../requirements.txt
uvicorn app:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Tests
```bash
set PYTHONPATH=backend
pytest -q tests/
```

### Docker
```bash
docker compose up --build
```
