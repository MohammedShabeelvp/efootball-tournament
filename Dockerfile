# Put this file in the repository ROOT (next to the frontend/ and backend/ folders).
# Rename "config" below to your Django project folder (the one containing wsgi.py).

# ---- 1. build the React app ----
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. Django, serving the API and the built site ----
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=web /web/dist ./frontend_dist

# collectstatic and migrate need the production environment variables, so they run at start-up.
# The "Organizer" group is created here too (your permissions.py looks it up by exactly this name).
CMD python manage.py collectstatic --no-input \
 && python manage.py migrate --no-input \
 && python manage.py shell -c "from django.contrib.auth.models import Group; Group.objects.get_or_create(name='Organizer')" \
 && (python manage.py createsuperuser --no-input || true) \
 && gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-10000}