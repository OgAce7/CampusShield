"""
Hostel Outbreak Radar - Backend
Minimal FastAPI + SQLite skeleton for hackathon project.

Implements:
- GET /health
- POST /reports, GET /reports
- POST /meals, GET /meals
- GET /blocks
- GET /dashboard/overview, /dashboard/blocks, /dashboard/alerts,
  /dashboard/sources (outbreak detection + source attribution, wired to
  live SQLite data via analysis_bridge.py - see dashboard.py)

Intentionally NOT implemented (future work):
- notifications
- authentication
- real maps / GIS
"""

from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import database
from dashboard import router as dashboard_router
from models import ReportCreate, ReportOut, MealCreate, MealOut, BlockOut

app = FastAPI(
    title="Hostel Outbreak Radar API",
    description="Backend for tracking hostel/mess symptom and meal reports.",
    version="0.1.0",
)

# Allow the Vite dev server (default port 5173) to call this API during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(dashboard_router)


@app.on_event("startup")
def on_startup():
    database.init_db()


@app.get("/health")
def health_check():
    """Basic health check endpoint used by the frontend and for smoke testing."""
    return {"status": "ok", "service": "hostel-outbreak-radar-backend"}


@app.get("/")
def root():
    return {"message": "Hostel Outbreak Radar API. See /docs for available endpoints."}


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

@app.post("/reports", response_model=ReportOut, status_code=201)
def create_report(report: ReportCreate):
    now = datetime.now(timezone.utc).isoformat()
    payload = report.model_dump()
    payload["onset_time"] = report.onset_time.isoformat()
    payload["report_time"] = now

    report_id = database.insert_report(payload)

    return ReportOut(
        report_id=report_id,
        anonymous_student_id=payload["anonymous_student_id"],
        block=payload["block"],
        symptoms=payload["symptoms"],
        severity=payload["severity"],
        onset_time=payload["onset_time"],
        report_time=payload["report_time"],
        food_exposure=payload.get("food_exposure"),
    )


@app.get("/reports", response_model=list[ReportOut])
def list_reports():
    return database.get_all_reports()


# ---------------------------------------------------------------------------
# Meals
# ---------------------------------------------------------------------------

@app.post("/meals", response_model=MealOut, status_code=201)
def create_meal(meal: MealCreate):
    payload = meal.model_dump()
    meal_id = database.insert_meal(payload)

    return MealOut(
        meal_id=meal_id,
        mess=payload["mess"],
        date=payload["date"],
        meal_type=payload["meal_type"],
        food_items=payload["food_items"],
    )


@app.get("/meals", response_model=list[MealOut])
def list_meals():
    return database.get_all_meals()


# ---------------------------------------------------------------------------
# Blocks
# ---------------------------------------------------------------------------

@app.get("/blocks", response_model=list[BlockOut])
def list_blocks():
    return database.get_all_blocks()
