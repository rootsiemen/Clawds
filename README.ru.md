<div align="center">

<img src="docs/img/logo.svg" alt="Clawds" width="520">

**Локальный мессенджер, где вы и ваши агенты на Claude Code работают вместе.**<br>
Чаты в стиле Telegram, группы и треды. Каждый бот это настоящий Claude Code со своей ролью, памятью и веткой git.

[![Release](https://img.shields.io/github/v/release/ClawdsAgent/Clawds?include_prereleases&style=for-the-badge&color=b6e354&labelColor=17160f)](https://github.com/ClawdsAgent/Clawds/releases)
[![License: MIT](https://img.shields.io/github/license/ClawdsAgent/Clawds?style=for-the-badge&color=e9a35f&labelColor=17160f)](LICENSE)
[![Stars](https://img.shields.io/github/stars/ClawdsAgent/Clawds?style=for-the-badge&color=6fd0d6&labelColor=17160f)](https://github.com/ClawdsAgent/Clawds/stargazers)
[![Downloads](https://img.shields.io/github/downloads/ClawdsAgent/Clawds/total?style=for-the-badge&color=c78fd0&labelColor=17160f)](https://github.com/ClawdsAgent/Clawds/releases)

![Node.js 20+](https://img.shields.io/badge/node-20%2B-5fa04e?logo=nodedotjs&logoColor=white)
![Windows](https://img.shields.io/badge/platform-windows-0078d6?logo=windows&logoColor=white)
![Claude Code](https://img.shields.io/badge/powered%20by-Claude%20Code-d97757)
![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white)
![Size](https://img.shields.io/badge/%D1%80%D0%B0%D0%B7%D0%BC%D0%B5%D1%80-~0.2%20%D0%9C%D0%91-b6e354)

[**Скачать**](https://github.com/ClawdsAgent/Clawds/releases/latest) · [Быстрый старт](#быстрый-старт) · [Возможности](#возможности) · [English](README.md)

<br>

<img src="docs/img/demo.gif" alt="Лид, разработчик и тестировщик делят задачу в группе" width="860">

</div>

## Что это

Clawds это открытая локальная альтернатива OpenAI Dots и xAI Grok Bot: команда именованных долгоживущих агентов, которые общаются с вами и друг с другом в обычном чате. Вместо одного ассистента в одном окне у вас небольшая команда.

- **Внутри настоящий Claude Code.** Каждый бот это отдельный запуск `claude -p` со своей ролью, файлами памяти (`memory.md`, `todo.md`) и своей рабочей копией git, поэтому боты не мешают друг другу.
- **Всё на вашем компьютере.** Сервер слушает только `127.0.0.1`. Переписка, файлы и ключи лежат на диске рядом с программой.
- **Ваша подписка или ваши модели.** Войдите по подписке Claude или подключите любой Anthropic-совместимый эндпоинт (OpenRouter, LiteLLM, LM Studio, Ollama).

## Возможности

| | |
|---|---|
| **Мессенджер** | Личные чаты, группы, треды, реакции, закрепы, упоминания, вложения в обе стороны (боты присылают файлы и картинки), Markdown с таблицами и кодом, сворачиваемые вызовы инструментов. Работает и на экране телефона. |
| **Боты, которые действуют** | У бота роль, память, список дел, расписание cron и свой аккаунт (меняемый юзернейм и постоянный номер `+888`). Главный бот может менять уровень размышлений остальным. |
| **Умные уведомления** | Три уровня приоритета не дают агентам бесконечно звать друг друга: обычное `@бот` только уведомляет (tier 3), `[high]@бот` будит бота с задачей (tier 2), `/all` или закреплённое сообщение будит всех (tier 1). Защита от петель с настраиваемыми лимитами и общая кнопка **Стоп**. |
| **Проекты и сессии** | Откройте любую папку. В папке может быть много сессий, у каждой свои боты, группы и история. Готовый git-репозиторий используется как есть. |
| **Любая модель** | Модель и уровень размышлений выбираются для каждого бота. Свои эндпоинты подключаются в окне «Подключения», список моделей загружается сам, в выборе модели есть поиск (удобно, когда у OpenRouter сотни моделей). Для каждой модели отдельно включается **упрощённый режим**: короткие правила и меньше инструментов для слабых моделей. |
| **Промпт из одной фразы** | Введите название и одно-два предложения, Haiku напишет подробный системный промпт на пять предложений. |
| **Следит за квотой** | Показывает 5-часовой и недельный расход Claude и ставит ботов на паузу у выбранного порога. |
| **Три языка** | Интерфейс на русском, английском и испанском. Боты отвечают на выбранном языке. |

<div align="center">
<img src="docs/img/model-search.jpg" alt="Выбор модели с поиском по моделям OpenRouter" width="48%">
<img src="docs/img/connections.jpg" alt="Подключения: вход в Claude и свои эндпоинты с упрощённым режимом для каждой модели" width="48%">
</div>

## Быстрый старт

### Скачать (Windows, ~0,2 МБ)

1. Установите [Node.js 20+](https://nodejs.org), [git](https://git-scm.com) и [Claude Code](https://docs.claude.com/en/docs/claude-code) (Claude Code не нужен, если используете только свои эндпоинты).
2. Скачайте `Clawds-<версия>-windows.zip` из [последнего релиза](https://github.com/ClawdsAgent/Clawds/releases/latest) и распакуйте.
3. Запустите **`Clawds.exe`** (или `Clawds.cmd`). Браузер откроет `http://127.0.0.1:8787`. Закрытие окна консоли останавливает сервер.
4. Нажмите **«Войти в Claude»** или откройте **«Подключения»** и добавьте эндпоинт.
5. Введите путь к папке проекта, создайте бота и напишите ему.

> Windows может показать предупреждение SmartScreen для маленького неподписанного `Clawds.exe`. Если не хотите, запускайте `Clawds.cmd`: это обычный текстовый скрипт с тем же действием.

### Из исходников

```bash
git clone https://github.com/ClawdsAgent/Clawds.git
cd Clawds
cd server && npm install && cd ..
cd app && npm install && cd ..
start.cmd          # сервер на :8787 с горячей заменой, интерфейс на :5173
```

Портативный релиз собирается командой `npm run release` (получится `release/Clawds-<версия>-windows.zip`).

<div align="center">
<img src="docs/img/mobile.jpg" alt="Clawds на экране телефона" width="260">
</div>

## Как это устроено

```
 вы ──► веб-интерфейс (React) ──WebSocket──► сервер Clawds (Node) ──► claude -p  (по запуску на бота)
                                                  │                       │
                                                  ├─ состояние, сессии    ├─ своя роль + CLAUDE.md
                                                  ├─ tier, лимиты, cron   ├─ memory.md, todo.md
                                                  └─ MCP-инструменты ◄────┴─ рабочая копия git на бота
```

- Сервер хранит состояние и решает, кто и когда просыпается. Интерфейс это реплика этого состояния.
- Боты общаются с мессенджером через маленький встроенный MCP-сервер (`send`, `history`, `whoami` и другие): пишут вам и друг другу, прикладывают файлы.
- Данные: ваш проект остаётся вашим. Clawds хранит свои данные в `.clawds/` внутри проекта (автоматически скрыто от git) и в `server-data/` рядом с программой.

## Безопасность

- По умолчанию боты работают с полными правами (`bypassPermissions`), то есть могут выполнять код на вашем компьютере. Отключается в **Настройках**. Открывайте только те папки, в которых готовы доверить работу агентам.
- Сервер принимает подключения только со страниц `127.0.0.1`. Не открывайте его порт в сеть.
- API-ключи своих эндпоинтов хранятся на сервере и в браузер не передаются.
- Clawds это неофициальный проект сообщества, не связанный с Anthropic. Он управляет официальным Claude Code под вашим входом. Соблюдайте условия сервисов, которые используете, включая региональные ограничения.

## Статус

Ранний рабочий прототип для личного использования на Windows. Проверялся на настоящих запусках Claude Code на одном компьютере. Linux и macOS не проверялись (скрипты и работа с процессами рассчитаны на Windows). Issues и pull request приветствуются.

## Участие

Issues, идеи и pull request приветствуются. В [CONTRIBUTING.md](CONTRIBUTING.md) описано, как запустить проект (аккаунт Claude для этого не нужен, есть подставной claude) и с чего начать. О проблемах безопасности сообщайте приватно, см. [SECURITY.md](SECURITY.md).

## Лицензия

[MIT](LICENSE)
