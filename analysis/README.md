# /analysis

Explainable outbreak detection engine for Hostel Outbreak Radar.

**This is statistical pattern detection over self-reported symptom data, not
medical diagnosis.** No LLM is used anywhere in this engine.

## Files

- **`outbreak_engine.py`** — the core engine. Computes a 0-100 risk score
  per block from 7 independent signals, using pandas/numpy for statistics
  and scikit-learn (`jaccard_score`) for symptom similarity.
- **`report.py`** — formats engine output into the human-readable
  block-by-block report format (block / risk / status / reasons).
- **`test_engine.py`** — sanity checks that the engine correctly separates
  the known simulated outbreak (blocks B05-B08) from background noise, and
  that risk score is not purely case-count driven.

## Usage

```bash
cd analysis
python3 report.py                          # human-readable report, uses ../data/symptom_reports.csv
python3 outbreak_engine.py                  # raw JSON output
python3 test_engine.py                      # run sanity checks
```

You can also import it directly:

```python
from outbreak_engine import run_engine
results = run_engine("../data/symptom_reports.csv")
```

`run_engine` returns a list of dicts (one per block, sorted by risk_score
descending), each containing:

| Field                | Description                                                |
|-----------------------|-------------------------------------------------------------|
| `block`               | Block ID (e.g. `B06`)                                        |
| `current_cases`        | Case count in the recent window                              |
| `baseline_cases`       | Expected case count based on this block's own history        |
| `growth_factor`        | current / baseline ratio                                     |
| `risk_score`           | 0-100                                                         |
| `severity`             | NORMAL / WATCH / SUSPECTED / PROBABLE                         |
| `dominant_symptoms`    | Top 3 most common symptoms in this block's recent cases       |
| `symptom_similarity`   | Mean pairwise Jaccard similarity of symptom sets (0-1)         |
| `common_exposure`      | Most common shared food exposure                              |
| `exposure_overlap`     | Fraction of cases sharing `common_exposure` (0-1)              |
| `onset_window`         | Description of how tightly onset times cluster                |
| `reasons`              | Ordered list of human-readable explanations for the score      |

## How the score is built

Each block gets a score from **7 independent, weighted signals** (weights
sum to 100), so a block cannot reach a high score from case count alone —
it needs corroborating evidence:

| # | Signal                    | Weight | What it measures                                                              |
|---|---------------------------|--------|--------------------------------------------------------------------------------|
| 1 | Baseline deviation         | 15     | Recent cases vs. this block's own historical daily rate (log-scaled ratio)     |
| 2 | Growth                     | 15     | Case growth trend (later vs. earlier half of window, and vs. baseline rate)     |
| 3 | Spatial concentration      | 10     | Is this block carrying a disproportionate share of campus-wide cases (z-score)? |
| 4 | Symptom similarity         | 20     | Mean pairwise Jaccard similarity across cases' symptom sets (scikit-learn)      |
| 5 | Temporal clustering        | 15     | Narrowest window containing 70% of cases — tight burst vs. spread-out onsets   |
| 6 | Shared food exposure       | 20     | Largest share of cases pointing to one specific mess/exposure                  |
| 7 | Background deviation       | 5      | Recent cases vs. campus-wide background illness rate (catches blocks with no prior history) |

Symptom similarity + shared exposure alone make up 40 of the 100 points —
by design, larger than case-count-based signals (baseline + spatial +
background = 30 points) — so scattered, high-volume-but-incoherent illness
cannot out-score a smaller, tightly-correlated cluster.

**Guardrails:**
- Blocks with fewer than `MIN_CASES_FOR_SIGNAL` (3) cases get `0` for
  similarity/clustering/exposure signals (marked "insufficient data") rather
  than a spuriously confident score.
- Blocks with 0-1 recent cases are hard-capped at a score of 25 (NORMAL)
  regardless of other signals.

## Severity thresholds

| Score   | Status      |
|---------|-------------|
| 0–29    | NORMAL      |
| 30–59   | WATCH       |
| 60–79   | SUSPECTED   |
| 80–100  | PROBABLE    |

## Validated behavior

Running against `/data/symptom_reports.csv` (which contains one embedded
simulated outbreak in blocks B05-B08, see `/data/README.md`):

- B05, B06, B07, B08 all reach **SUSPECTED** (61-79), clearly separated from
  every other block (highest non-outbreak score: 38, WATCH)
- Reasons read like: *"9.2x historical baseline"*, *"explosive case
  growth"*, *"82% shared Mess A exposure"*, *"onset times clustered within
  7 hours"*
- No purely-background block reaches SUSPECTED or PROBABLE
- Risk score is confirmed NOT to be case-count-driven: e.g. a block with 3
  cases and 100% shared exposure outscores several blocks with 6-7
  uncorrelated cases

Run `python3 test_engine.py` to re-verify these properties after any changes
to the scoring logic, weights, or dataset.

## Not implemented (by design)

- No dashboard/frontend — this is a backend analysis module only
- No database writes — reads directly from CSV
- No LLM usage anywhere
- No medical diagnosis — this flags statistical patterns in self-reported
  data for human review, nothing more
- No automated notifications/alerts
