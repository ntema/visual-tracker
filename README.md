# VisualTracker Studio

A web workspace for comparing single-object trackers (CSRT, KCF, MOSSE and GOTURN).

## Run locally

1. Start MongoDB: `docker compose up -d mongodb`
2. Install frontend packages: `npm install`
3. Start the API in a Python 3.11+ environment:
   `py -m pip install -r backend/requirements.txt`
4. Run the API: `py -m uvicorn backend.main:app --reload --port 8000`
5. Run the frontend: `npm run dev`

Copy `backend/.env.example` to `backend/.env` when using non-default MongoDB settings. Copy `.env.example` to `.env.local` for a different API URL.

The current API persists uploaded session metadata, initialization coordinates, selected trackers and result records in MongoDB. The tracking endpoint is structured for the parallel OpenCV worker implementation and currently records selected jobs as `queued`; benchmark execution can be added without changing the frontend contract.
