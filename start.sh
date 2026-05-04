#!/bin/sh
# Точка входа для хостинга после npm run build и pip install -r requirements.txt
set -e
PORT="${PORT:-3000}"
PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python
exec "$PY" -m uvicorn main:app --host 0.0.0.0 --port "$PORT"
