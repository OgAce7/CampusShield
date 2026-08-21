"""
Hostel Outbreak Radar - Backend
Minimal FastAPI skeleton for hackathon project.

Only implements:
- GET /health

Intentionally NOT implemented (future work):
- outbreak detection logic
- ML / anomaly scoring
- database persistence
- notifications
- authentication
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Hostel Outbreak Radar API",
    description="Backend skeleton for tracking hostel/mess activity signals.",
    version="0.0.1",
)

# Allow the Vite dev server (default port 5173) to call this API during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    """Basic health check endpoint used by the frontend and for smoke testing."""
    return {"status": "ok", "service": "hostel-outbreak-radar-backend"}


@app.get("/")
def root():
    return {"message": "Hostel Outbreak Radar API. See /docs for available endpoints."}
