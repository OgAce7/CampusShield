"""
Hostel Outbreak Radar - Backend
Minimal FastAPI + SQLite skeleton for hackathon project.

Implements:
- GET /health
- POST /login, GET /me (hackathon-simple role auth - see auth.py)
- POST /reports (student only), GET /reports (clinic only)
- POST /meals (clinic only), GET /meals (student or clinic)
- GET /blocks (student or clinic)
- GET /dashboard/overview, /dashboard/blocks, /dashboard/alerts,
  /dashboard/sources (outbreak detection + source attribution, wired to
  live SQLite data via analysis_bridge.py - see dashboard.py)

Intentionally NOT implemented (future work):
- notifications
- real authentication (passwords, JWT, OAuth, DB-backed sessions)
- real maps / GIS
"""

from datetime import datetime, timezone

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

import auth
import database
from dashboard import router as dashboard_router
from models import (
    BlockOut,
    LoginRequest,
    LoginResponse,
    MealCreate,
    MealOut,
    MeResponse,
    ReportCreate,
    ReportOut,
)

app = FastAPI(
    title="Hostel Outbreak Radar API",
    description="Backend for tracking hostel/mess symptom and meal reports.",
    version="0.1.0",
)

# Allow the Vite dev server (default port 5173) to call this API during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "https://campus-shield-ecru.vercel.app/"],
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
# Auth (hackathon-simple - see auth.py: no passwords, no JWT, in-memory only)
# ---------------------------------------------------------------------------

@app.post("/login", response_model=LoginResponse)
def login(credentials: LoginRequest):
    """
    Hackathon-simple "login": pick a name and a role, get back an opaque
    session token. No password. Send the token back on later requests as
    the X-Session-Token header.
    """
    token = auth.create_session(name=credentials.name, role=credentials.role)
    return LoginResponse(session_token=token, name=credentials.name, role=credentials.role)


@app.get("/me", response_model=MeResponse)
def me(session: dict = Depends(auth.get_current_session)):
    """Returns the caller's name and role, so the frontend knows which view to render."""
    return MeResponse(name=session["name"], role=session["role"])


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

@app.post(
    "/reports",
    response_model=ReportOut,
    status_code=201,
    dependencies=[Depends(auth.require_role("student"))],
)
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


@app.get(
    "/reports",
    response_model=list[ReportOut],
    dependencies=[Depends(auth.require_role("clinic"))],
)
def list_reports():
    return database.get_all_reports()


# ---------------------------------------------------------------------------
# Meals
# ---------------------------------------------------------------------------

@app.post(
    "/meals",
    response_model=MealOut,
    status_code=201,
    dependencies=[Depends(auth.require_role("clinic"))],
)
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


@app.get(
    "/meals",
    response_model=list[MealOut],
    dependencies=[Depends(auth.get_current_session)],
)
def list_meals():
    return database.get_all_meals()


# ---------------------------------------------------------------------------
# Blocks
# ---------------------------------------------------------------------------

@app.get(
    "/blocks",
    response_model=list[BlockOut],
    dependencies=[Depends(auth.get_current_session)],
)
def list_blocks():
    return database.get_all_blocks()