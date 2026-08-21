"""
Hostel Outbreak Radar - Analysis Bridge

Wires the two independent /analysis modules (outbreak_engine.py,
source_attribution.py) into the FastAPI backend, reading live data from the
SQLite database instead of the static demo CSVs in /data.

Both analysis modules are DataFrame-first (their CSV entry points are thin
wrappers around a `_from_df` function), so this module's only real job is
adapting `database.get_all_reports()` / `get_all_meals()` (lists of dicts,
matching the SQLite schema) into the DataFrames those `_from_df` functions
expect, then handing off. No detection or attribution LOGIC lives here.

Nothing in this module calls an LLM.
"""

import os
import sys
from functools import lru_cache

import pandas as pd

import database
from schema import ALL_BLOCKS, BOYS_BLOCKS, GIRLS_BLOCKS

# /analysis is a sibling directory of /backend, not a package - add it to
# sys.path so we can import the two modules directly without duplicating
# their logic here.
_ANALYSIS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "analysis")
if _ANALYSIS_DIR not in sys.path:
    sys.path.insert(0, _ANALYSIS_DIR)

import outbreak_engine  # noqa: E402
import source_attribution  # noqa: E402

BLOCK_GENDER = {b: "boys" for b in BOYS_BLOCKS} | {g: "girls" for g in GIRLS_BLOCKS}


# ---------------------------------------------------------------------------
# DB -> DataFrame adapters
# ---------------------------------------------------------------------------

def reports_df_from_db() -> pd.DataFrame:
    """
    Build the DataFrame outbreak_engine / source_attribution expect
    (onset_time as datetime, food_exposure defaulted to "NONE" for reports
    that didn't specify one) directly from the reports table.
    """
    records = database.get_all_reports()
    if not records:
        return pd.DataFrame(
            columns=["report_id", "anonymous_student_id", "block", "symptoms",
                     "severity", "onset_time", "report_time", "food_exposure", "symptom_list"]
        )

    df = pd.DataFrame(records)
    df["food_exposure"] = df["food_exposure"].fillna("NONE")
    df["onset_time"] = pd.to_datetime(df["onset_time"], format="ISO8601")
    df["report_time"] = pd.to_datetime(df["report_time"], format="ISO8601")
    # `symptoms` already comes back as a Python list from database.py;
    # outbreak_engine works off a sorted `symptom_list` column (see its
    # load_reports), so build that the same way here.
    df["symptom_list"] = df["symptoms"].apply(lambda s: sorted(x.strip() for x in s if x and x.strip()))
    return df


def meals_df_from_db() -> pd.DataFrame:
    """
    Build the DataFrame source_attribution expects (a `datetime` column
    derived from `date`) directly from the meals table.
    """
    records = database.get_all_meals()
    if not records:
        return pd.DataFrame(columns=["meal_id", "mess", "date", "meal_type", "food_items", "datetime"])

    df = pd.DataFrame(records)
    df["datetime"] = pd.to_datetime(df["date"])
    return df


# ---------------------------------------------------------------------------
# Cached per-request results
# ---------------------------------------------------------------------------
#
# All four dashboard endpoints need the same detection pass over the same
# data. lru_cache(maxsize=1) means "recompute once per distinct dataset
# snapshot, reuse across endpoints within that snapshot" - cheap for a
# hackathon-scale dataset (a few hundred reports) and avoids re-running the
# engine 4x if a client hits multiple dashboard routes back to back.
# `dataset_version()` is the cache key: it changes whenever the report/meal
# counts change, so new submissions are picked up on the next call rather
# than being served stale results forever.

def dataset_version() -> tuple[int, int]:
    """Cheap proxy for 'has the data changed' - (report_count, meal_count)."""
    with database.get_connection() as conn:
        report_count = conn.execute("SELECT COUNT(*) AS c FROM reports").fetchone()["c"]
        meal_count = conn.execute("SELECT COUNT(*) AS c FROM meals").fetchone()["c"]
    return report_count, meal_count


@lru_cache(maxsize=8)
def _run_detection_cached(version: tuple[int, int]) -> tuple[dict, ...]:
    reports_df = reports_df_from_db()
    results = outbreak_engine.run_engine_from_df(reports_df)
    return tuple(results)


def run_detection() -> list[dict]:
    """List of per-block detection results (see outbreak_engine.score_block
    / empty_block_result for the schema), sorted by risk_score descending,
    covering all 20 campus blocks."""
    return list(_run_detection_cached(dataset_version()))


@lru_cache(maxsize=32)
def _run_attribution_cached(version: tuple[int, int], block: str) -> dict:
    reports_df = reports_df_from_db()
    meals_df = meals_df_from_db()
    return source_attribution.attribute_source_from_df(
        reports_df=reports_df,
        block=block,
        meals_df=meals_df if not meals_df.empty else None,
    )


def run_attribution(block: str) -> dict:
    """Source-attribution result for a single block (see
    source_attribution.attribute_source_from_df for the schema)."""
    return _run_attribution_cached(dataset_version(), block)


def clear_caches() -> None:
    """Exposed mainly for tests / manual debugging - not needed in normal
    operation since dataset_version() already invalidates the cache on any
    report/meal count change."""
    _run_detection_cached.cache_clear()
    _run_attribution_cached.cache_clear()
