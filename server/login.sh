#!/usr/bin/env bash
# Вход в Claude для ботов Clawds (Linux/macOS).
# Данные входа хранятся в server/claude-config, личный ~/.claude не трогается.
# Параметр fresh: сначала выйти из старого входа (его даёт приложение, когда вход уже был).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export CLAUDE_CONFIG_DIR="$SCRIPT_DIR/claude-config"
# Как и в login.cmd: чистим унаследованные ключи, чтобы использовался вход по подписке.
export ANTHROPIC_API_KEY=
export ANTHROPIC_AUTH_TOKEN=
export ANTHROPIC_BASE_URL=
if [ "${1:-}" = "fresh" ]; then
  echo "Выходим из прежнего входа..."
  claude auth logout
fi
echo
echo 'Сейчас откроется страница Anthropic. Нажмите там "Authorize" (принять) и вернитесь в это окно.'
echo "Пока вы не подтвердили вход на странице, здесь будет ожидание. Окно не закрывайте."
echo
claude auth login
echo
echo "===== Итог ====="
claude auth status
echo
echo 'Если выше написано "loggedIn": true, вход выполнен, окно можно закрыть.'
read -r -p "Нажмите Enter, чтобы закрыть окно..." _
