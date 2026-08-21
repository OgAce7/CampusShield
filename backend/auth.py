"""
Auth module for Hostel Outbreak Radar backend.

Drop this into /backend as auth.py, then in main.py:

    from auth import router as auth_router, get_current_staff
    app.include_router(auth_router)

Protect any endpoint with:

    @app.get("/reports")
    def list_reports(staff = Depends(get_current_staff)):
        ...

Install deps:
    pip install "python-jose[cryptography]" "passlib[bcrypt]" python-multipart

This is a minimal reference implementation for a hackathon demo:
- Staff accounts are hardcoded in STAFF_DB below (swap for a real table later).
- JWT secret is read from an env var with a dev fallback — set OUTBREAK_RADAR_SECRET
  in production.
- Tokens expire after 8 hours (one shift).
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

SECRET_KEY = os.environ.get("OUTBREAK_RADAR_SECRET", "dev-only-secret-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 8 * 60

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")

router = APIRouter(prefix="/auth", tags=["auth"])


# --- demo staff directory -----------------------------------------------
# Replace with a real users table. Passwords below are bcrypt hashes of
# "changeme123" — force a reset before using this beyond a hackathon demo.
STAFF_DB = {
    "HD-0231": {
        "staff_id": "HD-0231",
        "name": "Health Desk Staff",
        "role": "health_staff",
        "hashed_password": pwd_context.hash("changeme123"),
    },
}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    staff_id: str
    role: str


class StaffOut(BaseModel):
    staff_id: str
    name: str
    role: str


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def authenticate_staff(staff_id: str, password: str):
    staff = STAFF_DB.get(staff_id)
    if not staff or not verify_password(password, staff["hashed_password"]):
        return None
    return staff


def create_access_token(data: dict, expires_minutes: int = ACCESS_TOKEN_EXPIRE_MINUTES) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    staff = authenticate_staff(form_data.username, form_data.password)
    if not staff:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect staff ID or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token({"sub": staff["staff_id"], "role": staff["role"]})
    return Token(access_token=token, staff_id=staff["staff_id"], role=staff["role"])


def get_current_staff(token: str = Depends(oauth2_scheme)) -> StaffOut:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        staff_id: Optional[str] = payload.get("sub")
        role: Optional[str] = payload.get("role")
        if staff_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    staff = STAFF_DB.get(staff_id)
    if staff is None:
        raise credentials_exception

    return StaffOut(staff_id=staff["staff_id"], name=staff["name"], role=role or staff["role"])


@router.get("/me", response_model=StaffOut)
def read_current_staff(current=Depends(get_current_staff)):
    return current