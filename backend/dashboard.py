"""
Hostel Outbreak Radar - Dashboard API

Read-only endpoints that expose the /analysis modules (outbreak_engine.py,
source_attribution.py) over HTTP, computed live from the SQLite database:

    GET /dashboard/overview   campus-wide summary
    GET /dashboard/blocks     per-block risk score for all 20 blocks
    GET /dashboard/alerts     blocks at WATCH or above, sorted by risk
    GET /dashboard/sources    food-source attribution for flagged blocks

No detection or attribution logic lives here - this module only calls
analysis_bridge (which runs outbreak_engine / source_attribution against
live DB data) and shapes the results into predictable response models.

No authentication, no LLM, no GIS/maps - matches the rest of this
hackathon skeleton.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

import analysis_bridge
import auth
from dashboard_models import (
    Alert,
    BlockRisk,
    BlockSourceAttribution,
    BlockTrend,
    DashboardAlerts,
    DashboardOverview,
    DashboardSources,
    ExposureStat,
    HighestRiskBlock,
    SuspectedFoodSource,
)
from schema import ALL_BLOCKS

# Clinic-only: every /dashboard/* route requires a logged-in clinic session.
# Applied at the router level so new routes are protected by default rather
# than needing to remember the dependency on each new endpoint.
router = APIRouter(
    prefix="/dashboard",
    tags=["dashboard"],
    dependencies=[Depends(auth.require_role("clinic"))],
)

FLAGGED_SEVERITIES = ("WATCH", "SUSPECTED", "PROBABLE")
ALERT_SEVERITIES = ("WATCH", "SUSPECTED", "PROBABLE")
SOURCE_ATTRIBUTION_SEVERITIES = ("SUSPECTED", "PROBABLE")  # blocks worth running attribution on by default


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _block_to_risk_model(result: dict) -> BlockRisk:
    return BlockRisk(
        block_id=result["block"],
        gender=analysis_bridge.BLOCK_GENDER[result["block"]],
        current_cases=result["current_cases"],
        baseline_cases=result["baseline_cases"],
        risk_score=result["risk_score"],
        severity=result["severity"],
        dominant_symptoms=result["dominant_symptoms"],
        common_exposure=result["common_exposure"],
        trend=BlockTrend(
            growth_factor=result["growth_factor"],
            description=result["growth_trend"],
        ),
        explanation=result["reasons"],
    )


def _exposure_dict_to_model(exposure: dict) -> ExposureStat:
    return ExposureStat(**exposure)


def _attribution_dict_to_model(attribution: dict) -> BlockSourceAttribution:
    exposures = [_exposure_dict_to_model(e) for e in attribution["exposures"]]
    top = _exposure_dict_to_model(attribution["top_suspected_exposure"]) if attribution["top_suspected_exposure"] else None
    return BlockSourceAttribution(
        block_id=attribution["block"],
        affected_total=attribution["affected_total"],
        exposures=exposures,
        top_suspected_exposure=top,
        disclaimer=attribution["disclaimer"],
    )


# ---------------------------------------------------------------------------
# GET /dashboard/blocks
# ---------------------------------------------------------------------------

@router.get("/blocks", response_model=list[BlockRisk])
def get_blocks():
    """
    Per-block risk breakdown for all 20 campus blocks (B01-B12, G01-G08),
    always returned in full regardless of severity - NORMAL blocks are
    included so the frontend can render every block on the grid.
    """
    results = analysis_bridge.run_detection()
    by_block = {r["block"]: r for r in results}
    # run_detection() already covers every block, but rebuild in the fixed
    # campus order (B01..B12, G01..G08) rather than risk-score order, since
    # this endpoint is meant to back a fixed block grid, not a ranking.
    return [_block_to_risk_model(by_block[b]) for b in ALL_BLOCKS]


# ---------------------------------------------------------------------------
# GET /dashboard/overview
# ---------------------------------------------------------------------------

@router.get("/overview", response_model=DashboardOverview)
def get_overview():
    """Campus-wide summary: aggregate case counts, deviation from baseline,
    the single highest-risk block, and a top-line suspected food source
    (attribution run against the highest-risk flagged block, if any)."""
    results = analysis_bridge.run_detection()

    total_active_cases = sum(r["current_cases"] for r in results)
    total_baseline = sum(r["baseline_cases"] for r in results)
    campus_baseline = round(total_baseline / len(results), 2) if results else 0.0

    if total_baseline > 0:
        baseline_deviation_pct = round(100 * (total_active_cases - total_baseline) / total_baseline, 1)
    else:
        # No historical baseline to compare against (e.g. brand-new
        # dataset) - 0% rather than a divide-by-zero or misleading +inf.
        baseline_deviation_pct = 0.0

    cases_today = _count_cases_on_latest_date()

    highest_risk_block = None
    if results and results[0]["current_cases"] > 0:
        top = results[0]
        highest_risk_block = HighestRiskBlock(
            block_id=top["block"], risk_score=top["risk_score"], severity=top["severity"]
        )

    watch_block_count = sum(1 for r in results if r["severity"] == "WATCH")
    suspected_or_probable_count = sum(1 for r in results if r["severity"] in ("SUSPECTED", "PROBABLE"))

    suspected_food_source = _top_suspected_food_source(results)

    return DashboardOverview(
        total_active_cases=total_active_cases,
        cases_today=cases_today,
        campus_baseline=campus_baseline,
        baseline_deviation_pct=baseline_deviation_pct,
        highest_risk_block=highest_risk_block,
        watch_block_count=watch_block_count,
        suspected_or_probable_count=suspected_or_probable_count,
        suspected_food_source=suspected_food_source,
    )


def _count_cases_on_latest_date() -> int:
    """
    'Cases today' is defined relative to the most recent onset date present
    in the data, not the server's wall-clock date - the demo dataset is
    dated in the past/near-present, and anchoring to real wall-clock 'today'
    would make this always read 0 outside of live data collection.
    """
    reports_df = analysis_bridge.reports_df_from_db()
    if reports_df.empty:
        return 0
    latest_date = reports_df["onset_time"].dt.date.max()
    return int((reports_df["onset_time"].dt.date == latest_date).sum())


def _top_suspected_food_source(results: list[dict]) -> SuspectedFoodSource | None:
    """Run source attribution against the single highest-risk block that
    has reached SUSPECTED or PROBABLE, and surface its top exposure as the
    campus-wide headline suspected food source. Returns None if no block
    has reached that threshold, or if attribution found no association."""
    flagged = [r for r in results if r["severity"] in SOURCE_ATTRIBUTION_SEVERITIES]
    if not flagged:
        return None

    top_block = flagged[0]["block"]  # results is already sorted by risk_score descending
    attribution = analysis_bridge.run_attribution(top_block)
    top_exposure = attribution["top_suspected_exposure"]
    if not top_exposure:
        return None

    return SuspectedFoodSource(
        block_id=top_block,
        exposure=top_exposure["exposure"],
        association=top_exposure["association"],
        affected_exposure_pct=top_exposure["affected_exposure_pct"],
        relative_risk=top_exposure["relative_risk"],
        disclaimer=attribution["disclaimer"],
    )


# ---------------------------------------------------------------------------
# GET /dashboard/alerts
# ---------------------------------------------------------------------------

@router.get("/alerts", response_model=DashboardAlerts)
def get_alerts():
    """Blocks currently at WATCH or above, sorted by risk score descending.
    NORMAL blocks are omitted entirely - this endpoint is meant to back an
    alert feed, not a full block grid (use /dashboard/blocks for that)."""
    results = analysis_bridge.run_detection()
    flagged = [r for r in results if r["severity"] in ALERT_SEVERITIES]

    alerts = [
        Alert(
            block_id=r["block"],
            gender=analysis_bridge.BLOCK_GENDER[r["block"]],
            severity=r["severity"],
            risk_score=r["risk_score"],
            current_cases=r["current_cases"],
            common_exposure=r["common_exposure"],
            explanation=r["reasons"],
        )
        for r in flagged  # already sorted by risk_score descending from run_detection()
    ]

    return DashboardAlerts(alert_count=len(alerts), alerts=alerts)


# ---------------------------------------------------------------------------
# GET /dashboard/sources
# ---------------------------------------------------------------------------

@router.get("/sources", response_model=DashboardSources)
def get_sources(
    block: str | None = Query(
        default=None,
        description="Run attribution for a single block regardless of its severity. "
                    "If omitted, attribution is run for every block currently at "
                    "SUSPECTED or PROBABLE.",
    ),
):
    """Food-source attribution (see source_attribution.py) for either a
    single requested block, or - by default - every block currently at
    SUSPECTED or PROBABLE. Every result carries the required
    'suspected association, not proof of causation' disclaimer."""
    if block is not None:
        if block not in ALL_BLOCKS:
            raise HTTPException(status_code=404, detail=f"Unknown block '{block}'. Must be one of {ALL_BLOCKS}.")
        target_blocks = [block]
    else:
        results = analysis_bridge.run_detection()
        target_blocks = [r["block"] for r in results if r["severity"] in SOURCE_ATTRIBUTION_SEVERITIES]

    block_attributions = [_attribution_dict_to_model(analysis_bridge.run_attribution(b)) for b in target_blocks]

    return DashboardSources(
        blocks=block_attributions,
        disclaimer=source_attribution_disclaimer(),
    )


def source_attribution_disclaimer() -> str:
    # Pulled from the analysis module itself so the two stay in sync rather
    # than duplicating the literal string here.
    import source_attribution
    return source_attribution.CAUSATION_DISCLAIMER