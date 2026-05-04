#!/bin/sh
# Ручной запуск без npm (например в Docker). Для панелей с Node: npm start → node start.mjs
set -e
exec node start.mjs
