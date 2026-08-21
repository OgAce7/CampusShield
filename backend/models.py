"""
Pydantic models for validating request/response data.
"""

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator

from auth import VALID_ROLES
from schema import ALL_BLOCKS, FOOD_EXPOSURES, MESS_OPTIONS

SEVERITY_LEVELS = ["mild", "moderate", "severe"]
MEAL_TYPES = ["breakfast", "lunch", "snacks", "dinner"]


# ---------------------------------------------------------------------------
# Auth (hackathon-simple - see auth.py)
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    role: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"role must be one of {VALID_ROLES}")
        return v


class LoginResponse(BaseModel):
    session_token: str
    name: str
    role: str


class MeResponse(BaseModel):
    name: str
    role: str


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

class ReportCreate(BaseModel):
    anonymous_student_id: str = Field(..., min_length=1, max_length=100)
    block: str
    symptoms: List[str] = Field(..., min_length=1)
    severity: str
    onset_time: datetime
    food_exposure: Optional[str] = None

    @field_validator("block")
    @classmethod
    def validate_block(cls, v: str) -> str:
        if v not in ALL_BLOCKS:
            raise ValueError(f"block must be one of {ALL_BLOCKS}")
        return v

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: str) -> str:
        if v not in SEVERITY_LEVELS:
            raise ValueError(f"severity must be one of {SEVERITY_LEVELS}")
        return v

    @field_validator("food_exposure")
    @classmethod
    def validate_food_exposure(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in FOOD_EXPOSURES:
            raise ValueError(f"food_exposure must be one of {FOOD_EXPOSURES}")
        return v


class ReportOut(BaseModel):
    report_id: int
    anonymous_student_id: str
    block: str
    symptoms: List[str]
    severity: str
    onset_time: str
    report_time: str
    food_exposure: Optional[str] = None


# ---------------------------------------------------------------------------
# Meals
# ---------------------------------------------------------------------------

class MealCreate(BaseModel):
    mess: str
    date: str  # ISO date string, e.g. "2026-08-22"
    meal_type: str
    food_items: List[str] = Field(..., min_length=1)

    @field_validator("mess")
    @classmethod
    def validate_mess(cls, v: str) -> str:
        if v not in MESS_OPTIONS:
            raise ValueError(f"mess must be one of {MESS_OPTIONS}")
        return v

    @field_validator("meal_type")
    @classmethod
    def validate_meal_type(cls, v: str) -> str:
        if v not in MEAL_TYPES:
            raise ValueError(f"meal_type must be one of {MEAL_TYPES}")
        return v

    @field_validator("date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        try:
            datetime.fromisoformat(v)
        except ValueError:
            raise ValueError("date must be an ISO format date, e.g. 2026-08-22")
        return v


class MealOut(BaseModel):
    meal_id: int
    mess: str
    date: str
    meal_type: str
    food_items: List[str]


# ---------------------------------------------------------------------------
# Blocks
# ---------------------------------------------------------------------------

class BlockOut(BaseModel):
    block_id: str
    gender: str
    capacity: int