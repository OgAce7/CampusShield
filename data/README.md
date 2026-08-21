# /data

Synthetic datasets for the Hostel Outbreak Radar hackathon project.

## Files

- **`generate_data.py`** — script that generates the datasets below. Run it
  with `python generate_data.py` (or `python3 generate_data.py`) from this
  directory to regenerate both CSVs. Uses a fixed random seed (42), so output
  is reproducible.
- **`symptom_reports.csv`** — ~350-400 historical symptom reports over a
  10-day window.
- **`meals.csv`** — meal records (food items + timing) for MESS_A and MESS_B
  across the same 10-day window, 4 meal types/day (breakfast, lunch, snacks,
  dinner).

## symptom_reports.csv columns

| Column                 | Description                                              |
|------------------------|-----------------------------------------------------------|
| report_id              | Sequential integer ID                                     |
| anonymous_student_id   | Synthetic anonymous ID (e.g. `anon0001`)                   |
| block                  | Hostel block (B01–B12, G01–G08)                            |
| symptoms               | `;`-separated list, from: nausea, vomiting, diarrhea, abdominal pain, fever, headache |
| severity               | mild / moderate / severe                                  |
| onset_time             | ISO datetime symptoms started                              |
| report_time            | ISO datetime the report was logged (always after onset)   |
| food_exposure          | MESS_A / MESS_B / OUTSIDE_FOOD / NONE                      |

## meals.csv columns

| Column      | Description                                  |
|-------------|-----------------------------------------------|
| meal_id     | Sequential integer ID                          |
| mess        | MESS_A / MESS_B                                |
| date        | ISO date the meal was served                   |
| meal_type   | breakfast / lunch / snacks / dinner            |
| food_items  | `;`-separated list of dishes served             |

## Data composition

The dataset intentionally mixes two signal types:

1. **Background illness** (~280-300 reports) — scattered across all 20
   blocks, all days, with varied and mostly incoherent symptom combinations,
   mild-skewed severity, and food exposure spread roughly evenly across
   MESS_A / MESS_B / OUTSIDE_FOOD / none. This represents normal
   day-to-day stomach bugs, unrelated headaches/fevers, etc.

2. **One simulated GI outbreak** (~85-90 reports) — designed to be clearly
   identifiable against the background noise:
   - **Blocks:** concentrated in 4 adjacent boys blocks, B05–B08
   - **Trigger:** a MESS_A dinner on day 7 of the window (menu includes a
     flagged dish: "paneer curry (suspected undercooked)")
   - **Onset timing:** clustered ~4–14 hours after the trigger dinner
     (plausible bacterial/viral GI incubation window), with a small long
     tail on subsequent days
   - **Rapid escalation:** daily case counts in the outbreak blocks follow
     roughly 8 → 45 → 30 → 6 across a 4-day window, vs. a background rate of
     3–10/day in those same blocks on other days
   - **Symptom similarity:** cases draw 2–3 symptoms from a tight, shared
     set (diarrhea, vomiting, abdominal pain, nausea), skewing
     moderate/severe
   - **Exposure overlap:** ~85% of outbreak-case reports list MESS_A as the
     food exposure
   - **Coexists with background noise:** unrelated cases continue to occur
     in other blocks (G01-G08, B01-B04, B09-B12) throughout, including
     during the outbreak window, so the outbreak isn't the only thing
     happening in the data

This structure is meant to give a downstream detection/analysis step (not
implemented here) a realistic needle-in-a-haystack signal to find, without
the generator itself doing any detection.

## Regenerating

```bash
cd data
python3 generate_data.py
```

This overwrites `symptom_reports.csv` and `meals.csv` in place. Edit the
constants at the top of `generate_data.py` (block lists, outbreak blocks,
day counts, severity weights, etc.) to tweak the scenario.
