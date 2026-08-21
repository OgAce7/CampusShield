"""
Hostel Outbreak Radar - Engine Sanity Tests

Lightweight assertions (not a full pytest suite) verifying the outbreak
engine behaves sensibly against the synthetic dataset:
- the known outbreak blocks (B05-B08) score meaningfully higher than
  background-only blocks
- risk score never depends solely on case count (a low-case block with
  strong corroborating signals can outscore a higher-case block with none)
- output schema contains all required fields

Run with: python3 test_engine.py
"""

import os
from outbreak_engine import run_engine, ALL_BLOCKS

CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "symptom_reports.csv")

REQUIRED_FIELDS = [
    "block", "current_cases", "baseline_cases", "growth_factor",
    "risk_score", "severity", "dominant_symptoms", "symptom_similarity",
    "common_exposure", "exposure_overlap", "onset_window", "reasons",
]

KNOWN_OUTBREAK_BLOCKS = {"B05", "B06", "B07", "B08"}


def test_schema(results):
    for r in results:
        for field in REQUIRED_FIELDS:
            assert field in r, f"Missing field '{field}' in result for {r.get('block')}"
    print(f"[PASS] schema check: all {len(REQUIRED_FIELDS)} required fields present for all {len(results)} blocks")


def test_all_blocks_present(results):
    result_blocks = {r["block"] for r in results}
    assert result_blocks == set(ALL_BLOCKS), f"Block mismatch: {result_blocks.symmetric_difference(set(ALL_BLOCKS))}"
    print(f"[PASS] all 20 campus blocks present in output")


def test_outbreak_blocks_score_higher(results):
    by_block = {r["block"]: r for r in results}

    outbreak_scores = [by_block[b]["risk_score"] for b in KNOWN_OUTBREAK_BLOCKS]
    other_scores = [by_block[b]["risk_score"] for b in ALL_BLOCKS if b not in KNOWN_OUTBREAK_BLOCKS]

    min_outbreak_score = min(outbreak_scores)
    max_other_score = max(other_scores)

    print(f"  outbreak blocks (B05-B08) scores: {sorted(outbreak_scores, reverse=True)}")
    print(f"  highest non-outbreak block score: {max_other_score}")

    assert min_outbreak_score > max_other_score, (
        f"Expected all outbreak blocks to outscore all non-outbreak blocks, "
        f"but min outbreak score ({min_outbreak_score}) <= max other score ({max_other_score})"
    )
    print(f"[PASS] all known outbreak blocks (B05-B08) outscore all other blocks")


def test_outbreak_blocks_reach_suspected_or_higher(results):
    by_block = {r["block"]: r for r in results}
    for b in KNOWN_OUTBREAK_BLOCKS:
        severity = by_block[b]["severity"]
        assert severity in ("SUSPECTED", "PROBABLE"), (
            f"Expected {b} to reach at least SUSPECTED, got {severity} (score {by_block[b]['risk_score']})"
        )
    print(f"[PASS] all known outbreak blocks reach SUSPECTED or PROBABLE")


def test_background_blocks_stay_low(results):
    """
    Blocks with no connection to the simulated outbreak should stay well
    below SUSPECTED, even though background illness is present everywhere.
    """
    by_block = {r["block"]: r for r in results}
    quiet_blocks = [b for b in ALL_BLOCKS if b not in KNOWN_OUTBREAK_BLOCKS]

    high_scoring_quiet = [b for b in quiet_blocks if by_block[b]["severity"] in ("SUSPECTED", "PROBABLE")]
    assert not high_scoring_quiet, (
        f"Expected no non-outbreak blocks to reach SUSPECTED/PROBABLE, but found: {high_scoring_quiet}"
    )
    print(f"[PASS] no background-only block reaches SUSPECTED/PROBABLE "
          f"(highest: {max(by_block[b]['risk_score'] for b in quiet_blocks)})")


def test_score_not_case_count_alone(results):
    """
    Find a case where case count alone would mis-rank blocks: a block with
    fewer cases but stronger corroborating signals should be able to score
    at or above a block with more cases but no corroboration.
    """
    sorted_by_cases = sorted(results, key=lambda r: r["current_cases"], reverse=True)
    sorted_by_score = sorted(results, key=lambda r: r["risk_score"], reverse=True)

    top_cases_block = sorted_by_cases[0]["block"]
    top_score_block = sorted_by_score[0]["block"]

    # Look for ANY pair where a lower-case-count block outscores a higher-case-count block.
    found_inversion = False
    for a in results:
        for b in results:
            if a["current_cases"] > b["current_cases"] and a["risk_score"] < b["risk_score"]:
                found_inversion = True
                print(f"  inversion example: {a['block']} has {a['current_cases']} cases "
                      f"(score {a['risk_score']}) vs {b['block']} with {b['current_cases']} cases "
                      f"(score {b['risk_score']})")
                break
        if found_inversion:
            break

    assert found_inversion, "Expected at least one case-count/risk-score inversion, proving score isn't count-driven"
    print(f"[PASS] risk score is not purely case-count driven (rank inversion exists)")


def test_low_case_blocks_capped(results):
    """Blocks with 0-1 cases should never reach WATCH or higher."""
    for r in results:
        if r["current_cases"] <= 1:
            assert r["severity"] == "NORMAL", (
                f"{r['block']} has only {r['current_cases']} case(s) but severity is {r['severity']}"
            )
    print(f"[PASS] blocks with 0-1 cases are always classified NORMAL")


def main():
    results = run_engine(CSV_PATH)

    print("Running Hostel Outbreak Radar engine sanity tests...")
    print(f"(dataset: {CSV_PATH})")
    print()

    test_schema(results)
    test_all_blocks_present(results)
    test_low_case_blocks_capped(results)
    test_score_not_case_count_alone(results)
    test_outbreak_blocks_reach_suspected_or_higher(results)
    test_background_blocks_stay_low(results)
    test_outbreak_blocks_score_higher(results)

    print()
    print("All sanity tests passed.")


if __name__ == "__main__":
    main()
