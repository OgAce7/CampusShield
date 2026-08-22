# Hostel Outbreak Radar

Hackathon project for tracking early illness/outbreak signals across campus
hostels and mess halls, with explainable statistical outbreak detection and
food-source attribution.

**Status:** Working end-to-end: role-based login (student / clinic), symptom
+ meal reporting, an explainable outbreak-risk engine, food-source
attribution, and a live dashboard UI. See "Not Yet Implemented" below for
what's intentionally still out of scope.

## Project Structure

```
/frontend    React + Vite app (student report form + clinic dashboard UI)
/backend     Python + FastAPI app (API, auth, SQLite, dashboard endpoints)
/data        Synthetic demo dataset + generator script
/analysis    Outbreak detection engine + source attribution (pandas/numpy/scikit-learn/scipy)
```

## Campus Locations

**Boys Hostels:** B01–B12
**Girls Hostels:** G01–G08
**Mess:** MESS_A, MESS_B, OUTSIDE_FOOD

These are represented in the UI as a simple schematic block grid — not a
geographic map. There is no fixed block-to-mess assignment anywhere in the
system; each block's "common exposure" is computed per-block from its own
reports, not from a hardcoded mapping.

## Prerequisites

- Node.js 18+ and npm
- Python 3.10+

## Backend Setup

```bash
cd backend
py -3.12 -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend will run at http://localhost:8000
Check it's alive: http://localhost:8000/health
Interactive API docs: http://localhost:8000/docs

On first run, `hostel_outbreak_radar.db` (SQLite) is created automatically and
seeded with the 20 campus blocks (B01–B12, G01–G08).

### Auth

Hackathon-simple role auth — no passwords, no JWT, in-memory sessions only
(see `backend/auth.py`). `POST /login` with a `name` and `role`
(`"student"` or `"clinic"`) returns a session token to send back as the
`X-Session-Token` header. `/reports` (POST), `/meals` (POST), and every
`/dashboard/*` route require a `clinic` session; `/reports` (POST) requires
`student`; `/blocks` and `/meals` (GET) accept either role.

### API Endpoints

| Method | Path                 | Auth           | Description                              |
|--------|----------------------|----------------|-------------------------------------------|
| GET    | /health              | none           | Health check                              |
| POST   | /login               | none           | Get a session token for a name + role     |
| GET    | /me                  | any session    | Current caller's name/role                |
| GET    | /blocks              | any session    | List all hostel blocks                    |
| POST   | /reports             | student        | Submit a symptom report                   |
| GET    | /reports             | clinic         | List all symptom reports                  |
| POST   | /meals               | clinic         | Submit a meal record                      |
| GET    | /meals               | any session    | List all meal records                     |
| GET    | /dashboard/overview  | clinic         | Campus-wide summary                       |
| GET    | /dashboard/blocks    | clinic         | Per-block risk score, all 20 blocks       |
| GET    | /dashboard/alerts    | clinic         | Blocks at WATCH or above                  |
| GET    | /dashboard/sources   | clinic         | Food-source attribution for flagged blocks |

Example `POST /reports` body:
```json
{
  "anonymous_student_id": "anon123",
  "block": "B03",
  "symptoms": ["fever", "nausea"],
  "severity": "moderate",
  "onset_time": "2026-08-22T08:00:00",
  "food_exposure": "MESS_A"
}
```

Example `POST /meals` body:
```json
{
  "mess": "MESS_A",
  "date": "2026-08-22",
  "meal_type": "lunch",
  "food_items": ["rice", "dal", "paneer curry"]
}
```

## Frontend Setup

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend will run at http://localhost:5173. It's a single-page app with
three flows: a landing screen, an anonymous student symptom-report form, and
a clinic-staff login + live outbreak dashboard (auto-refreshes from
`/dashboard/*` every 20s).

## Tech Stack

- **Frontend:** React + Vite (hand-rolled charts/UI, no chart library currently in use)
- **Backend:** Python + FastAPI, in-memory session auth
- **Database:** SQLite (reports, meals, blocks tables)
- **Data processing:** Pandas, NumPy, scikit-learn, SciPy — powering the
  outbreak detection engine and source attribution module in `/analysis`,
  wired into the backend via `backend/analysis_bridge.py`

## Not Yet Implemented (by design)

- Machine learning / predictive modeling (detection is deterministic statistics, not ML)
- Real authentication (passwords, JWT, OAuth, DB-backed sessions)
- Real maps / GIS (block layout is schematic/illustrative only)
- Notifications (any "advisory" shown in the UI is explicitly labeled SIMULATED)
- Editing or deleting existing reports/meals (only create + list)
- Persisted session storage (sessions live in memory, reset on server restart)

## Synthetic Dataset

`/data` contains a generated dataset for development/demo purposes:

```bash
cd data
python3 generate_data.py
```

This produces `symptom_reports.csv` (~350-400 reports over 10 days, mostly
background illness) and `meals.csv` (MESS_A / MESS_B meal records), including
one embedded, clearly identifiable simulated GI outbreak concentrated in
blocks B05–B08, linked to a MESS_A dinner. See `/data/README.md` for full
details on the scenario design. Note this only writes CSVs — to see it
reflected in the live dashboard, the same data needs to be submitted through
`POST /reports` / `POST /meals` (or inserted directly into the SQLite DB),
since the dashboard reads from the database, not these CSVs.

## Outbreak Detection & Source Attribution

`/analysis` contains two independent, deterministic, explainable modules
(no LLM anywhere):

- **`outbreak_engine.py`** — scores each of the 20 blocks 0-100 from 7
  weighted signals (baseline deviation, growth, spatial concentration,
  symptom similarity via scikit-learn Jaccard, temporal clustering, shared
  food exposure, background deviation), classified NORMAL / WATCH /
  SUSPECTED / PROBABLE.
- **`source_attribution.py`** — given a block, computes relative risk, odds
  ratio, and a Fisher's exact p-value (SciPy) per food exposure, plus
  onset-timing compatibility against actual meal-type serving times, to
  surface a "suspected association, not proof of causation" food source.

Both are wired into the backend live (`backend/analysis_bridge.py` adapts
SQLite data into the DataFrames these modules expect) and are independently
runnable against the demo CSVs:

```bash
cd analysis
python3 report.py          # human-readable per-block risk report (CSV-based)
python3 test_engine.py     # sanity checks for outbreak_engine.py
python3 test_source_attribution.py   # sanity checks for source_attribution.py
python3 source_attribution.py B05   # attribution report for a single block (CSV-based)
```

See `/analysis/README.md` for the full signal breakdown.

## Next Steps (future work)

- Add an ingestion path so `/data`'s generated CSVs can seed the live SQLite DB directly, for demo purposes
- Persist sessions past a server restart, if a longer-running deployment is ever needed