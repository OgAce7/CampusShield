"""
Database initialization and helper functions.

Uses plain sqlite3 (no ORM) to keep things simple for a hackathon.
Each function opens its own short-lived connection - fine for this scale.
"""

import sqlite3
import json
from contextlib import contextmanager

from schema import DB_PATH, SCHEMA_SQL, BOYS_BLOCKS, GIRLS_BLOCKS


@contextmanager
def get_connection():
    """Yield a sqlite3 connection with row access by column name."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    """Create tables (if not present) and seed the fixed block list."""
    with get_connection() as conn:
        conn.executescript(SCHEMA_SQL)

        # Seed blocks table with the fixed campus layout, if empty.
        existing = conn.execute("SELECT COUNT(*) AS count FROM blocks").fetchone()
        if existing["count"] == 0:
            default_capacity = 60
            rows = [(b, "boys", default_capacity) for b in BOYS_BLOCKS]
            rows += [(g, "girls", default_capacity) for g in GIRLS_BLOCKS]
            conn.executemany(
                "INSERT INTO blocks (block_id, gender, capacity) VALUES (?, ?, ?)",
                rows,
            )


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

def insert_report(report: dict) -> int:
    """Insert a symptom report. `symptoms` is stored as a JSON-encoded list."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO reports (
                anonymous_student_id, block, symptoms, severity,
                onset_time, report_time, food_exposure
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report["anonymous_student_id"],
                report["block"],
                json.dumps(report["symptoms"]),
                report["severity"],
                report["onset_time"],
                report["report_time"],
                report.get("food_exposure"),
            ),
        )
        return cursor.lastrowid


def get_all_reports() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM reports ORDER BY report_time DESC"
        ).fetchall()
        results = []
        for row in rows:
            item = dict(row)
            item["symptoms"] = json.loads(item["symptoms"])
            results.append(item)
        return results


# ---------------------------------------------------------------------------
# Meals
# ---------------------------------------------------------------------------

def insert_meal(meal: dict) -> int:
    """Insert a meal record. `food_items` is stored as a JSON-encoded list."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO meals (mess, date, meal_type, food_items)
            VALUES (?, ?, ?, ?)
            """,
            (
                meal["mess"],
                meal["date"],
                meal["meal_type"],
                json.dumps(meal["food_items"]),
            ),
        )
        return cursor.lastrowid


def get_all_meals() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM meals ORDER BY date DESC"
        ).fetchall()
        results = []
        for row in rows:
            item = dict(row)
            item["food_items"] = json.loads(item["food_items"])
            results.append(item)
        return results


# ---------------------------------------------------------------------------
# Blocks
# ---------------------------------------------------------------------------

def get_all_blocks() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM blocks ORDER BY block_id"
        ).fetchall()
        return [dict(row) for row in rows]
