# eFootball Tournament Organizer

Admin creates tournaments, adds teams (one team = one player + the club they use),
generates fixtures and enters scores. The public sees Standings, Fixtures and Team details.

- Backend: Django + Django REST Framework (SQLite)
- Frontend: React + Vite + Tailwind CSS v4

## Run the backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py seed_demo        # optional: demo league with some results
python manage.py runserver
```

## Run the frontend (second terminal)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 (Vite proxies /api and /media to Django on port 8000).

## Admin workflow (http://127.0.0.1:8000/admin)

1. Add a **Tournament** and add its teams in the inline form (club, player, logo).
2. In the Tournament list, select it and run the action
   **Generate fixtures (single round)** or **(double round, home & away)**.
   It refuses to run twice, so existing results can't be wiped by accident.
3. Open **Matches** and type scores directly in the list (`home_goals` / `away_goals`).
   Status switches to "played" automatically; the public table updates on refresh.

## API (read-only for the public)

| Endpoint | Description |
|---|---|
| `GET /api/tournaments/` | list |
| `GET /api/tournaments/<id>/` | detail |
| `GET /api/tournaments/<id>/teams/` | teams |
| `GET /api/tournaments/<id>/standings/` | computed table |
| `GET /api/tournaments/<id>/fixtures/?round=3` | matches, optional round filter |
| `GET /api/teams/<id>/` | team stats, last-5 form, all fixtures |
| `POST /api/tournaments/<id>/generate-fixtures/` | admin only, body `{"double_round": true}` |

## Standings rules

Win 3, draw 1, loss 0. Order: points, goal difference, goals for, then name.
The table is always computed from played matches, never stored.

## Tests

```bash
cd backend && python manage.py test
```

## Adding the Organizer role later

Create a Django Group "Organizer", give it permissions on Tournament/Team/Match, and
(or) build organizer-only API endpoints with a custom DRF permission class. Nothing
in the current models needs to change.
