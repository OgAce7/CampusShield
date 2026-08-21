"""
Hostel Outbreak Radar - Report Formatter

Formats the outbreak engine's output into the human-readable style requested
in the spec, e.g.:

    B03
    Risk: 87
    Status: PROBABLE
    Reasons:
    - 5.1x historical baseline
    - rapid case growth
    - high symptom similarity
    - 78% shared Mess A exposure
    - onset times clustered within 6-12 hours

Usage:
    python report.py [path_to_csv]
"""

import sys
import os

from outbreak_engine import run_engine


def format_block_report(result: dict) -> str:
    lines = [
        result["block"],
        f"Risk: {result['risk_score']}",
        f"Status: {result['severity']}",
        "Reasons:",
    ]
    for reason in result["reasons"]:
        lines.append(f"- {reason}")
    return "\n".join(lines)


def print_full_report(results: list[dict]):
    print("=" * 60)
    print("HOSTEL OUTBREAK RADAR - Block Risk Report")
    print("=" * 60)
    print()

    for result in results:
        print(format_block_report(result))
        print()

    print("=" * 60)
    print("Summary by status:")
    from collections import Counter
    counts = Counter(r["severity"] for r in results)
    for status in ["PROBABLE", "SUSPECTED", "WATCH", "NORMAL"]:
        print(f"  {status}: {counts.get(status, 0)} block(s)")
    print("=" * 60)


if __name__ == "__main__":
    csv_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "data", "symptom_reports.csv"
    )
    results = run_engine(csv_path)
    print_full_report(results)
