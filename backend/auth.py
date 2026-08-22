"""
Auth module for Hostel Outbreak Radar backend.

Hackathon-simple by design (see main.py's module docstring): no passwords,
no JWT, no DB-backed sessions. A caller "logs in" with just a display name
and a role, and gets back an opaque session token to send back on later
requests as the X-Session-Token header. Sessions live in memory and are
lost on server restart - that's intentional for this skeleton phase.

Usage (already wired up in main.py):

    import auth

    @app.post("/login")
    def login(credentials: LoginRequest):
        token = auth.create_session(name=credentials.name, role=credentials.role)
        ...

    @app.get("/reports", dependencies=[Depends(auth.require_role("clinic"))])
    def list_reports():
        ...

    @app.get("/meals", dependencies=[Depends(auth.get_current_session)])
    def list_meals():
        ...
"""

import secrets
from typing import Dict

from fastapi import Depends, Header, HTTPException, status

VALID_ROLES = ["student", "clinic"]

# session_token -> {"name": str, "role": str}
# In-memory only - fine at hackathon scale, resets on every server restart.
_SESSIONS: Dict[str, dict] = {}


def create_session(name: str, role: str) -> str:
    """Mint a new opaque session token for (name, role) and remember it."""
    token = secrets.token_urlsafe(32)
    _SESSIONS[token] = {"name": name, "role": role}
    return token


def get_current_session(
    x_session_token: str = Header(..., alias="X-Session-Token"),
) -> dict:
    """
    FastAPI dependency: resolves the X-Session-Token header to a session
    dict ({"name": ..., "role": ...}), or 401s if it's missing/unknown.
    Use this directly for endpoints that just require *any* logged-in
    caller, regardless of role.
    """
    session = _SESSIONS.get(x_session_token)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing session token",
        )
    return session


def require_role(role: str):
    """
    FastAPI dependency factory: like get_current_session, but additionally
    403s if the caller's role doesn't match `role`.

        dependencies=[Depends(auth.require_role("student"))]
    """
    if role not in VALID_ROLES:
        raise ValueError(f"require_role() called with unknown role '{role}', must be one of {VALID_ROLES}")

    def _dependency(session: dict = Depends(get_current_session)) -> dict:
        if session["role"] != role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This endpoint requires the '{role}' role",
            )
        return session

    return _dependency


def clear_sessions() -> None:
    """Exposed mainly for tests - drops every active session."""
    _SESSIONS.clear()