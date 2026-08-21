# Hostel Outbreak Radar

Hackathon project skeleton for tracking early illness/outbreak signals across
campus hostels and mess halls.

**Status:** Initial skeleton only. No outbreak detection, ML, database logic,
notifications, real maps/GIS, or authentication have been implemented yet.

## Project Structure

```
/frontend    React + Vite app (UI)
/backend     Python + FastAPI app (API)
/data        Raw / sample datasets (placeholder)
/analysis    Pandas / NumPy / scikit-learn exploration (placeholder)
```

## Campus Locations

**Boys Hostels:** B01–B12
**Girls Hostels:** G01–G08
**Mess:** MESS_A, MESS_B, OUTSIDE_FOOD

These are represented in the UI as a simple schematic block grid — not a
geographic map.

## Prerequisites

- Node.js 18+ and npm
- Python 3.10+

## Backend Setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate     # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend will run at http://localhost:8000
Check it's alive: http://localhost:8000/health
Interactive API docs: http://localhost:8000/docs

On first run, `hostel_outbreak_radar.db` (SQLite) is created automatically and
seeded with the 20 campus blocks (B01–B12, G01–G08).

### API Endpoints

| Method | Path       | Description                          |
|--------|------------|---------------------------------------|
| GET    | /health    | Health check                          |
| GET    | /blocks    | List all hostel blocks                |
| POST   | /reports   | Submit a symptom report               |
| GET    | /reports   | List all symptom reports              |
| POST   | /meals     | Submit a meal record                  |
| GET    | /meals     | List all meal records                 |

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

Frontend will run at http://localhost:5173 and will call the backend's
`/health` endpoint on load to confirm connectivity.

## Tech Stack

- **Frontend:** React + Vite, Recharts (for future charts)
- **Backend:** Python + FastAPI
- **Database:** SQLite (reports, meals, blocks tables)
- **Data processing:** Pandas, NumPy, scikit-learn (not yet used)

## Not Yet Implemented (by design, for this skeleton phase)

- Outbreak detection logic
- Machine learning / anomaly scoring
- Source attribution (linking illness to a specific meal/mess)
- Notifications
- Real maps / GIS
- Authentication

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
details on the scenario design. No outbreak detection is implemented — this
is data generation only.

## Next Steps (future work)

- Build ingestion pipeline to load `/data` CSVs into the backend SQLite DB
- Add analysis notebooks in `/analysis` for trend/cluster detection using reports + meals data
- Wire up Recharts visualizations on the frontend (reports over time, per-block counts)
- Design the schematic campus block layout (illustrative, not GIS-based)