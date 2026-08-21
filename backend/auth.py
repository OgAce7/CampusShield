"""
Hostel Outbreak Radar - Auth (hackathon-simple)

Deliberately NOT real authentication:
- No passwords, no password hashing.
- No JWT, no OAuth.
- Sessions are a plain in-memory dict (module-level `SESSIONS`), not a
  database table. They vanish on server restart - that's fine, this only
  needs to survive one demo session.
- A token is just a random opaque string; anyone with the token has that
  role for the rest of the demo. There is no expiry, no refresh, no logout
  invalidation beyond the process dict.

This exists purely to let the frontend show a student view vs a clinic
view, and to keep student-submitted reports from being readable by other
students. It is not a security boundary in any real sense.

Usage:
    from auth import require_role, get_current_role, get_current_session

    @app.get("/reports", dependencies=[Depends(require_role("clinic"))])
    def list_reports(): ...

    @app.get("/me")
    def me(role: str = Depends(get_current_role)):
        return {"role": role}
"""

import secrets

from fastapi import Depends, Header, HTTPException

VALID_ROLES = ("student", "clinic")

# token -> {"name": str, "role": str}. In-memory only, per the spec above.
SESSIONS: dict[str, dict] = {}


def create_session(name: str, role: str) -> str:
    """Mint a new session token for (name, role) and store it. Returns the token."""
    if role not in VALID_ROLES:
        raise ValueError(f"role must be one of {VALID_ROLES}")
    token = secrets.token_urlsafe(24)
    SESSIONS[token] = {"name": name, "role": role}
    return token


def get_current_session(x_session_token: str | None = Header(default=None)) -> dict:
    """
    FastAPI dependency: reads the X-Session-Token header, looks it up in
    the in-memory SESSIONS dict, and returns {"name", "role"}. 401s if the
    header is missing or the token isn't recognized (e.g. server restarted
    since login, or the client never logged in).
    """
    if not x_session_token:
        raise HTTPException(status_code=401, detail="Missing X-Session-Token header. Call POST /login first.")

    session = SESSIONS.get(x_session_token)
    if session is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session token. Call POST /login again.")

    return session


def get_current_role(session: dict = Depends(get_current_session)) -> str:
    """
    FastAPI dependency: same as get_current_session but returns just the
    role string, for handlers that only care about the role (e.g. GET /me).
    Any authenticated session (student or clinic) satisfies this - it does
    NOT restrict by role. Use require_role() for that.
    """
    return session["role"]


def require_role(required_role: str):
    """
    FastAPI dependency factory: use as
        dependencies=[Depends(require_role("clinic"))]
    on a route to restrict it to a single role. 403s (not 401 - the caller
    IS authenticated, they just don't have the right role) if the session's
    role doesn't match.
    """
    if required_role not in VALID_ROLES:
        raise ValueError(f"required_role must be one of {VALID_ROLES}")

    def _check(session: dict = Depends(get_current_session)) -> dict:
        if session["role"] != required_role:
            raise HTTPException(
                status_code=403,
                detail=f"This endpoint is restricted to '{required_role}' accounts.",
            )
        return session

    return _check