"""
Database schema and campus constants for Hostel Outbreak Radar.

SQLite is used for simplicity (single-file DB, zero setup for a hackathon).
"""

DB_PATH = "hostel_outbreak_radar.db"

BOYS_BLOCKS = [f"B{str(i).zfill(2)}" for i in range(1, 13)]   # B01..B12
GIRLS_BLOCKS = [f"G{str(i).zfill(2)}" for i in range(1, 9)]   # G01..G08
ALL_BLOCKS = BOYS_BLOCKS + GIRLS_BLOCKS

FOOD_EXPOSURES = ["MESS_A", "MESS_B", "OUTSIDE_FOOD", "NONE"]
MESS_OPTIONS = ["MESS_A", "MESS_B"]

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS blocks (
    block_id TEXT PRIMARY KEY,
    gender TEXT NOT NULL CHECK (gender IN ('boys', 'girls')),
    capacity INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
    report_id INTEGER PRIMARY KEY AUTOINCREMENT,
    anonymous_student_id TEXT NOT NULL,
    block TEXT NOT NULL,
    symptoms TEXT NOT NULL,
    severity TEXT NOT NULL,
    onset_time TEXT NOT NULL,
    report_time TEXT NOT NULL,
    food_exposure TEXT,
    FOREIGN KEY (block) REFERENCES blocks (block_id)
);

CREATE TABLE IF NOT EXISTS meals (
    meal_id INTEGER PRIMARY KEY AUTOINCREMENT,
    mess TEXT NOT NULL,
    date TEXT NOT NULL,
    meal_type TEXT NOT NULL,
    food_items TEXT NOT NULL
);
"""
