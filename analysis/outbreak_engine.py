"""
Hostel Outbreak Radar - Outbreak Detection Engine

Explainable, deterministic, statistics-based risk scoring for each campus
block. Combines 7 independent signals into a 0-100 risk score, so that a
block never scores high purely because it has a lot of cases - it needs
supporting signals (clustering, shared symptoms, shared exposure, growth,
timing) to reach SUSPECTED/PROBABLE.

This module does NOT do medical diagnosis. It flags statistical patterns in
self-reported symptom data for human review.

No LLM is used anywhere in this engine.

Usage:
    from outbreak_engine import run_engine
    results = run_engine("../data/symptom_reports.csv")
"""

import math
from collections import Counter
from datetime import datetime, timedelta
from itertools import combinations

import numpy as np
import pandas as pd
from sklearn.metrics import jaccard_score

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BOYS_BLOCKS = [f"B{str(i).zfill(2)}" for i in range(1, 13)]
GIRLS_BLOCKS = [f"G{str(i).zfill(2)}" for i in range(1, 9)]
ALL_BLOCKS = BOYS_BLOCKS + GIRLS_BLOCKS

ALL_SYMPTOMS = ["nausea", "vomiting", "diarrhea", "abdominal pain", "fever", "headache"]
FOOD_EXPOSURES = ["MESS_A", "MESS_B", "OUTSIDE_FOOD", "NONE"]

# Recent window = last N days of the dataset, used as the "active" period we
# are scoring. Baseline window = the days before that, used to establish what
# "normal" looks like for each block.
RECENT_WINDOW_DAYS = 3
BASELINE_WINDOW_DAYS = 7

# Signal weights. Must sum to 100. Chosen so that case-count-vs-baseline
# alone (signal 1+3, ~30 pts combined) cannot push a block past WATCH -
# corroborating signals (clustering, similarity, exposure, growth) are
# required to reach SUSPECTED/PROBABLE.
WEIGHTS = {
    "baseline_deviation": 15,   # signal 1: recent vs own historical baseline
    "growth": 15,               # signal 2: recent case growth trend
    "spatial_concentration": 10,  # signal 3: this block vs campus-wide share
    "symptom_similarity": 20,   # signal 4: how alike are the symptom sets
    "temporal_clustering": 15,  # signal 5: how tightly onsets are clustered
    "shared_exposure": 20,      # signal 6: shared food exposure
    "background_deviation": 5,  # signal 7: vs campus background illness rate
}
assert sum(WEIGHTS.values()) == 100

SEVERITY_THRESHOLDS = [
    (80, 100, "PROBABLE"),
    (60, 79, "SUSPECTED"),
    (30, 59, "WATCH"),
    (0, 29, "NORMAL"),
]

MIN_CASES_FOR_SIGNAL = 3  # below this, similarity/clustering/exposure signals are unreliable


# ---------------------------------------------------------------------------
# Data loading / prep
# ---------------------------------------------------------------------------

def load_reports(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    df["onset_time"] = pd.to_datetime(df["onset_time"], format="ISO8601")
    df["report_time"] = pd.to_datetime(df["report_time"], format="ISO8601")
    df["symptom_list"] = df["symptoms"].apply(
        lambda s: sorted(x.strip() for x in str(s).split(";") if x.strip())
    )
    return df


def get_time_windows(df: pd.DataFrame):
    """
    Define the recent (active) window and the baseline (comparison) window
    based on the max onset_time present in the data, so the engine works
    regardless of which dates the dataset covers.
    """
    latest = df["onset_time"].max()
    recent_start = latest - timedelta(days=RECENT_WINDOW_DAYS)
    baseline_start = recent_start - timedelta(days=BASELINE_WINDOW_DAYS)

    return {
        "latest": latest,
        "recent_start": recent_start,
        "baseline_start": baseline_start,
    }


# ---------------------------------------------------------------------------
# Signal 1 + 7: baseline deviation & background deviation
# ---------------------------------------------------------------------------

def compute_case_counts(df: pd.DataFrame, windows: dict):
    """
    For each block, compute:
    - current_cases: count in the recent window
    - baseline_cases: average daily case count in the baseline window,
      scaled to the recent window length (so both numbers are directly
      comparable "cases over N days")
    """
    recent_mask = (df["onset_time"] >= windows["recent_start"]) & (df["onset_time"] <= windows["latest"])
    baseline_mask = (df["onset_time"] >= windows["baseline_start"]) & (df["onset_time"] < windows["recent_start"])

    recent_df = df[recent_mask]
    baseline_df = df[baseline_mask]

    recent_counts = recent_df.groupby("block").size()
    baseline_daily_avg = baseline_df.groupby("block").size() / BASELINE_WINDOW_DAYS
    baseline_counts_scaled = baseline_daily_avg * RECENT_WINDOW_DAYS

    result = {}
    for block in ALL_BLOCKS:
        current = int(recent_counts.get(block, 0))
        baseline = float(baseline_counts_scaled.get(block, 0.0))
        result[block] = {"current_cases": current, "baseline_cases": round(baseline, 2)}
    return result, recent_df, baseline_df


def score_baseline_deviation(current: int, baseline: float) -> tuple[float, float]:
    """
    Signal 1: how far above its OWN historical baseline is this block?
    Returns (score 0-1, growth_factor / ratio for display).

    Uses a smoothed ratio (Laplace-style +1 to avoid divide-by-zero on
    blocks with no baseline history) and a log-scaled score so a 2x jump
    isn't treated the same as a 10x jump, but the curve saturates rather
    than exploding.
    """
    ratio = (current + 1) / (baseline + 1)
    if ratio <= 1.0:
        return 0.0, ratio
    # log2(ratio) of 1 (2x) -> ~0.3, log2 of 3 (8x) -> ~1.0 (saturates)
    score = min(1.0, math.log2(ratio) / 3.0)
    return score, ratio


def score_background_deviation(current: int, campus_background_rate: float) -> float:
    """
    Signal 7: deviation from campus-wide background illness rate (not this
    block's own history) - catches a block with no prior baseline data that
    is nonetheless running well above what's normal campus-wide.
    """
    if campus_background_rate <= 0:
        return 0.0
    ratio = current / campus_background_rate
    if ratio <= 1.0:
        return 0.0
    return min(1.0, math.log2(ratio) / 3.0)


# ---------------------------------------------------------------------------
# Signal 2: growth
# ---------------------------------------------------------------------------

def score_growth(block_recent_df: pd.DataFrame, windows: dict, baseline_daily_rate: float) -> tuple[float, str]:
    """
    Signal 2: growth trend, assessed two ways and combined (take the max):
    (a) internal trend - later half of the recent window vs earlier half.
    (b) recent daily rate vs baseline daily rate - catches outbreaks that
        peaked early in the recent window and are already decaying, which
        would look "flat/declining" under (a) alone but are still clearly
        elevated versus baseline.
    Returns (score 0-1, human-readable description).
    """
    half_point = windows["recent_start"] + (windows["latest"] - windows["recent_start"]) / 2

    earlier = len(block_recent_df[block_recent_df["onset_time"] < half_point])
    later = len(block_recent_df[block_recent_df["onset_time"] >= half_point])

    if earlier == 0 and later == 0:
        return 0.0, "no recent cases"

    internal_ratio = (later + 1) / (earlier + 1)

    recent_daily_rate = len(block_recent_df) / max(RECENT_WINDOW_DAYS, 1)
    vs_baseline_ratio = (recent_daily_rate + 0.5) / (baseline_daily_rate + 0.5)

    ratio = max(internal_ratio, vs_baseline_ratio)

    if ratio <= 1.1:
        desc = "flat or declining case trend"
        score = 0.0
    elif ratio <= 2:
        desc = "moderate case growth"
        score = 0.4
    elif ratio <= 4:
        desc = "rapid case growth"
        score = 0.75
    else:
        desc = "explosive case growth"
        score = 1.0

    return score, desc


# ---------------------------------------------------------------------------
# Signal 3: spatial concentration
# ---------------------------------------------------------------------------

def score_spatial_concentration(current: int, all_recent_counts: dict) -> float:
    """
    Signal 3: is this block carrying an unusually large share of ALL recent
    campus cases, vs. what you'd expect if cases were spread evenly (or
    randomly) across 20 blocks? Uses a z-score of this block's share against
    the mean share across blocks with at least one case.
    """
    counts = np.array(list(all_recent_counts.values()), dtype=float)
    total = counts.sum()
    if total == 0:
        return 0.0

    shares = counts / total
    mean_share = shares.mean()
    std_share = shares.std()

    this_share = current / total
    if std_share == 0:
        return 0.0

    z = (this_share - mean_share) / std_share
    # Map z-score to 0-1: z<=0 -> 0, z>=3 -> 1
    return float(np.clip(z / 3.0, 0.0, 1.0))


# ---------------------------------------------------------------------------
# Signal 4: symptom similarity (scikit-learn Jaccard)
# ---------------------------------------------------------------------------

def symptom_to_vector(symptom_list: list[str]) -> np.ndarray:
    return np.array([1 if s in symptom_list else 0 for s in ALL_SYMPTOMS])


def score_symptom_similarity(block_recent_df: pd.DataFrame) -> tuple[float, list[str], float]:
    """
    Signal 4: pairwise Jaccard similarity (via scikit-learn) across all
    cases' symptom sets in this block's recent window. High mean pairwise
    similarity = cases look like "the same illness". Low similarity =
    scattered, unrelated complaints.

    Returns (score 0-1, dominant_symptoms list, mean_similarity 0-1).
    """
    symptom_lists = block_recent_df["symptom_list"].tolist()
    n = len(symptom_lists)

    if n < MIN_CASES_FOR_SIGNAL:
        # Not enough cases to assess similarity meaningfully.
        dominant = _dominant_symptoms(symptom_lists)
        return 0.0, dominant, 0.0

    vectors = np.array([symptom_to_vector(s) for s in symptom_lists])

    sims = []
    for i, j in combinations(range(n), 2):
        sim = jaccard_score(vectors[i], vectors[j], zero_division=0)
        sims.append(sim)

    mean_sim = float(np.mean(sims)) if sims else 0.0
    dominant = _dominant_symptoms(symptom_lists)

    return mean_sim, dominant, mean_sim


def _dominant_symptoms(symptom_lists: list[list[str]], top_n: int = 3) -> list[str]:
    counter = Counter()
    for s_list in symptom_lists:
        counter.update(s_list)
    return [s for s, _ in counter.most_common(top_n)]


# ---------------------------------------------------------------------------
# Signal 5: temporal clustering
# ---------------------------------------------------------------------------

def score_temporal_clustering(block_recent_df: pd.DataFrame) -> tuple[float, str]:
    """
    Signal 5: how tightly clustered are the onset times? A genuine
    point-source outbreak produces a dense burst of onsets even if a longer
    tail trails off afterward; a coincidental pile of unrelated illnesses
    spreads onsets out roughly uniformly.

    Rather than using the std/span of ALL onsets (which is skewed by decay
    tails), we find the narrowest time window containing 70% of cases
    ("core cluster") and score based on how tight that core window is
    relative to case count. Returns (score 0-1, onset_window description).
    """
    n = len(block_recent_df)
    if n < MIN_CASES_FOR_SIGNAL:
        return 0.0, "insufficient data"

    onset_sorted = block_recent_df["onset_time"].sort_values().reset_index(drop=True)

    core_fraction = 0.7
    core_n = max(2, int(math.ceil(n * core_fraction)))

    # Slide a window of core_n consecutive (sorted) onsets, find the
    # narrowest one - that's the densest burst of cases.
    best_span_hours = None
    best_start, best_end = onset_sorted.iloc[0], onset_sorted.iloc[-1]
    for start_idx in range(0, n - core_n + 1):
        window_start = onset_sorted.iloc[start_idx]
        window_end = onset_sorted.iloc[start_idx + core_n - 1]
        span_hours = (window_end - window_start).total_seconds() / 3600
        if best_span_hours is None or span_hours < best_span_hours:
            best_span_hours = span_hours
            best_start, best_end = window_start, window_end

    window_desc = _format_onset_window(best_start, best_end)

    # Score: a tight core burst (<=12h containing 70% of cases) scores high;
    # a core spread over >=72h scores near 0.
    if best_span_hours <= 12:
        score = 1.0
    elif best_span_hours >= 72:
        score = 0.0
    else:
        score = 1.0 - (best_span_hours - 12) / 60.0

    return float(np.clip(score, 0.0, 1.0)), window_desc


def _format_onset_window(min_onset: pd.Timestamp, max_onset: pd.Timestamp) -> str:
    span = max_onset - min_onset
    total_hours = span.total_seconds() / 3600
    if total_hours < 1:
        return "within 1 hour"
    return f"within {int(round(total_hours))} hours"


# ---------------------------------------------------------------------------
# Signal 6: shared food exposure
# ---------------------------------------------------------------------------

def score_shared_exposure(block_recent_df: pd.DataFrame) -> tuple[float, str, float]:
    """
    Signal 6: does a large share of this block's recent cases point to the
    same food exposure (a specific mess)? "NONE" exposure is excluded from
    being the "common" one, since it carries no attribution signal.
    Returns (score 0-1, common_exposure label, overlap_fraction 0-1).
    """
    n = len(block_recent_df)
    if n < MIN_CASES_FOR_SIGNAL:
        return 0.0, "insufficient data", 0.0

    exposures = block_recent_df["food_exposure"].tolist()
    counter = Counter(exposures)

    # Consider only attributable exposures (exclude NONE) for "common_exposure".
    attributable = {k: v for k, v in counter.items() if k != "NONE"}
    if not attributable:
        return 0.0, "NONE", 0.0

    common_exposure, common_count = max(attributable.items(), key=lambda kv: kv[1])
    overlap_fraction = common_count / n

    # Score scales with overlap fraction, requiring a meaningful majority.
    if overlap_fraction < 0.4:
        score = 0.0
    else:
        score = min(1.0, (overlap_fraction - 0.4) / 0.5)  # 0.4->0, ~0.9+->1.0

    return float(score), common_exposure, float(overlap_fraction)


# ---------------------------------------------------------------------------
# Main scoring per block
# ---------------------------------------------------------------------------

def classify_severity(score: float) -> str:
    for low, high, label in SEVERITY_THRESHOLDS:
        if low <= score <= high:
            return label
    return "NORMAL"


def score_block(
    block: str,
    block_recent_df: pd.DataFrame,
    case_counts: dict,
    all_recent_counts: dict,
    windows: dict,
    campus_background_rate: float,
) -> dict:
    current = case_counts[block]["current_cases"]
    baseline = case_counts[block]["baseline_cases"]

    baseline_score, growth_factor = score_baseline_deviation(current, baseline)
    background_score = score_background_deviation(current, campus_background_rate)
    baseline_daily_rate = baseline / max(RECENT_WINDOW_DAYS, 1)
    growth_score, growth_desc = score_growth(block_recent_df, windows, baseline_daily_rate)
    spatial_score = score_spatial_concentration(current, all_recent_counts)
    similarity_score, dominant_symptoms, mean_similarity = score_symptom_similarity(block_recent_df)
    temporal_score, onset_window = score_temporal_clustering(block_recent_df)
    exposure_score, common_exposure, exposure_overlap = score_shared_exposure(block_recent_df)

    # Weighted sum -> 0-100.
    raw_score = (
        baseline_score * WEIGHTS["baseline_deviation"]
        + growth_score * WEIGHTS["growth"]
        + spatial_score * WEIGHTS["spatial_concentration"]
        + similarity_score * WEIGHTS["symptom_similarity"]
        + temporal_score * WEIGHTS["temporal_clustering"]
        + exposure_score * WEIGHTS["shared_exposure"]
        + background_score * WEIGHTS["background_deviation"]
    )

    # Low-case-count guardrail: with very few cases, corroborating signals
    # (similarity/clustering/exposure) are marked "insufficient data" and
    # contribute 0, which naturally caps the score - but we also hard-cap
    # explicitly here for extra explainability/safety at n<2.
    if current < 2:
        raw_score = min(raw_score, 25.0)

    risk_score = int(round(np.clip(raw_score, 0, 100)))
    severity = classify_severity(risk_score)

    reasons = build_reasons(
        growth_factor=growth_factor,
        growth_desc=growth_desc,
        similarity_score=mean_similarity,
        exposure_overlap=exposure_overlap,
        common_exposure=common_exposure,
        onset_window=onset_window,
        spatial_score=spatial_score,
        current=current,
        baseline=baseline,
    )

    return {
        "block": block,
        "current_cases": current,
        "baseline_cases": round(baseline, 1),
        "growth_factor": round(growth_factor, 2),
        "risk_score": risk_score,
        "severity": severity,
        "dominant_symptoms": dominant_symptoms,
        "symptom_similarity": round(mean_similarity, 2),
        "common_exposure": common_exposure,
        "exposure_overlap": round(exposure_overlap, 2),
        "onset_window": onset_window,
        "reasons": reasons,
        # Raw component scores kept for transparency / debugging.
        "_signal_breakdown": {
            "baseline_deviation": round(baseline_score * WEIGHTS["baseline_deviation"], 1),
            "growth": round(growth_score * WEIGHTS["growth"], 1),
            "spatial_concentration": round(spatial_score * WEIGHTS["spatial_concentration"], 1),
            "symptom_similarity": round(similarity_score * WEIGHTS["symptom_similarity"], 1),
            "temporal_clustering": round(temporal_score * WEIGHTS["temporal_clustering"], 1),
            "shared_exposure": round(exposure_score * WEIGHTS["shared_exposure"], 1),
            "background_deviation": round(background_score * WEIGHTS["background_deviation"], 1),
        },
    }


def build_reasons(
    growth_factor: float,
    growth_desc: str,
    similarity_score: float,
    exposure_overlap: float,
    common_exposure: str,
    onset_window: str,
    spatial_score: float,
    current: int,
    baseline: float,
) -> list[str]:
    """Build a short list of human-readable reasons, in priority order."""
    reasons = []

    if baseline > 0 and growth_factor >= 1.5:
        reasons.append(f"{growth_factor:.1f}x historical baseline")
    elif baseline == 0 and current >= MIN_CASES_FOR_SIGNAL:
        reasons.append(f"{current} cases with no historical baseline for this block")

    if growth_desc not in ("flat or declining case trend", "no recent cases"):
        reasons.append(growth_desc)

    if similarity_score >= 0.5:
        reasons.append("high symptom similarity across cases")
    elif similarity_score >= 0.3:
        reasons.append("moderate symptom similarity across cases")

    if exposure_overlap >= 0.4 and common_exposure not in ("NONE", "insufficient data"):
        reasons.append(f"{int(round(exposure_overlap * 100))}% shared {_pretty_exposure(common_exposure)} exposure")

    if onset_window not in ("insufficient data",):
        reasons.append(f"onset times clustered {onset_window}")

    if spatial_score >= 0.5:
        reasons.append("disproportionate share of campus-wide cases")

    if not reasons:
        reasons.append("case activity consistent with normal background illness")

    return reasons


def _pretty_exposure(exposure: str) -> str:
    mapping = {"MESS_A": "Mess A", "MESS_B": "Mess B", "OUTSIDE_FOOD": "outside food"}
    return mapping.get(exposure, exposure)


# ---------------------------------------------------------------------------
# Engine entry point
# ---------------------------------------------------------------------------

def run_engine(csv_path: str) -> list[dict]:
    """
    Run the full detection engine on a symptom_reports.csv file.
    Returns a list of per-block result dicts, sorted by risk_score descending.
    """
    df = load_reports(csv_path)
    windows = get_time_windows(df)

    case_counts, recent_df, baseline_df = compute_case_counts(df, windows)
    all_recent_counts = {b: case_counts[b]["current_cases"] for b in ALL_BLOCKS}

    total_recent_cases = sum(all_recent_counts.values())
    campus_background_rate = total_recent_cases / len(ALL_BLOCKS) if ALL_BLOCKS else 0.0

    results = []
    for block in ALL_BLOCKS:
        block_recent_df = recent_df[recent_df["block"] == block]
        result = score_block(
            block=block,
            block_recent_df=block_recent_df,
            case_counts=case_counts,
            all_recent_counts=all_recent_counts,
            windows=windows,
            campus_background_rate=campus_background_rate,
        )
        results.append(result)

    results.sort(key=lambda r: r["risk_score"], reverse=True)
    return results


if __name__ == "__main__":
    import json
    import os

    csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "symptom_reports.csv")
    output = run_engine(csv_path)

    print(json.dumps(output, indent=2, default=str))
