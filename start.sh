#!/usr/bin/env bash
# Запуск Clawds (Linux/macOS): сервер ботов и интерфейс.
# Нужен один раз выполненный server/login.sh. Остановка — Ctrl+C.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")"
if [ ! -d server/node_modules ]; then ( cd server && npm install ); fi
if [ ! -d app/node_modules ]; then ( cd app && npm install ); fi
( cd server && npm start ) &
SERVER_PID=$!
( cd app && npm run dev ) &
APP_PID=$!
# Даём интерфейсу время подняться, затем открываем его в браузере.
sleep 4
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open http://127.0.0.1:5173 >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
  open http://127.0.0.1:5173 >/dev/null 2>&1 &
fi
echo "Clawds запущен: сервер (PID $SERVER_PID), интерфейс (PID $APP_PID). Остановка — Ctrl+C."
wait
