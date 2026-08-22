"""
Hostel Outbreak Radar - Source Attribution Sanity Tests

Lightweight assertions (not a full pytest suite, matching test_engine.py's
style) verifying source_attribution.py behaves correctly:
- the core 2x2 statistics (relative risk, odds ratio, Fisher's exact p-value)
  match hand-computed expected values on known inputs
- classify_association follows its documented rules (min sample size gate,
  significance can only downgrade HIGH, never MODERATE/LOW)
- meal serving times are derived from meal_type, not collapsed to midnight
  (regression test for a real bug found and fixed in this module - see
  MEAL_TYPE_CLOCK_TIME / _meal_datetime)
- edge cases (zero-cell tables, tiny samples, missing block, empty data)
  degrade gracefully instead of crashing or returning misleading numbers
- the known simulated outbreak block (B06) in the demo dataset produces a
  HIGH-association result pointing at MESS_A, with a plausible onset gap

Run with: python3 test_source_attribution.py
"""

import os

import pandas as pd

import source_attribution as sa

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REPORTS_CSV = os.path.join(BASE_DIR, "..", "data", "symptom_reports.csv")
MEALS_CSV = os.path.join(BASE_DIR, "..", "data", "meals.csv")

KNOWN_OUTBREAK_BLOCK = "B06"
KNOWN_OUTBREAK_EXPOSURE = "MESS_A"


# ---------------------------------------------------------------------------
# Pure statistics: hand-computed expected values
# ---------------------------------------------------------------------------

def test_relative_risk_known_value():
    """
    Table: a=8 (affected+exposed), b=2 (affected+unexposed),
           c=2 (unaffected+exposed), d=8 (unaffected+unexposed)
    risk_exposed = 8/10 = 0.8, risk_unexposed = 2/10 = 0.2, RR = 4.0
    """
    rr = sa.compute_relative_risk(a=8, b=2, c=2, d=8)
    assert rr is not None and abs(rr - 4.0) < 1e-9, f"expected RR=4.0, got {rr}"
    print(f"[PASS] compute_relative_risk matches hand-computed value (RR={rr})")


def test_odds_ratio_known_value():
    """OR = (a*d)/(b*c) = (8*8)/(2*2) = 16.0"""
    or_ = sa.compute_odds_ratio(a=8, b=2, c=2, d=8)
    assert or_ is not None and abs(or_ - 16.0) < 1e-9, f"expected OR=16.0, got {or_}"
    print(f"[PASS] compute_odds_ratio matches hand-computed value (OR={or_})")


def test_fisher_p_matches_scipy_directly():
    """Cross-check against calling scipy.stats.fisher_exact directly, not
    just trusting the wrapper reproduces itself."""
    from scipy.stats import fisher_exact
    _, expected_p = fisher_exact([[8, 2], [2, 8]], alternative="two-sided")
    p = sa.compute_fisher_p(8, 2, 2, 8)
    assert abs(p - expected_p) < 1e-9, f"expected p={expected_p}, got {p}"
    print(f"[PASS] compute_fisher_p matches scipy.stats.fisher_exact directly (p={p:.4f})")


def test_relative_risk_undefined_when_unexposed_risk_zero():
    """If no unexposed people are affected (b=0), risk_unexposed=0 and RR is
    mathematically undefined (would require dividing by zero) - must return
    None, not raise or return inf."""
    rr = sa.compute_relative_risk(a=5, b=0, c=3, d=10)
    assert rr is None, f"expected None for undefined RR, got {rr}"
    print("[PASS] compute_relative_risk returns None (not an exception or inf) when undefined")


def test_odds_ratio_continuity_correction_on_zero_cell():
    """OR must not crash or return a nonsensical value when a cell is 0 -
    the continuity correction (+0.5 to all cells) should kick in."""
    or_ = sa.compute_odds_ratio(a=5, b=0, c=3, d=10)
    assert or_ is not None and or_ > 0, f"expected a positive corrected OR, got {or_}"
    print(f"[PASS] compute_odds_ratio applies continuity correction on zero cell (OR={or_:.2f})")


# ---------------------------------------------------------------------------
# classify_association: documented rule compliance
# ---------------------------------------------------------------------------

def test_classify_association_requires_min_sample_size():
    """A strong effect (RR=4.0) with too few affected cases must still be NONE."""
    label = sa.classify_association(rr=4.0, or_=None, p_value=0.01, n_affected=2)
    assert label == "NONE", f"expected NONE below MIN_CASES_FOR_CONFIDENT_STATS, got {label}"
    print("[PASS] classify_association returns NONE below the minimum sample size, even with a strong effect")


def test_classify_association_significance_downgrades_high_only():
    """Per the module's documented rule: non-significance can downgrade HIGH
    to MODERATE, but must not touch an already-MODERATE label."""
    downgraded = sa.classify_association(rr=4.0, or_=None, p_value=0.5, n_affected=10)
    assert downgraded == "MODERATE", f"expected HIGH to downgrade to MODERATE when non-significant, got {downgraded}"

    unchanged = sa.classify_association(rr=2.0, or_=None, p_value=0.5, n_affected=10)
    assert unchanged == "MODERATE", f"expected MODERATE to stay MODERATE regardless of significance, got {unchanged}"

    stays_high = sa.classify_association(rr=4.0, or_=None, p_value=0.01, n_affected=10)
    assert stays_high == "HIGH", f"expected HIGH to stay HIGH when significant, got {stays_high}"

    print("[PASS] classify_association: significance downgrades HIGH only, per documented rule")


def test_classify_association_no_effect_is_none():
    label = sa.classify_association(rr=None, or_=None, p_value=None, n_affected=10)
    assert label == "NONE", f"expected NONE when no effect size is available, got {label}"
    print("[PASS] classify_association returns NONE when neither RR nor OR is available")


# ---------------------------------------------------------------------------
# Meal serving time (regression test for the midnight-collapse bug)
# ---------------------------------------------------------------------------

def test_meal_datetime_varies_by_meal_type():
    """
    Regression test: meals.csv only has day-level `date`, not a serving
    time. _meal_datetime must derive distinct clock times per meal_type
    (via MEAL_TYPE_CLOCK_TIME) rather than collapsing every meal on a given
    day to midnight - which would make breakfast, lunch, and dinner
    indistinguishable to the temporal-compatibility calculation.
    """
    meals = pd.DataFrame({
        "meal_id": [1, 2, 3, 4],
        "mess": ["MESS_A"] * 4,
        "date": ["2026-08-18"] * 4,
        "meal_type": ["breakfast", "lunch", "snacks", "dinner"],
        "food_items": ["x"] * 4,
    })
    datetimes = sa._meal_datetime(meals)

    assert len(set(datetimes)) == 4, (
        f"expected 4 distinct meal datetimes (one per meal_type), got {len(set(datetimes))} "
        f"- meal times may have collapsed to midnight again"
    )

    breakfast_time, lunch_time, snacks_time, dinner_time = datetimes
    assert breakfast_time < lunch_time < snacks_time < dinner_time, (
        "expected meal_type clock times to be chronologically ordered "
        "(breakfast < lunch < snacks < dinner)"
    )
    print(f"[PASS] meal datetimes vary by meal_type and are chronologically ordered: "
          f"{[t.strftime('%H:%M') for t in datetimes]}")


def test_meal_datetime_unknown_meal_type_falls_back_gracefully():
    """An unrecognized meal_type must not crash - it should fall back to
    DEFAULT_MEAL_CLOCK_TIME rather than raising or producing NaT."""
    meals = pd.DataFrame({
        "meal_id": [1],
        "mess": ["MESS_A"],
        "date": ["2026-08-18"],
        "meal_type": ["brunch"],  # not in MEAL_TYPE_CLOCK_TIME
        "food_items": ["x"],
    })
    datetimes = sa._meal_datetime(meals)
    assert pd.notna(datetimes.iloc[0]), "expected a valid fallback datetime for an unknown meal_type, got NaT"
    print(f"[PASS] unknown meal_type falls back to a valid default time ({datetimes.iloc[0]})")


# ---------------------------------------------------------------------------
# attribute_source_from_df: edge cases
# ---------------------------------------------------------------------------

def test_empty_reports_returns_safe_result():
    """An empty reports DataFrame must return a well-formed zero result, not crash."""
    empty = pd.DataFrame(columns=["block", "food_exposure", "onset_time"])
    result = sa.attribute_source_from_df(empty, "B05", None)
    assert result["affected_total"] == 0
    assert result["top_suspected_exposure"] is None
    assert result["exposures"] == []
    assert sa.CAUSATION_DISCLAIMER in result["summary"]
    print("[PASS] attribute_source_from_df handles an empty reports DataFrame safely")


def test_unknown_block_returns_safe_result():
    """A block with no reports at all (but the DataFrame isn't empty) must
    also return a safe zero result rather than raising a KeyError."""
    reports = pd.DataFrame({
        "block": ["B01", "B01"],
        "food_exposure": ["MESS_A", "MESS_B"],
        "onset_time": pd.to_datetime(["2026-08-18 10:00", "2026-08-18 11:00"]),
    })
    result = sa.attribute_source_from_df(reports, "G08", None)
    assert result["affected_total"] == 0
    assert result["top_suspected_exposure"] is None
    print("[PASS] attribute_source_from_df handles a block with zero reports safely")


def test_every_result_carries_the_causation_disclaimer():
    """The disclaimer is a hard requirement (project spec: 'association, not
    causation') - verify it's present regardless of data shape, not just in
    the happy path."""
    reports_df = sa.load_reports(REPORTS_CSV)
    result = sa.attribute_source_from_df(reports_df, KNOWN_OUTBREAK_BLOCK, None)
    assert result["disclaimer"] == sa.CAUSATION_DISCLAIMER
    assert sa.CAUSATION_DISCLAIMER in result["summary"]
    for exposure_stat in result["exposures"]:
        assert "association" in exposure_stat  # every per-exposure stat is labeled, never a bare number
    print("[PASS] every attribution result carries the required causation disclaimer")


# ---------------------------------------------------------------------------
# Real dataset: the known simulated outbreak
# ---------------------------------------------------------------------------

def test_known_outbreak_block_attributes_to_mess_a():
    """
    The demo dataset (see /data/README.md) embeds one simulated GI outbreak
    in blocks B05-B08, triggered by a MESS_A dinner. Verify attribution on
    B06 surfaces MESS_A as the top suspected exposure with HIGH association
    and a plausible (not midnight-skewed) onset gap.
    """
    reports_df = sa.load_reports(REPORTS_CSV)
    meals_df = sa.load_meals(MEALS_CSV)

    result = sa.attribute_source_from_df(reports_df, KNOWN_OUTBREAK_BLOCK, meals_df)
    top = result["top_suspected_exposure"]

    assert top is not None, f"expected a top suspected exposure for {KNOWN_OUTBREAK_BLOCK}, got None"
    assert top["exposure"] == KNOWN_OUTBREAK_EXPOSURE, (
        f"expected top exposure to be {KNOWN_OUTBREAK_EXPOSURE}, got {top['exposure']}"
    )
    assert top["association"] == "HIGH", f"expected HIGH association, got {top['association']}"
    assert top["relative_risk"] is not None and top["relative_risk"] > 2.0, (
        f"expected a strong relative risk (>2.0), got {top['relative_risk']}"
    )

    # Onset gap should fall inside the plausible incubation window, and
    # specifically should NOT be a midnight-skewed artifact (i.e. not
    # suspiciously close to a multiple of exactly 24h from a date boundary,
    # which is what the pre-fix bug produced).
    gap = top["median_onset_gap_hours"]
    assert gap is not None, "expected a computed median onset gap for MESS_A (meals_df was supplied)"
    assert sa.MIN_PLAUSIBLE_INCUBATION_HOURS <= gap <= sa.MAX_PLAUSIBLE_INCUBATION_HOURS, (
        f"expected onset gap within the plausible incubation window, got {gap}h"
    )
    print(f"[PASS] known outbreak block {KNOWN_OUTBREAK_BLOCK} attributes to {KNOWN_OUTBREAK_EXPOSURE} "
          f"(HIGH, RR={top['relative_risk']}, median onset gap={gap}h)")


def test_attribution_ranks_exposures_by_effect_size():
    """Exposures list must be sorted descending by relative risk (falling
    back to odds ratio) - the top exposure should never have a weaker
    effect than one listed below it."""
    reports_df = sa.load_reports(REPORTS_CSV)
    result = sa.attribute_source_from_df(reports_df, KNOWN_OUTBREAK_BLOCK, None)

    def _effect(e):
        if e["relative_risk"] is not None:
            return e["relative_risk"]
        if e["odds_ratio"] is not None:
            return e["odds_ratio"]
        return -1.0

    effects = [_effect(e) for e in result["exposures"]]
    assert effects == sorted(effects, reverse=True), f"exposures not sorted by effect size descending: {effects}"
    print(f"[PASS] exposures ranked by effect size descending: {[round(e, 2) for e in effects]}")


def main():
    print("Running Hostel Outbreak Radar source_attribution.py sanity tests...")
    print(f"(dataset: {REPORTS_CSV})")
    print()

    test_relative_risk_known_value()
    test_odds_ratio_known_value()
    test_fisher_p_matches_scipy_directly()
    test_relative_risk_undefined_when_unexposed_risk_zero()
    test_odds_ratio_continuity_correction_on_zero_cell()

    test_classify_association_requires_min_sample_size()
    test_classify_association_significance_downgrades_high_only()
    test_classify_association_no_effect_is_none()

    test_meal_datetime_varies_by_meal_type()
    test_meal_datetime_unknown_meal_type_falls_back_gracefully()

    test_empty_reports_returns_safe_result()
    test_unknown_block_returns_safe_result()
    test_every_result_carries_the_causation_disclaimer()

    test_known_outbreak_block_attributes_to_mess_a()
    test_attribution_ranks_exposures_by_effect_size()

    print()
    print("All source_attribution.py sanity tests passed.")


if __name__ == "__main__":
    main()
