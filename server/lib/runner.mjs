// Запуск одного Claude Code (claude -p) и разбор его stream-json
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const CLAUDE = process.env.CLAUDE_BIN || 'claude'
const CLAUDE_PREFIX = process.env.CLAUDE_PREFIX ? JSON.parse(process.env.CLAUDE_PREFIX) : [] // для тестов с подставным claude

const short = (v, n = 160) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > n ? s.slice(0, n) + '…' : s
}
// mcp__clawds__send -> «clawds · send», остальное без изменений
const toolName = (name) => {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  return m ? `${m[1]} · ${m[2]}` : name
}
// Кратко для карточки: у MCP-инструментов значения аргументов через пробел, у остальных главное поле
const toolInput = (name, input = {}) => {
  if (name.startsWith('mcp__')) {
    const vals = Object.values(input).filter((v) => v !== '' && v !== null && v !== undefined)
    return short(vals.length ? vals.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' · ') : '', 200)
  }
  return short(input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input)
}
const toolOutput = (c) =>
  typeof c === 'string' ? short(c, 2000) : Array.isArray(c) ? short(c.map((x) => x.text ?? '').join('\n'), 2000) : ''

function cleanEnv(extra, configDir) {
  // Без ключей API и переменных родительской сессии Claude Code: иначе оплата по API
  // или чужой маршрут. Подписка берётся из CLAUDE_CONFIG_DIR бота.
  const env = { ...process.env }
  for (const k of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_|ANTHROPIC_|AI_AGENT)/.test(k) && !['CLAUDE_CODE_GIT_BASH_PATH'].includes(k)) delete env[k]
  }
  env.CLAUDE_CONFIG_DIR = configDir
  if (!env.CLAUDE_CODE_GIT_BASH_PATH) {
    const bash = ['D:/Git/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe'].find((p) => existsSync(p))
    if (bash) env.CLAUDE_CODE_GIT_BASH_PATH = bash
  }
  return { ...env, ...extra }
}

/**
 * opts: { cwd, configDir, model, prompt, systemAppend, addDirs, permissionMode, chrome, sessionId, env }
 * h: { session(id), text(delta), toolStart({id,tool,input}), toolEnd({id,output,error}), rate(info), usage({cost}), error(msg) }
 * Возвращает { promise, kill }
 */
export function runClaude(opts, h) {
  let child
  let killed = false
  const promise = new Promise((resolve) => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', opts.permissionMode || 'bypassPermissions']
    for (const d of opts.addDirs ?? []) args.push('--add-dir', d)
    if (opts.tools !== undefined) args.push('--tools', opts.tools) // '' отключает все инструменты
    if (opts.noSession) args.push('--no-session-persistence')
    if (opts.model) args.push('--model', opts.model)
    if (opts.effort) args.push('--effort', opts.effort)
    if (opts.systemAppend) args.push('--append-system-prompt', opts.systemAppend)
    if (opts.chrome) args.push('--chrome')
    if (opts.mcpConfig) args.push('--mcp-config', JSON.stringify(opts.mcpConfig))
    if (opts.sessionId) args.push('--resume', opts.sessionId)

    child = spawn(CLAUDE, [...CLAUDE_PREFIX, ...args], {
      cwd: opts.cwd, env: cleanEnv(opts.env, opts.configDir), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      // POSIX: отдельная группа процессов, чтобы kill() гасил всё дерево, а не только claude
      detached: process.platform !== 'win32',
    })
    child.stdin.end(opts.prompt)

    let alive = false
    let failed = ''
    let streamed = false
    let finished = false
    const finish = () => { if (!finished) { finished = true; clearTimeout(watchdog); resolve() } }

    // Если claude молчит (нет входа или связи), не висим вечно
    const watchdog = setTimeout(() => {
      if (alive) return
      h.error('claude не ответил за 90 секунд: нет связи с Anthropic или не выполнен вход (кнопка «Подключения» → «Войти в Claude»).')
      kill()
      finish()
    }, 90_000)

    const handle = (ev) => {
      if (ev.type !== 'system') alive = true
      if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) h.session?.(ev.session_id)
      else if (ev.type === 'stream_event') {
        const d = ev.event?.delta
        if (ev.event?.type === 'content_block_delta' && d?.type === 'text_delta' && d.text) { streamed = true; h.text(d.text) }
      } else if (ev.type === 'assistant') {
        for (const b of ev.message?.content ?? []) if (b.type === 'tool_use') h.toolStart({ id: b.id, tool: toolName(b.name), input: toolInput(b.name, b.input) })
      } else if (ev.type === 'user') {
        for (const b of ev.message?.content ?? [])
          if (b.type === 'tool_result') h.toolEnd({ id: b.tool_use_id, output: toolOutput(b.content), error: !!b.is_error })
      } else if (ev.type === 'rate_limit_event') {
        h.rate?.(ev.rate_limit_info)
      } else if (ev.type === 'result') {
        if (ev.session_id) h.session?.(ev.session_id)
        if (ev.is_error) failed = typeof ev.result === 'string' ? ev.result : 'Ошибка запуска'
        else if (!streamed && typeof ev.result === 'string' && ev.result) h.text(ev.result)
        h.usage?.({ cost: ev.total_cost_usd, turns: ev.num_turns })
      }
    }

    let buf = ''
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        try { handle(JSON.parse(line)) } catch { /* не JSON */ }
      }
    })
    let err = ''
    child.stderr.on('data', (c) => { err += c.toString() })
    child.on('error', (e) => { h.error(`Не удалось запустить claude: ${e.message}`); finish() })
    child.on('close', (code) => {
      if (finished) return
      if (failed) h.error(failed)
      else if (code !== 0 && !killed) h.error(short(err || `claude завершился с кодом ${code}`, 400))
      finish()
    })
  })
  const kill = () => {
    killed = true
    if (!child?.pid) return
    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true })
      return
    }
    // POSIX: отрицательный PID гасит всю группу процессов (дерево).
    // Ребёнок запущен detached и возглавляет свою группу (см. выше).
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* уже завершён */ }
  }
  return { promise, kill }
}

// Разовый запрос к модели без инструментов и без сессии: возвращает текст ответа
export function runOnce(opts) {
  let text = ''
  let error = ''
  const { promise } = runClaude(
    { ...opts, permissionMode: 'plan', tools: '', noSession: true, chrome: false },
    { text: (d) => { text += d }, toolStart() {}, toolEnd() {}, error: (e) => { error = e } },
  )
  return promise.then(() => { if (!text.trim() && error) throw new Error(error); return text.trim() })
}
