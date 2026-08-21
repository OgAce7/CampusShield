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
- **Database:** SQLite (not yet wired up)
- **Data processing:** Pandas, NumPy, scikit-learn (not yet used)

## Not Yet Implemented (by design, for this skeleton phase)

- Outbreak detection logic
- Machine learning / anomaly scoring
- Database persistence
- Notifications
- Real maps / GIS
- Authentication

## Next Steps (future work)

- Add SQLite schema + models for symptom/case logs per hostel/mess
- Build ingestion pipeline for mock/real data into `/data`
- Add analysis notebooks in `/analysis` for trend/cluster detection
- Wire up Recharts visualizations on the frontend
- Design the schematic campus block layout (illustrative, not GIS-based)
