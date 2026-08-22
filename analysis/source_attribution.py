"""
Hostel Outbreak Radar - Source Attribution Module

Independent, deterministic, statistics-based module that asks a narrower
question than the outbreak_engine: GIVEN a block already suspected of an
outbreak, which food exposure (MESS_A / MESS_B / OUTSIDE_FOOD) is
disproportionately associated with the affected cases?

This is intentionally decoupled from outbreak_engine.py - it does not
import it and does not depend on its scoring. It only needs a block's
symptom reports (affected + everyone else, for the population baseline)
and, optionally, meal records for temporal compatibility checks.

Method, in plain terms:
  1. For each exposure category, build a 2x2 table:
        exposed & affected      | exposed & not-affected
        unexposed & affected    | unexposed & not-affected
  2. Compute relative risk (RR) and odds ratio (OR) from that table.
  3. Compute exposure % among affected cases vs exposure % among the
     broader population (all reports campus-wide, or a caller-supplied
     comparison population).
  4. Compute a Fisher's exact test p-value (SciPy) as a significance
     check on the 2x2 table - appropriate here because case counts per
     block are typically small (n < a few dozen), where Fisher's exact
     is more reliable than a chi-square approximation.
  5. If meal records are supplied, compute temporal compatibility: the
     gap in hours between the relevant mess's meal times and each
     affected student's symptom onset, and flag whether that gap falls
     inside a plausible incubation window for foodborne GI illness
     (here: 1-72 hours, deliberately wide to avoid ruling exposures out
     just because we don't know the true pathogen).
  6. Rank exposures by relative risk (falling back to odds ratio if RR
     is undefined) and label the top one HIGH / MODERATE / LOW / NONE
     association based on RR magnitude + statistical significance +
     minimum sample size - never on case count alone.

No LLM is used anywhere in this module. No medical or legal causation
claim is made - every result is explicitly labeled as an association,
not proof of causation.

Usage:
    from source_attribution import attribute_source

    result = attribute_source(
        reports_csv="../data/symptom_reports.csv",
        block="B05",
        meals_csv="../data/meals.csv",   # optional
    )
    print(result["summary"])
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.stats import fisher_exact

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FOOD_EXPOSURES = ["MESS_A", "MESS_B", "OUTSIDE_FOOD"]

# Symptom onset is considered a plausible match for a given meal if it
# falls within this many hours after the meal. Wide on purpose: many
# foodborne GI pathogens (norovirus, various bacterial toxins, etc.) span
# this whole range, and we'd rather be permissive than falsely rule an
# exposure out.
MIN_PLAUSIBLE_INCUBATION_HOURS = 1
MAX_PLAUSIBLE_INCUBATION_HOURS = 72

# Below this many affected cases in the block, statistics are unreliable
# and results are explicitly flagged as low-confidence rather than
# suppressed - this is a source-attribution helper, not a gatekeeper.
MIN_CASES_FOR_CONFIDENT_STATS = 3

RR_THRESHOLDS = [
    (3.0, "HIGH"),
    (1.5, "MODERATE"),
    (1.0, "LOW"),
]
SIGNIFICANCE_ALPHA = 0.05

CAUSATION_DISCLAIMER = "Suspected association - not proof of causation."


# ---------------------------------------------------------------------------
# Data classes for structured, explainable output
# ---------------------------------------------------------------------------

@dataclass
class ExposureStats:
    exposure: str
    affected_exposed: int
    affected_total: int
    affected_exposure_pct: float          # % of affected cases exposed
    population_exposed: int
    population_total: int
    population_exposure_pct: float        # % of broader population exposed
    relative_risk: float | None           # None if undefined (divide by zero)
    odds_ratio: float | None
    p_value: float | None
    association: str                      # HIGH / MODERATE / LOW / NONE
    median_onset_gap_hours: float | None = None
    within_incubation_window_pct: float | None = None
    low_confidence: bool = False
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "exposure": self.exposure,
            "affected_exposed": self.affected_exposed,
            "affected_total": self.affected_total,
            "affected_exposure_pct": round(self.affected_exposure_pct, 1),
            "population_exposed": self.population_exposed,
            "population_total": self.population_total,
            "population_exposure_pct": round(self.population_exposure_pct, 1),
            "relative_risk": round(self.relative_risk, 2) if self.relative_risk is not None else None,
            "odds_ratio": round(self.odds_ratio, 2) if self.odds_ratio is not None else None,
            "p_value": round(self.p_value, 4) if self.p_value is not None else None,
            "association": self.association,
            "median_onset_gap_hours": (
                round(self.median_onset_gap_hours, 1) if self.median_onset_gap_hours is not None else None
            ),
            "within_incubation_window_pct": (
                round(self.within_incubation_window_pct, 1)
                if self.within_incubation_window_pct is not None else None
            ),
            "low_confidence": self.low_confidence,
            "notes": self.notes,
        }


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

# meals.csv only records a `date` (day-level) plus a `meal_type` label, not
# an actual serving clock-time. To compute a meaningful onset-gap-in-hours
# for temporal compatibility, we anchor each meal_type to the midpoint of
# its typical serving window (matches data/generate_data.py's
# MEAL_TIME_WINDOWS) rather than defaulting to midnight - a dinner and a
# breakfast on the same day are otherwise indistinguishable, which silently
# corrupts every onset-gap calculation by up to ~20 hours.
MEAL_TYPE_CLOCK_TIME = {
    "breakfast": "08:00:00",
    "lunch": "13:00:00",
    "snacks": "17:00:00",
    "dinner": "20:00:00",
}
DEFAULT_MEAL_CLOCK_TIME = "12:00:00"  # fallback for any unrecognized meal_type


def load_reports(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    df["onset_time"] = pd.to_datetime(df["onset_time"], format="ISO8601")
    return df


def load_meals(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    df["datetime"] = _meal_datetime(df)
    return df


def _meal_datetime(meals_df: pd.DataFrame) -> pd.Series:
    """
    Build an actual serving datetime per meal record: `date` + a clock time
    derived from `meal_type` (see MEAL_TYPE_CLOCK_TIME), instead of
    collapsing every meal on a given day to midnight.
    """
    clock_times = meals_df["meal_type"].map(MEAL_TYPE_CLOCK_TIME).fillna(DEFAULT_MEAL_CLOCK_TIME)
    return pd.to_datetime(meals_df["date"].astype(str) + " " + clock_times)


# ---------------------------------------------------------------------------
# Core 2x2 statistics
# ---------------------------------------------------------------------------

def _two_by_two(affected_exposed, affected_unexposed, pop_exposed_extra, pop_unexposed_extra):
    """
    Build a 2x2 contingency table.

    affected_exposed / affected_unexposed: counts within the AFFECTED group.
    pop_exposed_extra / pop_unexposed_extra: counts of exposed/unexposed
        people in the comparison population who are NOT already counted in
        the affected group (i.e. the "non-cases").

    Table layout:
                     exposed          unexposed
        affected     a                b
        non-affected c                d
    """
    a = affected_exposed
    b = affected_unexposed
    c = pop_exposed_extra
    d = pop_unexposed_extra
    return a, b, c, d


def compute_relative_risk(a, b, c, d):
    """
    RR = risk of being affected among exposed / risk of being affected
    among unexposed.
      risk_exposed   = a / (a + c)
      risk_unexposed = b / (b + d)
    Returns None if undefined.
    """
    exposed_total = a + c
    unexposed_total = b + d
    if exposed_total == 0 or unexposed_total == 0:
        return None
    risk_exposed = a / exposed_total
    risk_unexposed = b / unexposed_total
    if risk_unexposed == 0:
        return None
    return risk_exposed / risk_unexposed


def compute_odds_ratio(a, b, c, d):
    """
    OR = (a/c) / (b/d) = (a*d) / (b*c), with a +0.5 continuity correction
    on all cells when any cell is 0, to avoid divide-by-zero while still
    producing an interpretable (if wide-uncertainty) number.
    """
    if 0 in (a, b, c, d):
        a, b, c, d = a + 0.5, b + 0.5, c + 0.5, d + 0.5
    denom = b * c
    if denom == 0:
        return None
    return (a * d) / denom


def compute_fisher_p(a, b, c, d) -> float:
    """
    Fisher's exact test on the 2x2 table [[a, b], [c, d]]. Chosen over
    chi-square because case counts within a single hostel block are
    typically small, where the chi-square approximation is unreliable.
    """
    table = [[a, b], [c, d]]
    _, p_value = fisher_exact(table, alternative="two-sided")
    return float(p_value)


def classify_association(rr: float | None, or_: float | None, p_value: float | None, n_affected: int) -> str:
    """
    Label association strength. Requires BOTH a meaningful effect size
    (RR, or OR as fallback when RR is undefined) AND minimum sample size
    to be labeled above NONE - matches the project's existing philosophy
    (outbreak_engine.py) of not letting a single weak signal drive the
    headline result.
    """
    effect = rr if rr is not None else or_
    if effect is None or n_affected < MIN_CASES_FOR_CONFIDENT_STATS:
        return "NONE"

    label = "NONE"
    for threshold, name in RR_THRESHOLDS:
        if effect >= threshold:
            label = name
            break

    # Statistical significance can only downgrade, never upgrade, a label -
    # a large but non-significant effect in a tiny sample is still worth
    # surfacing (that's the whole point of a hackathon early-warning tool),
    # just not overstated as HIGH.
    if p_value is not None and p_value >= SIGNIFICANCE_ALPHA and label == "HIGH":
        label = "MODERATE"

    return label


# ---------------------------------------------------------------------------
# Temporal compatibility
# ---------------------------------------------------------------------------

def compute_temporal_compatibility(
    affected_df: pd.DataFrame,
    exposure: str,
    meals_df: pd.DataFrame | None,
) -> tuple[float | None, float | None]:
    """
    For affected students exposed to `exposure`, compute the gap in hours
    between the nearest prior meal serving from that mess and the
    student's reported symptom onset. Returns (median_gap_hours,
    pct_within_plausible_incubation_window).

    Only meaningful for MESS_A / MESS_B (meals.csv has no per-serving data
    for OUTSIDE_FOOD, since it isn't campus-catered) and only when a meals
    dataframe is supplied.
    """
    if meals_df is None or exposure not in ("MESS_A", "MESS_B"):
        return None, None

    exposed_cases = affected_df[affected_df["food_exposure"] == exposure]
    if exposed_cases.empty:
        return None, None

    mess_meals = meals_df[meals_df["mess"] == exposure]
    if mess_meals.empty:
        return None, None

    meal_datetimes = mess_meals["datetime"].tolist()

    gaps_hours = []
    for onset in exposed_cases["onset_time"]:
        # Nearest prior meal (meal must come before symptom onset to be
        # a plausible cause).
        prior_meals = [m for m in meal_datetimes if m <= onset]
        if not prior_meals:
            continue
        nearest_meal = max(prior_meals)
        gap = (onset - nearest_meal).total_seconds() / 3600.0
        gaps_hours.append(gap)

    if not gaps_hours:
        return None, None

    median_gap = float(np.median(gaps_hours))
    within_window = [
        MIN_PLAUSIBLE_INCUBATION_HOURS <= g <= MAX_PLAUSIBLE_INCUBATION_HOURS for g in gaps_hours
    ]
    pct_within = 100.0 * sum(within_window) / len(within_window)
    return median_gap, pct_within


# ---------------------------------------------------------------------------
# Per-exposure stats for one block
# ---------------------------------------------------------------------------

def compute_exposure_stats(
    block: str,
    reports_df: pd.DataFrame,
    exposure: str,
    meals_df: pd.DataFrame | None,
    population_scope: str,
) -> ExposureStats:
    """
    population_scope: "campus" (all reports campus-wide, excluding this
    block's affected cases) or "block" (only this block's non-affected /
    all reports, used when campus-wide data isn't representative, e.g. a
    mess that only serves one part of campus). Default entry point uses
    "campus".
    """
    block_df = reports_df[reports_df["block"] == block]
    affected_df = block_df  # every report for this block IS a suspected case
    n_affected = len(affected_df)

    affected_exposed = int((affected_df["food_exposure"] == exposure).sum())
    affected_unexposed = n_affected - affected_exposed
    affected_exposure_pct = 100.0 * affected_exposed / n_affected if n_affected else 0.0

    if population_scope == "campus":
        comparison_df = reports_df[reports_df["block"] != block]
    else:
        comparison_df = block_df

    pop_total = len(comparison_df)
    pop_exposed = int((comparison_df["food_exposure"] == exposure).sum())
    pop_unexposed = pop_total - pop_exposed
    pop_exposure_pct = 100.0 * pop_exposed / pop_total if pop_total else 0.0

    a, b, c, d = _two_by_two(
        affected_exposed=affected_exposed,
        affected_unexposed=affected_unexposed,
        pop_exposed_extra=pop_exposed,
        pop_unexposed_extra=pop_unexposed,
    )

    rr = compute_relative_risk(a, b, c, d)
    or_ = compute_odds_ratio(a, b, c, d)
    p_value = compute_fisher_p(a, b, c, d) if 0 not in (a + c, b + d) else None

    association = classify_association(rr, or_, p_value, n_affected)

    median_gap, pct_within_window = compute_temporal_compatibility(affected_df, exposure, meals_df)

    notes = []
    low_confidence = n_affected < MIN_CASES_FOR_CONFIDENT_STATS
    if low_confidence:
        notes.append(f"only {n_affected} case(s) in block - statistics are low-confidence")
    if median_gap is not None and not (MIN_PLAUSIBLE_INCUBATION_HOURS <= median_gap <= MAX_PLAUSIBLE_INCUBATION_HOURS):
        notes.append(
            f"median onset gap ({median_gap:.1f}h) falls outside the plausible "
            f"{MIN_PLAUSIBLE_INCUBATION_HOURS}-{MAX_PLAUSIBLE_INCUBATION_HOURS}h incubation window"
        )

    return ExposureStats(
        exposure=exposure,
        affected_exposed=affected_exposed,
        affected_total=n_affected,
        affected_exposure_pct=affected_exposure_pct,
        population_exposed=pop_exposed,
        population_total=pop_total,
        population_exposure_pct=pop_exposure_pct,
        relative_risk=rr,
        odds_ratio=or_,
        p_value=p_value,
        association=association,
        median_onset_gap_hours=median_gap,
        within_incubation_window_pct=pct_within_window,
        low_confidence=low_confidence,
        notes=notes,
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def attribute_source_from_df(
    reports_df: pd.DataFrame,
    block: str,
    meals_df: pd.DataFrame | None = None,
    population_scope: str = "campus",
) -> dict:
    """
    Run source attribution for a single block against already-loaded
    DataFrames (reports_df must already have onset_time as datetime - see
    load_reports for the exact prep; meals_df must already have a
    `datetime` column - see load_meals). This is the entry point used by
    callers that source data from something other than a CSV (e.g. the
    backend's SQLite database) - attribute_source() below is a thin
    CSV-loading wrapper around this.

    Returns a dict with:
      - block
      - affected_total
      - exposures: list of per-exposure stat dicts, ranked by
        relative risk (falling back to odds ratio) descending
      - top_suspected_exposure: the top-ranked exposure dict, or None if
        no exposure showed any association
      - disclaimer: the required causation disclaimer
      - summary: short human-readable string, mirroring the example
        format in the project spec
    """
    if reports_df.empty or block not in reports_df["block"].unique():
        return {
            "block": block,
            "affected_total": 0,
            "exposures": [],
            "top_suspected_exposure": None,
            "disclaimer": CAUSATION_DISCLAIMER,
            "summary": f"Block {block}: no reports found.\n  {CAUSATION_DISCLAIMER}",
        }

    stats_list = [
        compute_exposure_stats(block, reports_df, exposure, meals_df, population_scope)
        for exposure in FOOD_EXPOSURES
    ]

    # Rank by relative risk (fallback: odds ratio; fallback: -1 so
    # undefined-effect exposures sort last, not first).
    def _rank_key(s: ExposureStats) -> float:
        if s.relative_risk is not None:
            return s.relative_risk
        if s.odds_ratio is not None:
            return s.odds_ratio
        return -1.0

    stats_list.sort(key=_rank_key, reverse=True)

    top = stats_list[0] if stats_list and stats_list[0].association != "NONE" else None
    n_affected = len(reports_df[reports_df["block"] == block])

    summary_lines = [f"Block {block} ({n_affected} affected students)"]
    for s in stats_list:
        summary_lines.append(
            f"  {s.exposure}: {s.affected_exposed}/{s.affected_total} affected students exposed "
            f"({s.affected_exposure_pct:.1f}% exposure overlap) - {s.association} association"
        )
        if s.median_onset_gap_hours is not None:
            summary_lines.append(f"    Median onset gap: {s.median_onset_gap_hours:.1f}h after last {s.exposure} meal")
    summary_lines.append(f"  {CAUSATION_DISCLAIMER}")

    return {
        "block": block,
        "affected_total": n_affected,
        "exposures": [s.to_dict() for s in stats_list],
        "top_suspected_exposure": top.to_dict() if top else None,
        "disclaimer": CAUSATION_DISCLAIMER,
        "summary": "\n".join(summary_lines),
    }


def attribute_source(
    reports_csv: str,
    block: str,
    meals_csv: str | None = None,
    population_scope: str = "campus",
) -> dict:
    """
    Run source attribution for a single block, loading reports (and
    optionally meals) from CSV files first. See attribute_source_from_df
    for the underlying logic and full return-value docs.
    """
    reports_df = load_reports(reports_csv)
    meals_df = load_meals(meals_csv) if meals_csv else None
    return attribute_source_from_df(
        reports_df=reports_df,
        block=block,
        meals_df=meals_df,
        population_scope=population_scope,
    )


if __name__ == "__main__":
    import json
    import os
    import sys

    base = os.path.dirname(os.path.abspath(__file__))
    reports_csv = os.path.join(base, "..", "data", "symptom_reports.csv")
    meals_csv = os.path.join(base, "..", "data", "meals.csv")

    block_arg = sys.argv[1] if len(sys.argv) > 1 else "B05"

    result = attribute_source(reports_csv=reports_csv, block=block_arg, meals_csv=meals_csv)
    print(result["summary"])
    print()
    print(json.dumps(result, indent=2, default=str))