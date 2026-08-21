"""
Pydantic response models for the /dashboard/* endpoints.

Kept separate from models.py (which covers the raw /reports, /meals,
/blocks CRUD resources) since these are read-only, derived/computed views
rather than database resources.
"""

from typing import Optional

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# /dashboard/blocks
# ---------------------------------------------------------------------------

class BlockTrend(BaseModel):
    growth_factor: float          # ratio of recent cases to this block's own baseline (1.0 = flat)
    description: str              # e.g. "rapid case growth", "flat or declining case trend"


class BlockRisk(BaseModel):
    block_id: str
    gender: str                   # "boys" | "girls"
    current_cases: int            # cases in the recent (active) window
    baseline_cases: float         # this block's own historical baseline, scaled to the same window
    risk_score: int                # 0-100
    severity: str                  # NORMAL | WATCH | SUSPECTED | PROBABLE
    dominant_symptoms: list[str]
    common_exposure: str          # MESS_A | MESS_B | OUTSIDE_FOOD | NONE
    trend: BlockTrend
    explanation: list[str]        # human-readable reasons behind the score, priority order


# ---------------------------------------------------------------------------
# /dashboard/overview
# ---------------------------------------------------------------------------

class HighestRiskBlock(BaseModel):
    block_id: str
    risk_score: int
    severity: str


class SuspectedFoodSource(BaseModel):
    block_id: str                  # the block this attribution was run for (highest-risk flagged block)
    exposure: str                  # MESS_A | MESS_B | OUTSIDE_FOOD
    association: str               # HIGH | MODERATE | LOW
    affected_exposure_pct: float
    relative_risk: Optional[float] = None
    disclaimer: str


class DashboardOverview(BaseModel):
    total_active_cases: int         # sum of current_cases (recent window) across all blocks
    cases_today: int                # cases with onset on the most recent date present in the data
    campus_baseline: float          # average historical baseline cases per block, over the same window length
    baseline_deviation_pct: float   # (total_active_cases - total_baseline) / total_baseline, as a %
    highest_risk_block: Optional[HighestRiskBlock] = None
    watch_block_count: int
    suspected_or_probable_count: int
    suspected_food_source: Optional[SuspectedFoodSource] = None


# ---------------------------------------------------------------------------
# /dashboard/alerts
# ---------------------------------------------------------------------------

class Alert(BaseModel):
    block_id: str
    gender: str
    severity: str                  # WATCH | SUSPECTED | PROBABLE (NORMAL blocks never appear here)
    risk_score: int
    current_cases: int
    common_exposure: str
    explanation: list[str]


class DashboardAlerts(BaseModel):
    alert_count: int
    alerts: list[Alert]             # sorted by risk_score descending


# ---------------------------------------------------------------------------
# /dashboard/sources
# ---------------------------------------------------------------------------

class ExposureStat(BaseModel):
    exposure: str
    affected_exposed: int
    affected_total: int
    affected_exposure_pct: float
    population_exposed: int
    population_total: int
    population_exposure_pct: float
    relative_risk: Optional[float] = None
    odds_ratio: Optional[float] = None
    p_value: Optional[float] = None
    association: str                # HIGH | MODERATE | LOW | NONE
    median_onset_gap_hours: Optional[float] = None
    within_incubation_window_pct: Optional[float] = None
    low_confidence: bool
    notes: list[str]


class BlockSourceAttribution(BaseModel):
    block_id: str
    affected_total: int
    exposures: list[ExposureStat]   # ranked by relative risk (falls back to odds ratio) descending
    top_suspected_exposure: Optional[ExposureStat] = None
    disclaimer: str


class DashboardSources(BaseModel):
    blocks: list[BlockSourceAttribution]  # one entry per requested/flagged block
    disclaimer: str
