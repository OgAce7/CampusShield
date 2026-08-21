"""
Hostel Outbreak Radar - Synthetic Data Generator

Generates a realistic synthetic dataset for the illness surveillance system:
- symptom_reports.csv: ~300-500 historical symptom reports over 7-14 days,
  including background/random illness plus ONE clearly identifiable
  simulated GI outbreak.
- meals.csv: meal records (food items + timing) for MESS_A and MESS_B.

This script only GENERATES data. It does not implement outbreak detection,
ML, or any dashboard/frontend logic.

Usage:
    python generate_data.py

Output:
    /data/symptom_reports.csv
    /data/meals.csv
"""

import csv
import random
from datetime import datetime, timedelta

# ---------------------------------------------------------------------------
# Config / constants
# ---------------------------------------------------------------------------

RANDOM_SEED = 42

BOYS_BLOCKS = [f"B{str(i).zfill(2)}" for i in range(1, 13)]   # B01..B12
GIRLS_BLOCKS = [f"G{str(i).zfill(2)}" for i in range(1, 9)]   # G01..G08
ALL_BLOCKS = BOYS_BLOCKS + GIRLS_BLOCKS

MESS_OPTIONS = ["MESS_A", "MESS_B"]
FOOD_EXPOSURES = ["MESS_A", "MESS_B", "OUTSIDE_FOOD", "NONE"]

ALL_SYMPTOMS = ["nausea", "vomiting", "diarrhea", "abdominal pain", "fever", "headache"]
SEVERITY_LEVELS = ["mild", "moderate", "severe"]
MEAL_TYPES = ["breakfast", "lunch", "snacks", "dinner"]

# Simulation window: 10 days of history ending "today".
SIMULATION_DAYS = 10
END_DATE = datetime(2026, 8, 22, 0, 0, 0)   # anchor date for reproducibility
START_DATE = END_DATE - timedelta(days=SIMULATION_DAYS)

# Background illness rate: how many "normal" reports we generate per day.
BACKGROUND_REPORTS_PER_DAY_RANGE = (22, 35)

# Outbreak configuration.
# Chosen to be a tight, plausible cluster: 4 adjacent boys blocks (B05-B08),
# fed by MESS_A dinner, onset clustered a few hours after that meal, over
# a 2-day rapid escalation window.
OUTBREAK_BLOCKS = ["B05", "B06", "B07", "B08"]
OUTBREAK_MESS = "MESS_A"
OUTBREAK_MEAL_TYPE = "dinner"
OUTBREAK_DAY_OFFSET = 6          # outbreak trigger meal happens on this day of the sim
OUTBREAK_REPORT_COUNTS = [8, 45, 30, 6]   # reports per day: seed day, peak, decline, tail
OUTBREAK_SYMPTOM_SET = ["diarrhea", "vomiting", "abdominal pain", "nausea"]

random.seed(RANDOM_SEED)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def random_time_on_day(day_start: datetime, hour_range=(0, 23)) -> datetime:
    """Return a random datetime within the given day, biased to a plausible hour range."""
    hour = random.randint(*hour_range)
    minute = random.randint(0, 59)
    second = random.randint(0, 59)
    return day_start.replace(hour=0, minute=0, second=0) + timedelta(
        hours=hour, minutes=minute, seconds=second
    )


def make_anonymous_id(counter: int) -> str:
    return f"anon{counter:04d}"


def pick_background_symptoms() -> list[str]:
    """
    Background illness: usually 1-2 mild/unrelated symptoms, occasionally a
    normal upset-stomach combo. Deliberately more varied/less coherent than
    the outbreak symptom set.
    """
    n = random.choices([1, 2, 3], weights=[0.5, 0.35, 0.15])[0]
    return random.sample(ALL_SYMPTOMS, k=n)


def pick_background_severity() -> str:
    return random.choices(SEVERITY_LEVELS, weights=[0.6, 0.3, 0.1])[0]


def pick_background_food_exposure() -> str:
    # Background cases have exposure spread roughly evenly, with a good
    # chunk reporting no specific/known food exposure.
    return random.choices(
        FOOD_EXPOSURES,
        weights=[0.25, 0.25, 0.25, 0.25],
    )[0]


# ---------------------------------------------------------------------------
# Background report generation
# ---------------------------------------------------------------------------

def generate_background_reports(start_counter: int) -> list[dict]:
    """Generate scattered, low-signal illness reports across the whole window."""
    reports = []
    counter = start_counter

    for day_index in range(SIMULATION_DAYS):
        day_start = START_DATE + timedelta(days=day_index)
        n_reports = random.randint(*BACKGROUND_REPORTS_PER_DAY_RANGE)

        for _ in range(n_reports):
            block = random.choice(ALL_BLOCKS)
            symptoms = pick_background_symptoms()
            severity = pick_background_severity()
            food_exposure = pick_background_food_exposure()

            onset_time = random_time_on_day(day_start, hour_range=(6, 23))
            # Report time trails onset by a random delay (people don't report instantly).
            report_delay = timedelta(hours=random.randint(1, 20), minutes=random.randint(0, 59))
            report_time = onset_time + report_delay

            reports.append({
                "anonymous_student_id": make_anonymous_id(counter),
                "block": block,
                "symptoms": ";".join(symptoms),
                "severity": severity,
                "onset_time": onset_time.isoformat(),
                "report_time": report_time.isoformat(),
                "food_exposure": food_exposure,
            })
            counter += 1

    return reports


# ---------------------------------------------------------------------------
# Outbreak report generation
# ---------------------------------------------------------------------------

def generate_outbreak_reports(start_counter: int) -> list[dict]:
    """
    Generate a tight, clearly identifiable GI outbreak:
    - concentrated in 4 adjacent boys blocks (B05-B08)
    - triggered by a MESS_A dinner
    - onset clustered 4-14 hours after that meal (classic bacterial/viral GI incubation window)
    - rapid rise then decline over 4 days
    - high symptom similarity (diarrhea/vomiting/abdominal pain/nausea, often 2-3 together)
    - strong exposure overlap with MESS_A
    """
    reports = []
    counter = start_counter

    trigger_day = START_DATE + timedelta(days=OUTBREAK_DAY_OFFSET)
    # The trigger meal: MESS_A dinner, served ~7:00-8:30 PM on trigger_day.
    trigger_meal_time = trigger_day.replace(hour=19, minute=30)

    for day_offset, n_reports in enumerate(OUTBREAK_REPORT_COUNTS):
        report_day = trigger_day + timedelta(days=day_offset)

        for _ in range(n_reports):
            block = random.choice(OUTBREAK_BLOCKS)

            # High symptom similarity: 2-3 symptoms drawn from the same tight set.
            n_symptoms = random.choices([2, 3], weights=[0.4, 0.6])[0]
            symptoms = random.sample(OUTBREAK_SYMPTOM_SET, k=n_symptoms)

            # Outbreak cases skew moderate/severe.
            severity = random.choices(SEVERITY_LEVELS, weights=[0.2, 0.5, 0.3])[0]

            # Onset clusters 4-14 hours after the trigger meal, with some spread
            # on later days representing secondary/slower-onset cases.
            incubation_hours = random.uniform(4, 14) + (day_offset * random.uniform(0, 6))
            onset_time = trigger_meal_time + timedelta(hours=incubation_hours)

            # Reporting delay: people report faster once symptoms are severe/shared.
            report_delay = timedelta(hours=random.randint(1, 12), minutes=random.randint(0, 59))
            report_time = onset_time + report_delay

            # Strong exposure overlap with the trigger mess; a small fraction
            # report no specific exposure (recall bias / genuinely missed the meal
            # but still infected, e.g. secondary transmission).
            food_exposure = random.choices(
                [OUTBREAK_MESS, "NONE", "OUTSIDE_FOOD"],
                weights=[0.85, 0.10, 0.05],
            )[0]

            reports.append({
                "anonymous_student_id": make_anonymous_id(counter),
                "block": block,
                "symptoms": ";".join(symptoms),
                "severity": severity,
                "onset_time": onset_time.isoformat(),
                "report_time": report_time.isoformat(),
                "food_exposure": food_exposure,
            })
            counter += 1

    return reports


# ---------------------------------------------------------------------------
# Meal generation
# ---------------------------------------------------------------------------

MEAL_MENU = {
    "breakfast": [
        ["idli", "sambar", "coconut chutney", "tea"],
        ["poha", "boiled eggs", "banana", "milk"],
        ["bread", "butter", "jam", "cornflakes", "milk"],
        ["upma", "coconut chutney", "coffee"],
    ],
    "lunch": [
        ["rice", "dal", "mixed vegetable curry", "curd", "papad"],
        ["chapati", "chole", "jeera rice", "salad"],
        ["rice", "sambar", "potato fry", "curd", "pickle"],
        ["chapati", "paneer curry", "rice", "dal fry"],
    ],
    "snacks": [
        ["samosa", "tea"],
        ["sandwich", "coffee"],
        ["bread pakora", "tea"],
        ["biscuits", "tea"],
    ],
    "dinner": [
        ["rice", "dal", "paneer curry", "salad", "chapati"],
        ["chapati", "egg curry", "rice", "salad"],
        ["fried rice", "manchurian gravy", "salad"],
        ["rice", "rajma", "chapati", "curd"],
        ["chicken curry", "rice", "chapati", "salad"],
    ],
}

MEAL_TIME_WINDOWS = {
    "breakfast": (7, 9),
    "lunch": (12, 14),
    "snacks": (16, 18),
    "dinner": (19, 21),
}


def generate_meals() -> list[dict]:
    """
    Generate meal records for MESS_A and MESS_B across the simulation window,
    covering all 4 meal types per day per mess. On the outbreak trigger day,
    MESS_A's dinner is deliberately set to a plausible risky-sounding dish
    (paneer curry) to give the outbreak a concrete, investigable food item.
    """
    meals = []
    meal_id_counter = 1

    trigger_day_date = (START_DATE + timedelta(days=OUTBREAK_DAY_OFFSET)).date()

    for day_index in range(SIMULATION_DAYS):
        current_day = (START_DATE + timedelta(days=day_index)).date()

        for mess in MESS_OPTIONS:
            for meal_type in MEAL_TYPES:
                if (
                    mess == OUTBREAK_MESS
                    and meal_type == OUTBREAK_MEAL_TYPE
                    and current_day == trigger_day_date
                ):
                    # The trigger meal: fixed menu implicating a specific dish.
                    food_items = ["rice", "dal", "paneer curry (suspected undercooked)", "salad", "chapati"]
                else:
                    food_items = random.choice(MEAL_MENU[meal_type])

                meals.append({
                    "meal_id": meal_id_counter,
                    "mess": mess,
                    "date": current_day.isoformat(),
                    "meal_type": meal_type,
                    "food_items": ";".join(food_items),
                })
                meal_id_counter += 1

    return meals


# ---------------------------------------------------------------------------
# CSV writers
# ---------------------------------------------------------------------------

def write_reports_csv(reports: list[dict], path: str):
    fieldnames = [
        "report_id", "anonymous_student_id", "block", "symptoms",
        "severity", "onset_time", "report_time", "food_exposure",
    ]
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for i, report in enumerate(reports, start=1):
            row = {"report_id": i}
            row.update(report)
            writer.writerow(row)


def write_meals_csv(meals: list[dict], path: str):
    fieldnames = ["meal_id", "mess", "date", "meal_type", "food_items"]
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for meal in meals:
            writer.writerow(meal)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import os

    output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)))

    background_reports = generate_background_reports(start_counter=1)
    outbreak_reports = generate_outbreak_reports(start_counter=len(background_reports) + 1)

    all_reports = background_reports + outbreak_reports
    # Shuffle so the outbreak isn't trivially at the bottom of the file,
    # then sort by onset_time to make the CSV chronologically readable.
    random.shuffle(all_reports)
    all_reports.sort(key=lambda r: r["onset_time"])

    meals = generate_meals()

    reports_path = os.path.join(output_dir, "symptom_reports.csv")
    meals_path = os.path.join(output_dir, "meals.csv")

    write_reports_csv(all_reports, reports_path)
    write_meals_csv(meals, meals_path)

    print(f"Generated {len(all_reports)} symptom reports -> {reports_path}")
    print(f"  - background reports: {len(background_reports)}")
    print(f"  - outbreak reports:   {len(outbreak_reports)}")
    print(f"Generated {len(meals)} meal records -> {meals_path}")
    print()
    print("Outbreak summary:")
    print(f"  blocks:      {OUTBREAK_BLOCKS}")
    print(f"  mess:        {OUTBREAK_MESS}")
    print(f"  meal type:   {OUTBREAK_MEAL_TYPE}")
    print(f"  trigger day: {(START_DATE + timedelta(days=OUTBREAK_DAY_OFFSET)).date().isoformat()}")
    print(f"  daily case counts (seed/peak/decline/tail): {OUTBREAK_REPORT_COUNTS}")


if __name__ == "__main__":
    main()
