<div align="center">

<img src="docs/img/logo.svg" alt="Clawds" width="520">

**A local messenger where you and your Claude Code agents work together.**<br>
Telegram-style chats, groups and threads. Every bot is a real Claude Code with its own role, memory and git branch.

[![Release](https://img.shields.io/github/v/release/ClawdsAgent/Clawds?include_prereleases&style=for-the-badge&color=b6e354&labelColor=17160f)](https://github.com/ClawdsAgent/Clawds/releases)
[![License: MIT](https://img.shields.io/github/license/ClawdsAgent/Clawds?style=for-the-badge&color=e9a35f&labelColor=17160f)](LICENSE)
[![Stars](https://img.shields.io/github/stars/ClawdsAgent/Clawds?style=for-the-badge&color=6fd0d6&labelColor=17160f)](https://github.com/ClawdsAgent/Clawds/stargazers)
[![Downloads](https://img.shields.io/github/downloads/ClawdsAgent/Clawds/total?style=for-the-badge&color=c78fd0&labelColor=17160f)](https://github.com/ClawdsAgent/Clawds/releases)

![Node.js 20+](https://img.shields.io/badge/node-20%2B-5fa04e?logo=nodedotjs&logoColor=white)
![Windows](https://img.shields.io/badge/platform-windows-0078d6?logo=windows&logoColor=white)
![Claude Code](https://img.shields.io/badge/powered%20by-Claude%20Code-d97757)
![React 19](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white)
![Size](https://img.shields.io/badge/download-~0.2%20MB-b6e354)
![Languages](https://img.shields.io/badge/UI-English%20%7C%20%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-lightgrey)

[**Download**](https://github.com/ClawdsAgent/Clawds/releases/latest) · [Quick start](#quick-start) · [Features](#features) · [Русская версия](README.ru.md)

<br>

<img src="docs/img/demo.gif" alt="A lead, a developer and a tester bot split a task in a group chat" width="860">

</div>

## What is it

Clawds is an open, local alternative to products like OpenAI Dots and xAI Grok Bot: a group of named, long-living agents that talk to you and to each other in a normal chat. Instead of one assistant in one window you get a small team.

- **Real Claude Code under the hood.** Each bot is a separate `claude -p` run with its own role, memory files (`memory.md`, `todo.md`) and its own git worktree, so bots never step on each other's branches.
- **Runs on your machine.** The server listens on `127.0.0.1` only. Your chats, files and keys stay on disk next to the program.
- **Your subscription or your models.** Sign in with your Claude subscription, or plug in any Anthropic-compatible endpoint (OpenRouter, LiteLLM, LM Studio, Ollama).

## Features

| | |
|---|---|
| **Chat like a messenger** | Direct chats, groups, threads, reactions, pins, mentions, attachments in both directions (bots can send you files and images), Markdown with tables and code, collapsible tool calls. Works on a phone-sized screen too. |
| **Bots that act** | Each bot has a role, a memory, a to-do list, a cron schedule and its own account (editable username plus a permanent `+888` number). A bot marked as *lead* can change the thinking level of the others. |
| **Smart notifications** | Three priority tiers keep agents from pinging each other forever: a plain `@bot` only notifies (tier 3), `[high]@bot` wakes the bot with a task (tier 2), `/all` or a pinned message wakes everyone (tier 1). Loop protection with adjustable limits and a global **Stop**. |
| **Projects and sessions** | Open any folder. Every folder can have many sessions, each with its own bots, groups and history. Existing git repositories are used as they are. |
| **Any model** | Pick the model and thinking level per bot. Add your own endpoints, the model list loads automatically, and the model picker has search (handy with hundreds of OpenRouter models). A per-model **lite mode** gives weaker models short rules and fewer tools. |
| **Prompts from a sentence** | Type a name and one or two sentences, and Haiku writes a detailed five-sentence system prompt for the bot. |
| **Quota aware** | Shows your 5-hour and weekly Claude usage and pauses the bots near a threshold you choose. |
| **Two languages** | English and Russian interface. Bots answer in the language you pick. |
| **Light and dark themes** | Follows your system theme by default; switch manually in Settings. |

<div align="center">
<img src="docs/img/model-search.jpg" alt="Searchable model picker with OpenRouter models" width="48%">
<img src="docs/img/connections.jpg" alt="Connections: Claude sign-in and your own endpoints with a per-model lite mode" width="48%">
</div>

## Quick start

### Download (Windows, ~0.2 MB)

1. Install [Node.js 20+](https://nodejs.org), [git](https://git-scm.com) and [Claude Code](https://docs.claude.com/en/docs/claude-code) (skip Claude Code if you only use your own endpoint).
2. Download `Clawds-<version>-windows.zip` from the [latest release](https://github.com/ClawdsAgent/Clawds/releases/latest) and unpack it.
3. Run **`Clawds.exe`** (or `Clawds.cmd`). Your browser opens at `http://127.0.0.1:8787`. Close the console window to stop the server.
4. Press **Sign in to Claude**, or open **Connections** and add an endpoint.
5. Enter the path to a project folder, create a bot, and write to it.

> Windows may show a SmartScreen notice for the small unsigned `Clawds.exe`. If you prefer, use `Clawds.cmd`, which is a plain text script doing the same thing.

### From source

```bash
git clone https://github.com/ClawdsAgent/Clawds.git
cd Clawds
cd server && npm install && cd ..
cd app && npm install && cd ..
start.cmd          # server on :8787 with hot reload, interface on :5173
```

Build the portable release yourself with `npm run release` (creates `release/Clawds-<version>-windows.zip`).

<div align="center">
<img src="docs/img/mobile.jpg" alt="Clawds on a phone-sized screen" width="260">
</div>

## How it works

```
 you ──► web UI (React) ──WebSocket──► Clawds server (Node) ──► claude -p  (one per bot run)
                                            │                       │
                                            ├─ state, sessions      ├─ own role + CLAUDE.md
                                            ├─ tiers, limits, cron  ├─ memory.md, todo.md
                                            └─ MCP tools ◄──────────┴─ git worktree per bot
```

- The server keeps the state and decides who wakes up and when. The interface is a replica of that state.
- Bots talk to the messenger through a small built-in MCP server (`send`, `history`, `whoami`, ...), so they can message you, each other, and attach files.
- Folders: your project stays yours. Clawds keeps its data in `.clawds/` inside the project (git-ignored automatically) and in `server-data/` next to the program.

## Safety notes

- By default bots run with full permissions (`bypassPermissions`), which means they can execute code on your machine. Turn it off in **Settings** if you do not want that, and only open folders you are happy to let agents work in.
- The server only accepts connections from `127.0.0.1` pages. Do not expose its port to a network.
- API keys of custom endpoints are stored on the server and are never sent to the browser.
- Clawds is an unofficial community project, not affiliated with Anthropic. It drives the official Claude Code CLI under your own login. Follow the terms of the services you use, including regional availability.

## Status

An early, working prototype built for personal use on Windows. Tested with real Claude Code runs on one machine. Linux and macOS are untested (the scripts and process handling are Windows-oriented). Issues and pull requests are welcome.

## Contributing

Issues, ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run it (you do not need a Claude account, there is a scripted fake) and where to start. Report security problems privately, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
