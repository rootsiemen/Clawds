// Ядро Clawds: состояние, команды, оркестрация ботов. Источник правды находится здесь.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, statSync, readdirSync, rmSync, copyFileSync, realpathSync } from 'node:fs'
import { join, dirname, basename, resolve, sep, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes, createHash } from 'node:crypto'
import { COLORS, autoNumber, usernameRule, cronMatches, MODELS, EFFORTS, supportsEffort } from './lib/rules.mjs'
import { runClaude, runOnce } from './lib/runner.mjs'
import { tr, setLang, getLang } from './lib/locale.mjs'
import { createMcpStore, createSkillStore, seedBuiltins, parseMcpText, readMcpSource, scanMcp, scanSkills, syncBotSkills, testServer, toClaudeEntry, parseSkillMd } from './lib/tools.mjs'
import { parseChats } from './lib/chatimport.mjs'
import { homedir, tmpdir } from 'node:os'
import { createStore, fetchModels, envFor, parseEp, isEp } from './lib/providers.mjs'
import { spawn } from 'node:child_process'
import { ensureRepo, workspaceInfo, setRemote, ensureWorktree, removeWorktree, deleteBranches, isGitRepo } from './lib/git.mjs'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Тексты ботов лежат в lib/prompts.mjs и подгружаются заново при каждой правке файла: перезапуск сервера не нужен
const PROMPTS_FILE = join(dirname(fileURLToPath(import.meta.url)), 'lib', 'prompts.mjs')
let PR = null
let prStamp = 0
async function hotPrompts() {
  const m = statSync(PROMPTS_FILE).mtimeMs
  if (!PR || m !== prStamp) { PR = await import(pathToFileURL(PROMPTS_FILE).href + '?v=' + m); prStamp = m }
  return PR
}
await hotPrompts()
const MCP_FILE = join(ROOT, 'server', 'mcp.mjs')
const HOME = process.env.CLAWDS_HOME || ROOT // для тестов в отдельной папке
export const DATA = join(HOME, 'server-data') // общие данные: недавние сессии и квота
export const CONFIG_DIR = process.env.CLAWDS_CLAUDE_CONFIG || join(ROOT, 'server', 'claude-config')
export const PORT = Number(process.env.CLAWDS_PORT) || 8787 // другой порт нужен только для проверок рядом с рабочим сервером
export const API = `http://127.0.0.1:${PORT}`
const CLI = join(ROOT, 'server', 'clawds.mjs').replace(/\\/g, '/')
const RECENT_FILE = join(DATA, 'recent.json')

// Открытая сессия: папка проекта + свои боты, группы, переписка и память. В одной папке может быть много сессий.
export let WORKSPACE = '' // папка проекта
export let BOTS = '' // папки ботов сессии
export let UPLOADS = ''
let STATE_FILE = ''
let ctx = null // запись о сессии из recent
export const isOpen = () => !!ctx

for (const d of [DATA, CONFIG_DIR]) mkdirSync(d, { recursive: true })

/* ---------- Подключения: вход в Claude и свои эндпоинты (ключи лежат только на сервере) ---------- */

const PROV = createStore(join(DATA, 'providers.json'))
// Сторонние MCP-серверы и навыки: общие для всех сессий, включаются отдельным ботам
const MCP = createMcpStore(join(DATA, 'mcp.json'))
const SKILLS = createSkillStore(join(DATA, 'skills'))
seedBuiltins(SKILLS, join(ROOT, 'server', 'skills'))
export const toolsInfo = () => ({ t: 'tools', mcp: MCP.view(), skills: SKILLS.view() })
const emitTools = () => emit(toolsInfo())
// Модель бота: алиас Claude или ep:<эндпоинт>:<id>. Для второго находим эндпоинт и флаг упрощённого режима.
function resolveModel(m) {
  const e = parseEp(m)
  if (!e) return null
  const p = PROV.get(e.pid)
  if (!p) return null
  return { provider: p, id: e.id, lite: !!p.models.find((x) => x.id === e.id)?.lite }
}
const validModel = (m) => MODELS.includes(m) || !!resolveModel(m)
const claudeLoggedIn = () => {
  try { return !!JSON.parse(readFileSync(join(CONFIG_DIR, '.credentials.json'), 'utf8')).claudeAiOauth?.accessToken } catch { return false }
}
// Отпечаток файла входа: вход считается завершённым, только когда файл изменился (старый вход не в счёт)
const credStamp = () => { try { const st = statSync(join(CONFIG_DIR, '.credentials.json')); return st.mtimeMs + ':' + st.size } catch { return '' } }
let loginWatch = null
// Лёгкая модель для разовых запросов (Haiku по подписке, без входа любая модель своего эндпоинта)
function lightRunOpts() {
  const opts = { cwd: DATA, configDir: CONFIG_DIR, model: 'haiku' }
  if (claudeLoggedIn()) return opts
  const p = PROV.list().find((x) => x.models.length)
  if (!p) err(tr('Нужен вход в Claude или свой эндпоинт: откройте «Подключения»'))
  const m = p.models.find((x) => /haiku|mini|flash|small/i.test(x.id)) ?? p.models[0]
  return { ...opts, model: m.id, env: envFor(p, m.id) }
}
let chatCache = null // последний разобранный файл переписок (чтобы не пересылать его с клиента ещё раз)
export const connInfo = () => ({ t: 'conn', loggedIn: claudeLoggedIn(), pending: !!loginWatch, providers: PROV.view() })
const emitConn = () => emit(connInfo())

/* ---------- Состояние и события ---------- */

const listeners = new Set()
export const onEvent = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
const emit = (ev, except) => listeners.forEach((fn) => fn(ev, except))

// 0 у лимитов передач и /all значит «без ограничения»
const DEFAULT_SETTINGS = {
  fullAccess: true, computerUse: false, claudeInChrome: true, maxParallel: 3, pauseAtPct: 90, pauseAtPct5h: 0, maxChainDepth: 2,
  handoffPair: 3, handoffTotal: 10, handoffWindow: 10, allCooldown: 10,
}
const emptyState = () => ({ bots: [], channels: [], messages: [], accounts: {}, sessions: {}, folders: [], settings: { ...DEFAULT_SETTINGS } })
let S = emptyState()
// Квота относится к аккаунту Claude, а не к сессии
let quota = { known: false, fiveHour: { pct: 0, resetsAt: 0 }, sevenDay: { pct: 0, resetsAt: 0 } }
let workspace = { path: '', remote: '', branches: [], commits: [], tree: [], dirty: 0 }
const typing = {} // channelId -> [botId]
let running = 0

let recent = { sessions: [], profile: null, lastOpen: null, heartbeat: 0 }
function saveRecent() {
  try { writeFileSync(RECENT_FILE + '.tmp', JSON.stringify({ ...recent, quota })); renameSync(RECENT_FILE + '.tmp', RECENT_FILE) } catch (e) { console.error('recent.json:', e.message) }
}
let saveTimer = null
function writeState() {
  if (!ctx) return
  const tmp = STATE_FILE + '.tmp'
  mkdirSync(dirname(STATE_FILE), { recursive: true })
  writeFileSync(tmp, JSON.stringify(S))
  renameSync(tmp, STATE_FILE)
  ctx.bots = S.bots.length
  if (S.accounts.me) recent.profile = { name: S.accounts.me.name, username: S.accounts.me.username, bio: S.accounts.me.bio }
  saveRecent()
}
function persist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(writeState, 400)
}

const uid = () => randomBytes(6).toString('hex')
const now = () => Date.now()

/* ---------- Файлы ботов ---------- */

const botDir = (id) => join(BOTS, id)
const readFile = (p, fallback = '') => { try { return readFileSync(p, 'utf8') } catch { return fallback } }

function ensureBotFiles(bot, claudeMd) {
  const dir = botDir(bot.id)
  mkdirSync(dir, { recursive: true })
  const write = (name, text) => { const p = join(dir, name); if (!existsSync(p)) writeFileSync(p, text) }
  write('CLAUDE.md', claudeMd ?? PR.roleTemplate(bot.name, bot.role))
  write('memory.md', '# Память\n\nЗдесь важное, что нужно помнить между запусками.\n')
  write('todo.md', '# Todo\n\n')
}
const botView = (bot) => {
  const d = botDir(bot.id)
  return { ...bot, claudeMd: readFile(join(d, 'CLAUDE.md')), memory: readFile(join(d, 'memory.md')), todo: readFile(join(d, 'todo.md')) }
}
const putBot = (id, except) => { const b = S.bots.find((x) => x.id === id); if (b) emit({ t: 'put', key: 'bots', value: botView(b) }, except) }

/* ---------- Сессии и начальные данные ---------- */

// Прежние короткие тексты ролей: если файл бота ещё не правили, заменяем его подробным
const OLD_SEED_MD = {
  lead: '# lead\n\nТы главный. Разбираешь задачи пользователя и раздаёшь их ботам dev и tester.\nТолько ты сливаешь ветки в main и делаешь git push.\nПеред слиянием убедись, что tester проверил ветку.\n',
  dev: '# dev\n\nТы разработчик. Работаешь в общем воркспейсе в своей ветке dev/<задача>.\nВ main не пушишь. Закончив, пишешь в канал и упоминаешь @tester.\n',
  tester: '# tester\n\nТы тестировщик. Проверяешь ветки dev: запускаешь тесты, при необходимости смотришь в браузере.\nКод не правишь, отчёт кладёшь в reports/ воркспейса и пишешь в канал.\n',
  research: '# research\n\nТы исследователь. Ищешь в сети и собираешь выжимки в notes/ воркспейса.\n',
}
const DEFAULT_MODEL = { lead: 'opus', research: 'haiku' }

const rulesMark = () => '<!-- clawds-rules ' + createHash('md5').update(PR.SHARED_RULES).digest('hex').slice(0, 8) + ': общий файл, сгенерирован сервером. Уберите эту строку, если правите его вручную -->'

// Служебная ветка, от которой создаётся рабочая копия бота (в каждой сессии свои, чтобы не пересекаться)
const baseBranch = (id) => (ctx?.branchPrefix ? `${ctx.branchPrefix}/${id}` : `${id}/base`)
// Рабочая копия бота: у главного это сама папка проекта, у остальных отдельный worktree
const workDir = (b) => (b.boss ? WORKSPACE : join(botDir(b.id), 'repo'))
async function ensureWorktrees() {
  for (const b of S.bots) if (!b.boss) await ensureWorktree(WORKSPACE, join(botDir(b.id), 'repo'), baseBranch(b.id))
}
function ensureSharedRules() {
  const p = join(BOTS, 'CLAUDE.md')
  const cur = readFile(p, '')
  const generated = cur.startsWith('<!-- clawds-rules')
  const mark = rulesMark()
  if (!cur || (generated && !cur.startsWith(mark))) writeFileSync(p, mark + '\n' + PR.SHARED_RULES)
  // Роли стандартных ботов: обновляем, только если файл остался прежним
  for (const id of Object.keys(PR.ROLES)) {
    const f = join(botDir(id), 'CLAUDE.md')
    if (!existsSync(f)) continue
    const cur = readFile(f)
    const oldShort = cur.startsWith(`# ${id}\n`) && cur.length < 500 && !cur.includes('## ')
    const generatedV1 = cur.startsWith(`# ${id}, `) && !cur.includes('clawds-role v2')
    if (cur === OLD_SEED_MD[id] || oldShort || generatedV1) {
      writeFileSync(join(botDir(id), 'CLAUDE.old.md'), cur)
      writeFileSync(f, PR.ROLES[id].md)
    }
  }
}

function newAccount(id, name, extra = {}) {
  return { id, name, username: id, number: autoNumber(id), primary: 'username', bio: '', blocked: [], muted: [], log: [], ...extra }
}
// Профиль человека переносится между сессиями
function newMe() {
  const p = recent.profile
  return newAccount('me', p?.name ?? tr('Вы'), { username: p?.username ?? 'user', bio: p?.bio ?? '', log: [{ ts: now(), text: tr('Аккаунт создан, номер выдан автоматически') }] })
}

function loadRecent() {
  if (existsSync(RECENT_FILE)) {
    try {
      const j = JSON.parse(readFileSync(RECENT_FILE, 'utf8'))
      recent = { sessions: j.sessions ?? [], profile: j.profile ?? null, lastOpen: j.lastOpen ?? null, heartbeat: j.heartbeat ?? 0, lang: j.lang }
      setLang(recent.lang)
      if (j.quota) quota = j.quota
    } catch (e) { console.error('recent.json повреждён:', e.message) }
  }
  // Число ботов у сессий, ни разу не открытых в этой версии, берём из их файла состояния
  for (const s of recent.sessions) {
    if (s.bots || !existsSync(s.stateFile)) continue
    try { s.bots = JSON.parse(readFileSync(s.stateFile, 'utf8')).bots?.length ?? 0 } catch { /* пропускаем */ }
  }
  // Прежняя установка (одна папка workspace без сессий) становится сессией «Основная»
  const legacyState = join(DATA, 'state.json')
  if (!recent.sessions.length && existsSync(legacyState)) {
    const folder = join(HOME, 'workspace')
    let n = 0
    try { n = JSON.parse(readFileSync(legacyState, 'utf8')).bots?.length ?? 0 } catch { /* пропускаем */ }
    recent.sessions.push({ id: 'legacy', name: 'Основная', folder, botsDir: join(folder, 'bots'), uploadsDir: join(folder, 'uploads'), stateFile: legacyState, branchPrefix: null, created: now(), opened: now(), bots: n })
    saveRecent()
  }
}

// Горячий перезапуск: если сервер перезапустился сразу после работы (правка кода), открытая сессия возвращается сама,
// а интерфейс переподключается. При обычном запуске показывается выбор папки.
export async function init() {
  loadRecent()
  const hot = recent.lastOpen && now() - (recent.heartbeat ?? 0) < 20_000
  if (hot) { try { await openSession(recent.lastOpen) } catch (e) { console.error('Не удалось вернуть сессию:', e.message) } }
  setInterval(() => { if (ctx) { recent.heartbeat = now(); saveRecent() } }, 5000)
}

const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()
const recentView = () =>
  recent.sessions.slice().sort((a, b) => b.opened - a.opened)
    .map((s) => ({ id: s.id, name: s.name, folder: s.folder, created: s.created, opened: s.opened, bots: s.bots ?? 0, exists: existsSync(s.folder), current: ctx?.id === s.id }))

function resolveFolder(p) {
  const raw = String(p ?? '').trim().replace(/^"|"$/g, '')
  if (!raw) err(tr('Укажите папку'))
  const f = resolve(raw)
  if (!existsSync(f) || !statSync(f).isDirectory()) err(tr('Такой папки нет: {f}', { f }))
  return f
}

function createSessionEntry(folder, name) {
  const id = uid()
  const dir = join(folder, '.clawds', id)
  const n = recent.sessions.filter((s) => same(s.folder, folder)).length + 1
  const e = {
    id, name: String(name ?? '').trim() || (n === 1 ? 'Сессия' : `Сессия ${n}`), folder,
    botsDir: join(dir, 'bots'), uploadsDir: join(dir, 'uploads'), stateFile: join(dir, 'state.json'),
    branchPrefix: `clawds/${id}`, created: now(), opened: now(), bots: 0,
  }
  recent.sessions.push(e)
  saveRecent()
  return e
}

export const snapshot = () => ({
  bots: S.bots.map(botView), channels: S.channels, messages: S.messages, accounts: S.accounts,
  settings: S.settings, quota, workspace: { ...workspace, folders: S.folders }, typing, running,
  session: ctx ? { id: ctx.id, name: ctx.name, folder: ctx.folder } : null,
})
export const launcherInfo = () => ({ t: 'recent', recent: recentView() })

async function openSession(id) {
  const e = recent.sessions.find((s) => s.id === id) ?? err(tr('Нет такой сессии'))
  if (!existsSync(e.folder)) err(tr('Папка сессии не найдена: {f}', { f: e.folder }))
  if (ctx) await closeSession()
  ctx = e
  e.opened = now()
  recent.lastOpen = e.id
  recent.heartbeat = now()
  WORKSPACE = e.folder; BOTS = e.botsDir; UPLOADS = e.uploadsDir; STATE_FILE = e.stateFile
  mkdirSync(BOTS, { recursive: true }); mkdirSync(UPLOADS, { recursive: true })
  let loaded = null
  if (existsSync(STATE_FILE)) {
    try { loaded = JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch (er) { console.error('state.json повреждён, начинаю сессию заново:', er.message) }
  }
  S = { ...emptyState(), ...(loaded ?? {}) }
  S.settings = { ...DEFAULT_SETTINGS, ...S.settings }
  if (!S.accounts.me) S.accounts.me = newMe()
  if (S.quota?.known && !quota.known) quota = S.quota // прежняя установка хранила квоту в состоянии
  delete S.quota
  for (const x of Object.values(S.accounts)) { delete x.balance; delete x.hearts; delete x.premium } // сердец и магазина больше нет
  for (const b of S.bots) { ensureBotFiles(b); b.effort ??= 'default'; b.boss ??= b.id === 'lead'; b.mcp ??= []; b.skills ??= [] }
  ensureSharedRules()
  // Сообщения, прерванные падением сервера, помечаем завершёнными
  for (const m of S.messages) if (m.streaming) { m.streaming = false; m.error = true; m.text = (m.text ? m.text + '\n\n' : '') + tr('Прервано: сервер был остановлен.') }
  await ensureRepo(WORKSPACE)
  await ensureWorktrees()
  workspace = await workspaceInfo(WORKSPACE)
  writeState()
  emit({ t: 'snapshot', state: snapshot() })
  emit(launcherInfo())
}

async function closeSession() {
  if (!ctx) return
  stopRuns()
  clearTimeout(saveTimer)
  writeState()
  ctx = null; WORKSPACE = ''; BOTS = ''; UPLOADS = ''; STATE_FILE = ''
  recent.lastOpen = null
  S = emptyState()
  workspace = { path: '', remote: '', branches: [], commits: [], tree: [], dirty: 0 }
  for (const k of Object.keys(typing)) delete typing[k]
  agentTokens.clear(); handoffLog.length = 0; tier1Log.clear()
  emit({ t: 'closed' })
  emit(launcherInfo())
}

// Файлы сессии удаляем только внутри её папки и только каталоги bots и uploads
function safeRm(p) {
  const abs = resolve(p)
  if (!ctx || !['bots', 'uploads'].includes(basename(abs)) || !abs.toLowerCase().startsWith(resolve(ctx.folder).toLowerCase() + sep)) err(tr('Отказ: путь вне сессии'))
  rmSync(abs, { recursive: true, force: true })
}

async function resetSession() {
  if (!ctx) err(tr('Сессия не открыта'))
  stopRuns()
  for (const b of S.bots) if (!b.boss) await removeWorktree(WORKSPACE, join(botDir(b.id), 'repo'))
  const ids = new Set(S.bots.map((b) => b.id))
  await deleteBranches(WORKSPACE, (n) => (ctx.branchPrefix ? n.startsWith(ctx.branchPrefix + '/') : n.endsWith('/base') && ids.has(n.slice(0, -5))))
  safeRm(BOTS); safeRm(UPLOADS)
  mkdirSync(BOTS, { recursive: true }); mkdirSync(UPLOADS, { recursive: true })
  const settings = S.settings
  S = { ...emptyState(), settings }
  S.accounts.me = newMe()
  for (const k of Object.keys(typing)) delete typing[k]
  agentTokens.clear(); handoffLog.length = 0; tier1Log.clear()
  workspace = await workspaceInfo(WORKSPACE)
  writeState()
  emit({ t: 'snapshot', state: snapshot() })
  emit(launcherInfo())
}

export async function refreshWorkspace() {
  if (!ctx) return
  workspace = await workspaceInfo(WORKSPACE)
  emit({ t: 'set', key: 'workspace', value: { ...workspace, folders: S.folders } })
}
let wsTimer = null
const refreshWorkspaceSoon = () => { clearTimeout(wsTimer); wsTimer = setTimeout(refreshWorkspace, 800) }

/* ---------- Вспомогательное ---------- */

const toast = (text) => emit({ t: 'toast', text })
const bot = (id) => S.bots.find((b) => b.id === id)
const chan = (id) => S.channels.find((c) => c.id === id)
const acc = (id) => S.accounts[id]
const nameOf = (id) => acc(id)?.name ?? id

function putMsg(m, except) { emit({ t: 'put', key: 'messages', value: m }, except) }
function addMsg(m) {
  const msg = { id: uid(), ts: now(), reactions: {}, ...m }
  S.messages.push(msg)
  putMsg(msg)
  persist()
  return msg
}
const sysMsg = (channelId, text) => addMsg({ channelId, authorId: 'system', text, system: true })
function putChannel(c) { emit({ t: 'put', key: 'channels', value: c }); persist() }
function putAccount(id) { emit({ t: 'put', key: 'accounts', value: acc(id) }); persist() }
const logAcc = (id, text) => { acc(id).log = [{ ts: now(), text }, ...acc(id).log].slice(0, 50) }
function setTyping(cid, botId, on) {
  const cur = typing[cid] ?? []
  typing[cid] = on ? [...new Set([...cur, botId])] : cur.filter((b) => b !== botId)
  emit({ t: 'set', key: 'typing', value: typing })
}

// Находит участника по @handle: имя бота, юзернейм или me
function byHandle(h) {
  const x = String(h).replace(/^@/, '').toLowerCase()
  if (x === 'me') return 'me'
  const b = S.bots.find((b) => b.id === x) ?? S.bots.find((b) => acc(b.id)?.username === x)
  if (b) return b.id
  return Object.values(S.accounts).find((a) => a.username === x)?.id ?? null
}
const chanByName = (n) => S.channels.find((c) => c.kind === 'channel' && c.name === String(n).replace(/^#/, ''))

function dmChannel(a, b) {
  const [x, y] = [a, b].sort()
  const id = a === 'me' || b === 'me' ? `dm-${a === 'me' ? b : a}` : `dm-${x}-${y}`
  let c = chan(id)
  if (!c) { c = { id, kind: 'dm', name: a === 'me' ? b : b === 'me' ? a : `${x} ↔ ${y}`, members: [a, b] }; S.channels.push(c); putChannel(c) }
  return c
}

/* ---------- Оркестрация: запуск ботов ---------- */

// Аварийная остановка: увеличивает эпоху, ожидающие запуски пропускаются, идущие убиваются
let epoch = 0
const activeKills = new Set()
function stopRuns() {
  epoch++
  const n = activeKills.size
  activeKills.forEach((k) => k())
  handoffLog.length = 0
  return n
}
const waiters = []
async function acquire() {
  while (running >= S.settings.maxParallel) await new Promise((r) => waiters.push(r))
  running++
  emit({ t: 'set', key: 'running', value: running })
}
function release() {
  running--
  emit({ t: 'set', key: 'running', value: running })
  waiters.shift()?.()
}

const queues = new Map()
const enqueue = (botId, job) => {
  const next = (queues.get(botId) ?? Promise.resolve()).catch(() => {}).then(job)
  queues.set(botId, next)
  return next
}

export const agentTokens = new Map() // token -> { botId, channelId, depth }

const hhmm = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

function historyFor(botId, ch, threadOf) {
  const list = S.messages.filter((m) => m.channelId === ch.id && (m.threadOf ?? null) === (threadOf ?? null) && !m.system && !(m.streaming && !m.text && !m.tools?.length))
  let from = list.length - 1
  while (from >= 0 && list[from].authorId !== botId) from--
  return list.slice(Math.max(from + 1, list.length - 15))
}

/* ---------- Приоритеты уведомлений ----------
   tier 1: /all или закреплённое важное сообщение группы. Будит всех ботов группы.
   tier 2: @бот от человека, [high]@бот от бота. Будит бота.
   tier 3: @бот от бота без тега, [low]@бот от человека. Только уведомление: адресат увидит его
           при следующем пробуждении и необязан отвечать. */
const isAll = (text) => /(^|\s)\/all\b|@all\b/i.test(String(text))

function parseMentions(text, author) {
  const human = author === 'me'
  const out = new Map()
  for (const m of String(text).matchAll(/(?:\[(high|low)\]\s*)?@([a-z0-9_]+)/gi)) {
    const id = byHandle(m[2])
    if (!id || id === author) continue
    const tag = m[1]?.toLowerCase()
    const tier = human ? (tag === 'low' ? 3 : 2) : (tag === 'high' ? 2 : 3)
    out.set(id, Math.min(out.get(id) ?? 3, tier))
  }
  return out
}

const tier1Log = new Map() // группа -> когда бот в последний раз слал /all
function tier1Allowed(author, channelId) {
  if (author === 'me') return true
  const cd = S.settings.allCooldown
  if (!cd) return true
  if (now() - (tier1Log.get(channelId) ?? 0) < cd * 60_000) return false
  tier1Log.set(channelId, now())
  return true
}

function fmtMsg(m, viewer) {
  const files = (m.attachments ?? []).map((a) => ' [файл: ' + (a.path ?? a.url) + ']').join('')
  const a = acc(m.authorId)
  const tag = m.tier === 1 ? ' [tier 1: важное для всех]' : m.notify?.[viewer] ? ' [для тебя ' + PR.TIER_NOTE[m.notify[viewer]] + ']' : ''
  return '[' + hhmm(m.ts) + '] ' + (a?.name ?? m.authorId) + (a ? ' (@' + a.username + ')' : '') + tag + ': ' + String(m.text).slice(0, 1500) + files
}

const botInfo = (b) => ({
  name: b.name, username: acc(b.id).username, number: acc(b.id).number, role: b.role, boss: !!b.boss,
  workdir: workDir(b).replaceAll('\\', '/'), workspace: WORKSPACE.replaceAll('\\', '/'), botDir: botDir(b.id).replaceAll('\\', '/'),
})

// Язык ответов задаёт интерфейс; правила на русском, но пишут боты на выбранном языке
const langLine = () => (getLang() === 'en' ? 'LANGUAGE: write every chat message, report and file note in English, even though these rules are in Russian. The human uses an English interface.' : 'ЯЗЫК: пиши сообщения по-русски.')

function buildPrompt(b, ch, job, lite = false) {
  const roster = S.bots.filter((x) => x.id !== b.id).map((x) => '@' + acc(x.id).username + ' (' + x.role + ')').join('; ')
  const where = ch.kind === 'dm'
    ? 'личные сообщения с ' + nameOf(job.from)
    : 'группа #' + ch.name + ', участники: ' + ch.members.map((m) => '@' + (acc(m)?.username ?? m)).join(', ')
  const lines = job.trigger ? historyFor(b.id, ch, job.threadOf).slice(lite ? -8 : 0).map((m) => fmtMsg(m, b.id)) : []
  const fromBot = job.from !== 'me' && bot(job.from)
  const who = fromBot ? 'бот ' + nameOf(job.from) + ' (@' + acc(job.from).username + ')' : 'человек ' + nameOf(job.from)
  const task = !job.trigger ? PR.taskLine('schedule', { text: job.text })
    : job.tier === 1 ? PR.taskLine('tier1')
    : fromBot ? PR.taskLine('bot', { who, username: acc(job.from).username })
    : PR.taskLine('human', { who })
  const askedNote = job.trigger || job.text ? skillMentions(job.trigger?.text ?? job.text ?? '').map((n) => '\nПРОСЯТ ПРИМЕНИТЬ НАВЫК /' + n + ': прочитай .claude/skills/' + n + '/SKILL.md в своей папке и следуй ему в этой задаче.').join('') : ''
  const skillsLine = (b.skills ?? []).filter((n) => SKILLS.exists(n)).map((n) => n + ' (' + (SKILLS.get(n)?.description || '').slice(0, 140) + ')').join('; ')
  const skillsNote = skillsLine ? '\nНавыки (инструкции в .claude/skills/<имя>/SKILL.md в твоей папке, прочитай нужный, когда задача подходит): ' + skillsLine : ''
  if (lite) {
    const rosterLite = S.bots.filter((x) => x.id !== b.id).map((x) => '@' + acc(x.id).username).join(', ')
    const headLite = langLine() + '\n' + PR.liteHead(botInfo(b), where, rosterLite, task)
    return job.trigger ? headLite + skillsNote + askedNote + '\n\nПереписка (новое в конце):\n' + lines.join('\n') : headLite + skillsNote + askedNote
  }
  // Динамические сведения кладём в сам запуск: системная инструкция у возобновляемой сессии (--resume) не обновляется
  const head = '[Clawds. Сейчас ' + new Date().toLocaleString(getLang() === 'en' ? 'en-US' : 'ru-RU') + ']\n' + langLine() + '\n' + PR.identityLines(botInfo(b)).join('\n') + '\nГде ты: ' + where + '\nДругие боты: ' + (roster || 'нет') + '\nЧТО ОТ ТЕБЯ НУЖНО: ' + task
  return job.trigger ? head + askedNote + '\n\nПереписка (новое в конце):\n' + lines.join('\n') : head + askedNote
}

const systemAppend = (b) => PR.systemAppend(botInfo(b))

// Решает, кто проснётся от сообщения и кому уйдёт уведомление
function routeMessage(msg, depth, explicitOnly = false) {
  const ch = chan(msg.channelId)
  if (!ch) return
  const author = msg.authorId
  const botsIn = ch.members.filter((m) => m !== 'me' && bot(m))
  const wake = (id, tier) => runBot({ botId: id, channelId: ch.id, from: author, text: msg.text, threadOf: msg.threadOf, depth, trigger: msg, tier })

  if (isAll(msg.text)) {
    if (!tier1Allowed(author, ch.id)) { sysMsg(ch.id, tr('Рассылка /all от {who} отклонена: боты могут слать /all не чаще раза в {n} мин на группу. Лимит меняется в настройках.', { who: nameOf(author), n: S.settings.allCooldown })); return }
    msg.tier = 1
    putMsg(msg); persist()
    botsIn.filter((id) => id !== author).forEach((id) => wake(id, 1))
    return
  }

  const men = [...parseMentions(msg.text, author)].filter(([id]) => ch.members.includes(id))
  if (men.length) {
    msg.notify = Object.fromEntries(men)
    putMsg(msg); persist()
    for (const [id, tier] of men) if (tier === 2 && bot(id)) wake(id, 2)
    return
  }
  if (explicitOnly) return
  if (ch.kind === 'dm') ch.members.filter((m) => m !== author && bot(m)).forEach((id) => wake(id, 2))
  else if (author === 'me') {
    const def = ['lead', ...botsIn].find((id) => botsIn.includes(id) && !acc(id).muted.includes(ch.id))
    if (def) wake(def, 2)
  }
}

// Защита от петель: боты будят друг друга только ограниченное число раз
const handoffLog = []
function handoffAllowed(from, to) {
  const { handoffPair: pair, handoffTotal: total, handoffWindow: win } = S.settings
  const cutoff = now() - Math.max(win, 1) * 60_000
  while (handoffLog.length && handoffLog[0].ts < cutoff) handoffLog.shift()
  if ((total && handoffLog.length >= total) || (pair && handoffLog.filter((h) => h.from === from && h.to === to).length >= pair)) return false
  handoffLog.push({ ts: now(), from, to })
  return true
}

export function runBot(job) {
  const b = bot(job.botId)
  if (!b) return
  const ch = chan(job.channelId)
  if (!ch) return
  if (job.depth > S.settings.maxChainDepth) { sysMsg(ch.id, tr('Цепочка упоминаний оборвана: глубина больше {n}.', { n: S.settings.maxChainDepth })); return }
  if (job.from === 'me' && acc('me').blocked.includes(b.id)) return
  if (job.from !== 'me' && acc(b.id).blocked.includes(job.from)) return
  if (job.from !== 'me' && job.trigger && !handoffAllowed(job.from, b.id)) {
    sysMsg(ch.id, tr('Передача от {a} к {b} остановлена: лимит передач между ботами ({p} на пару и {t} всего за {w} мин). Лимит меняется в настройках.', { a: nameOf(job.from), b: nameOf(b.id), p: S.settings.handoffPair || '∞', t: S.settings.handoffTotal || '∞', w: S.settings.handoffWindow }))
    return
  }
  if (!isEp(b.model) && quota.known) {
    if (S.settings.pauseAtPct && quota.sevenDay.pct >= S.settings.pauseAtPct) {
      sysMsg(ch.id, tr('Боты на паузе: недельная квота {pct}% достигла порога {th}%. Порог меняется в настройках.', { pct: Math.round(quota.sevenDay.pct), th: S.settings.pauseAtPct }))
      return
    }
    if (S.settings.pauseAtPct5h && quota.fiveHour.pct >= S.settings.pauseAtPct5h) {
      sysMsg(ch.id, tr('Боты на паузе: 5-часовая квота {pct}% достигла порога {th}%. Порог меняется в настройках.', { pct: Math.round(quota.fiveHour.pct), th: S.settings.pauseAtPct5h }))
      return
    }
  }
  job.epoch = epoch
  return enqueue(b.id, () => doRun(b, ch, job))
}

async function doRun(b, ch, job) {
  await hotPrompts()
  ensureSharedRules()
  const sid = ctx?.id
  const alive = () => ctx?.id === sid // сессию могли закрыть или сменить посреди запуска
  if (job.epoch !== epoch || !alive()) return
  await acquire()
  if (job.epoch !== epoch || !alive()) { release(); return }
  setTyping(ch.id, b.id, true)
  const today = new Date().toISOString().slice(0, 10)
  if (b.runsDay !== today) { b.runsDay = today; b.runsToday = 0; b.costToday = 0 }
  b.runsToday++
  b.sleeping = false

  const msg = addMsg({ channelId: ch.id, authorId: b.id, text: '', streaming: true, tools: [], threadOf: job.threadOf })
  const token = randomBytes(16).toString('hex')
  agentTokens.set(token, { botId: b.id, channelId: ch.id, depth: job.depth, sent: [] })
  let final = ''
  const firstOutput = () => setTyping(ch.id, b.id, false)

  const rm = resolveModel(b.model)
  const lite = !!rm?.lite // упрощённый режим выбирается отдельно для каждой модели эндпоинта
  const epEnv = rm ? envFor(rm.provider, rm.id) : {}
  // Сторонние MCP: включённые боту и помеченные «всем ботам». Навыки раскладываются в .claude/skills папки бота.
  const extMcp = {}
  for (const x of MCP.list()) if (x.allBots || (b.mcp ?? []).includes(x.id)) extMcp[x.id] = toClaudeEntry(x)
  const asked = skillMentions(job.trigger?.text ?? job.text ?? '')
  const botSkills = (() => { try { return syncBotSkills(SKILLS, botDir(b.id), [...new Set([...(b.skills ?? []), ...asked])]) } catch (e) { console.error('навыки:', e.message); return [] } })()
  const { promise, kill } = runClaude(
    {
      cwd: botDir(b.id), configDir: CONFIG_DIR, model: rm ? rm.id : (isEp(b.model) ? parseEp(b.model)?.id : b.model), effort: !isEp(b.model) && b.effort && b.effort !== 'default' && supportsEffort(b.model) ? b.effort : undefined,
      prompt: buildPrompt(b, ch, job, lite), systemAppend: lite ? PR.systemAppendLite(botInfo(b), readFile(join(botDir(b.id), 'CLAUDE.md'))) : systemAppend(b),
      addDirs: [WORKSPACE, ...S.folders], permissionMode: S.settings.fullAccess ? 'bypassPermissions' : 'acceptEdits',
      chrome: !!S.settings.claudeInChrome && !lite, sessionId: S.sessions[b.id], tools: lite ? 'Read,Write,Edit,Bash,Glob,Grep' : undefined,
      mcpConfig: { mcpServers: { ...extMcp, clawds: { command: process.execPath, args: [MCP_FILE], env: { CLAWDS_API: API, CLAWDS_TOKEN: token, ...(lite ? { CLAWDS_LITE: '1' } : {}) } } } },
      env: { CLAWDS_API: API, CLAWDS_BOT: b.id, CLAWDS_TOKEN: token, ENABLE_TOOL_SEARCH: Object.keys(extMcp).length ? 'auto' : 'false', ...(lite ? { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1' } : {}), ...epEnv }, // инструменты Clawds сразу в контексте, без ToolSearch
    },
    {
      session: (sid) => { if (S.sessions[b.id] !== sid) { S.sessions[b.id] = sid; persist() } },
      text: (d) => { if (!alive()) return; firstOutput(); final += d; msg.text += d; emit({ t: 'text', id: msg.id, delta: d }) },
      toolStart: (t) => { if (!alive()) return; firstOutput(); const tool = { ...t, done: false }; (msg.tools ??= []).push(tool); emit({ t: 'tool', id: msg.id, tool }) },
      toolEnd: (r) => { if (!alive()) return; const t = msg.tools?.find((x) => x.id === r.id); if (t) { t.output = r.output; t.done = true; emit({ t: 'toolEnd', id: msg.id, toolId: r.id, output: r.output }) } },
      rate: (info) => {
        const w = info?.unifiedWindows
        if (!w) return
        quota = {
          known: true,
          fiveHour: { pct: (w.five_hour?.utilization ?? 0) * 100, resetsAt: (w.five_hour?.resetsAt ?? 0) * 1000 },
          sevenDay: { pct: (w.seven_day?.utilization ?? 0) * 100, resetsAt: (w.seven_day?.resetsAt ?? 0) * 1000 },
        }
        emit({ t: 'set', key: 'quota', value: quota })
        saveRecent()
      },
      usage: (u) => { b.costToday = (b.costToday ?? 0) + (u.cost ?? 0) },
      error: (e) => { if (!alive()) return; msg.error = true; msg.text = (msg.text ? msg.text + '\n\n' : '') + `Ошибка: ${e}`; emit({ t: 'text', id: msg.id, delta: '', full: msg.text }) },
    },
  )
  activeKills.add(kill)
  await promise
  activeKills.delete(kill)

  const sentByTool = agentTokens.get(token)?.sent ?? []
  agentTokens.delete(token)
  if (!alive()) { release(); return }
  if (job.epoch !== epoch) { msg.error = true; msg.text = (msg.text ? msg.text + '\n\n' : '') + tr('Остановлено вами.') }
  msg.streaming = false
  for (const t of msg.tools ?? []) t.done = true
  // Строки [файл: путь] в ответе бота становятся вложениями
  const markers = [...msg.text.matchAll(/\[(?:файл|attach)\s*:\s*([^\]\n]+)\]/gi)]
  if (markers.length && !msg.error) {
    const { attachments, bad } = attachFromPaths(markers.map((m) => m[1]))
    msg.text = msg.text.replace(/\[(?:файл|attach)\s*:\s*[^\]\n]+\]/gi, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    if (attachments.length) msg.attachments = [...(msg.attachments ?? []), ...attachments]
    if (bad.length) msg.text += (msg.text ? '\n\n' : '') + tr('Не удалось приложить: {l}', { l: bad.join(', ') })
    emit({ t: 'text', id: msg.id, delta: '', full: msg.text })
    final = msg.text
  }
  // «Право на молчание»: ответ [молчу] не показываем в чате (карточки инструментов остаются, если были)
  // Дубль: то же самое бот уже отправил в этот чат инструментом send, финальный текст повторять не нужно
  const norm = (t) => String(t).toLowerCase().replace(/[\s\p{P}]+/g, ' ').trim()
  const dupe = !!norm(msg.text) && sentByTool.some((x) => x.channelId === ch.id && (norm(x.text) === norm(msg.text) || (norm(msg.text).length >= 30 && (norm(x.text).includes(norm(msg.text)) || norm(msg.text).includes(norm(x.text))))))
  const silent = (/^\s*\[молчу\]\s*\.?\s*$/i.test(msg.text) || dupe) && !msg.error && !msg.attachments?.length
  if (silent) {
    final = ''
    if (msg.tools?.length) msg.text = ''
    else {
      S.messages = S.messages.filter((m) => m.id !== msg.id)
      emit({ t: 'del', key: 'messages', id: msg.id })
    }
  }
  if (!silent && !msg.error) msg.refs = computeRefs(msg.text, b.id)
  if (!silent || msg.tools?.length) putMsg(msg)
  setTyping(ch.id, b.id, false)
  release()
  emit({ t: 'put', key: 'bots', value: botView(b) })
  persist()
  refreshWorkspaceSoon()
  // Ответ бота будит других только по явным меткам: [high]@бот (tier 2) или /all (tier 1). Простое @бот это лишь уведомление.
  if (final && !msg.error) routeMessage(msg, job.depth + 1, true)
}

/* ---------- Вложения от ботов ---------- */

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.csv': 'text/csv',
  '.html': 'text/html', '.zip': 'application/zip', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
}
const lower = (p) => resolve(p).toLowerCase()
const inside = (file, root) => lower(file).startsWith(lower(root) + sep)

// Бот может приложить файл из проекта, папок сессии, добавленных папок и вложения из чатов. Служебное и системное нельзя.
function attachFromPaths(paths) {
  const roots = [WORKSPACE, BOTS, UPLOADS, ...S.folders].filter(Boolean)
  const out = []
  const bad = []
  for (const raw of paths) {
    const p = String(raw).trim().replace(/^["'`]|["'`]$/g, '')
    if (!p) continue
    try {
      if (!existsSync(p)) throw new Error('файла нет')
      const real = realpathSync(p) // ссылки раскрываем, чтобы не выйти за разрешённые папки
      if (!statSync(real).isFile()) throw new Error('это не файл')
      if (!roots.some((r) => inside(real, realpathSync(r)))) throw new Error('вне проекта и вложений')
      const parts = lower(real).split(sep)
      if (parts.includes('.git') || basename(real).toLowerCase() === 'state.json' || basename(real) === '.credentials.json' || parts.includes('claude-config')) throw new Error('служебный файл')
      const size = statSync(real).size
      if (size > 25 * 1024 * 1024) throw new Error('больше 25 МБ')
      const name = basename(real)
      const mime = MIME_BY_EXT[extname(name).toLowerCase()] ?? 'application/octet-stream'
      if (inside(real, realpathSync(UPLOADS))) {
        // уже загруженное вложение чата: используем как есть
        const id = basename(real)
        out.push({ id, name: name.replace(/^[0-9a-f]{12}-/, ''), size, mime, url: API + '/files/' + encodeURIComponent(id), path: real.replaceAll('\\', '/') })
      } else {
        const id = uid() + '-' + name.replace(/[^\w.\-а-яА-Я ]/g, '_')
        const dest = join(UPLOADS, id)
        copyFileSync(real, dest)
        out.push({ id, name, size, mime, url: API + '/files/' + encodeURIComponent(id), path: dest.replaceAll('\\', '/') })
      }
    } catch (e) { bad.push(p + ' (' + e.message + ')') }
  }
  return { attachments: out, bad }
}

/* ---------- Файлы в сообщениях и навыки по «/имени» ---------- */

const TEXT_EXT = new Set(['.txt', '.md', '.mdx', '.json', '.jsonl', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.scss', '.html', '.htm', '.xml', '.svg', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.env.example', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh', '.bat', '.cmd', '.ps1', '.sql', '.csv', '.tsv', '.log', '.diff', '.patch', '.gitignore', '.lock', '.vue', '.svelte', '.lua', '.swift'])
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'])
const fileKind = (p) => { const e = extname(p).toLowerCase(); return IMG_EXT.has(e) ? 'image' : TEXT_EXT.has(e) || !e ? 'text' : 'binary' }

// Файл можно показывать, если он внутри проекта, папок ботов, вложений или добавленных папок и не служебный
function readableFile(p) {
  if (!existsSync(p)) return null
  const real = realpathSync(p)
  const st = statSync(real)
  if (!st.isFile()) return null
  const roots = [WORKSPACE, BOTS, UPLOADS, ...S.folders].filter((r) => r && existsSync(r))
  if (!roots.some((r) => inside(real, realpathSync(r)))) return null
  const parts = lower(real).split(sep)
  if (parts.includes('.git') || parts.includes('claude-config') || basename(real).toLowerCase() === 'state.json' || basename(real) === '.credentials.json') return null
  return { real, size: st.size }
}

// Путь из сообщения: относительный считаем от рабочей папки автора, потом от проекта и папки бота. «:42» в конце это строка.
function resolveFileRef(ref, authorId) {
  const m = /^(.*?)(?::(\d{1,6}))?(?::\d{1,4})?$/.exec(String(ref).trim())
  const raw = m?.[1] ?? ''
  if (!raw || raw.length > 260 || /:\/\/|[<>|*?"]/.test(raw) || /^\s|\s$/.test(raw)) return null
  const b = bot(authorId)
  const bases = [b ? workDir(b) : null, WORKSPACE, b ? botDir(b.id) : null, BOTS, UPLOADS, ...S.folders].filter(Boolean)
  const cands = /^([A-Za-z]:[\\/]|[\\/])/.test(raw) ? [raw] : bases.map((base) => join(base, raw))
  for (const c of cands) {
    try { const f = readableFile(c); if (f) return { ...f, line: m?.[2] ? Number(m[2]) : 0 } } catch { /* следующий вариант */ }
  }
  return null
}

// Пути в `обратных кавычках`, которые указывают на существующие файлы, помечаем кликабельными
function computeRefs(text, authorId) {
  const refs = {}
  let n = 0
  for (const m of String(text ?? '').matchAll(/`([^`\n]{2,260})`/g)) {
    const ref = m[1].trim()
    if (refs[ref] || n >= 30) continue
    if (!/[\\/]|\.[A-Za-z0-9]{1,8}(:\d+)*$/.test(ref)) continue // похоже на путь: есть слэш или расширение
    const f = resolveFileRef(ref, authorId)
    if (f) { refs[ref] = { kind: fileKind(f.real), size: f.size }; n++ }
  }
  return n ? refs : undefined
}

// «/code-review» в тексте: просят применить навык (кроме /all)
function skillMentions(text) {
  const out = []
  for (const m of String(text ?? '').matchAll(/(?<![\w/`])\/([a-z][a-z0-9_-]{1,31})(?![\w/-])/g)) if (m[1] !== 'all' && SKILLS.exists(m[1]) && !out.includes(m[1])) out.push(m[1])
  return out
}

/* ---------- Команды (клиент и агенты) ---------- */

const err = (m) => { throw new Error(m) }

function sendMessage(actor, channelId, text, { threadOf, attachments, depth = 0 } = {}) {
  const ch = chan(channelId) ?? err(tr('Нет такого чата'))
  if (!ch.members.includes(actor)) err(tr('Вы не участник этого чата'))
  const t = String(text ?? '').trim()
  if (!t && !attachments?.length) err(tr('Пустое сообщение'))
  // Заблокированным в личке не доставляем
  const peer = ch.kind === 'dm' ? ch.members.find((m) => m !== actor) : null
  if (peer && peer !== actor && acc(peer)?.blocked.includes(actor)) err(tr('Вам не отвечают: вы заблокированы'))
  if (peer && actor !== 'me' && acc(actor).blocked.includes(peer)) err(tr('Вы заблокировали этого участника'))
  const msg = addMsg({ channelId, authorId: actor, text: t, threadOf, attachments, refs: computeRefs(t, actor) })
  routeMessage(msg, depth)
  return msg
}

export const commands = {
  send: (actor, a) => { sendMessage(actor, a.channelId, a.text, a); return {} },
  react: (actor, a) => {
    const m = S.messages.find((x) => x.id === a.msgId) ?? err(tr('Нет сообщения'))
    const cur = m.reactions[a.emoji] ?? []
    const next = cur.includes(actor) ? cur.filter((x) => x !== actor) : [...cur, actor]
    if (next.length) m.reactions[a.emoji] = next; else delete m.reactions[a.emoji]
    putMsg(m); persist()
  },
  pin: (actor, a) => {
    const m = S.messages.find((x) => x.id === a.msgId) ?? err(tr('Нет сообщения'))
    m.pinned = !m.pinned
    const ch = chan(m.channelId)
    if (m.pinned && ch?.kind === 'channel' && actor === 'me') {
      m.tier = 1 // закреплённое важное сообщение группы будит всех ботов группы
      ch.members.filter((id) => id !== m.authorId && bot(id)).forEach((id) => runBot({ botId: id, channelId: ch.id, from: actor, text: 'Закреплено: ' + m.text, threadOf: m.threadOf, depth: 0, trigger: m, tier: 1 }))
    } else if (!m.pinned && m.tier === 1) delete m.tier
    putMsg(m); persist()
  },

  createBot: (actor, a) => {
    const n = String(a.name ?? '').trim().toLowerCase()
    if (!/^[a-z][a-z0-9_-]{1,23}$/.test(n)) err(tr('Имя бота: латиница, цифры, «-» и «_», от 2 до 24 символов, первая буква'))
    if (S.bots.some((b) => b.id === n)) err(tr('Такой бот уже есть'))
    // Для имён lead, dev, tester, research без описания берём готовую роль
    const preset = !String(a.role ?? '').trim() ? PR.ROLES[n] : null
    const role = preset?.role ?? (String(a.role ?? '').trim() || 'Новый бот.')
    const b = { id: n, name: n, role, color: COLORS[S.bots.length % COLORS.length], model: validModel(a.model) ? a.model : (DEFAULT_MODEL[n] ?? 'sonnet'), effort: EFFORTS.includes(a.effort) ? a.effort : 'default', boss: n === 'lead' && !S.bots.some((x) => x.boss), schedule: [], runsToday: 0, runsDay: '', costToday: 0, sleeping: true, mcp: [], skills: [] }
    S.bots.push(b)
    ensureBotFiles(b, preset?.md ?? PR.roleTemplate(n, String(a.prompt ?? '').trim() || role))
    if (!b.boss) void ensureWorktree(WORKSPACE, join(botDir(n), 'repo'), baseBranch(n))
    const taken = Object.values(S.accounts).map((x) => x.username)
    let u = /^[a-z][a-z0-9_]{4,}$/.test(n) ? n : `${n.replace(/-/g, '_')}_bot`
    while (taken.includes(u)) u += Math.floor(Math.random() * 10)
    S.accounts[n] = newAccount(n, n, { username: u, bio: role, log: [{ ts: now(), text: tr('Аккаунт создан, @{u}, номер выдан автоматически', { u }) }] })
    emit({ t: 'put', key: 'bots', value: botView(b) }); putAccount(n)
    const general = chan('general'); if (general) { general.members.push(n); putChannel(general) }
    const dm = { id: `dm-${n}`, kind: 'dm', name: n, members: ['me', n] }
    S.channels.push(dm); putChannel(dm)
    toast(tr('Бот {n} создан: @{u}', { n, u }))
    return { channelId: dm.id }
  },

  createGroup: (actor, a) => {
    const n = String(a.name ?? '').trim().toLowerCase().replace(/\s+/g, '-')
    if (!n) err(tr('Нужно название'))
    if (chanByName(n)) err(tr('Такая группа уже есть'))
    const members = [...new Set([actor, ...(a.members ?? []).filter((m) => acc(m))])]
    const c = { id: `g-${uid()}`, kind: 'channel', name: n, members }
    S.channels.push(c); putChannel(c)
    return { channelId: c.id }
  },
  addMembers: (actor, a) => {
    const c = chan(a.channelId) ?? err(tr('Нет такого чата'))
    c.members = [...new Set([...c.members, ...(a.ids ?? []).filter((m) => acc(m))])]
    putChannel(c)
  },
  openDm: (actor, a) => ({ channelId: dmChannel(actor, a.id).id }),

  updateBot: (actor, a) => {
    const b = bot(a.id) ?? err(tr('Нет такого бота'))
    const d = botDir(b.id)
    for (const [field, file] of [['claudeMd', 'CLAUDE.md'], ['memory', 'memory.md'], ['todo', 'todo.md']]) if (typeof a.patch[field] === 'string') writeFileSync(join(d, file), a.patch[field])
    const p = a.patch
    if (p.model !== undefined) { if (!validModel(p.model)) err(tr('Неизвестная модель или эндпоинт удалён')); b.model = p.model }
    if (p.effort !== undefined) { if (!EFFORTS.includes(p.effort)) err(tr('Неизвестный уровень размышлений')); b.effort = p.effort }
    if (p.boss !== undefined) b.boss = !!p.boss
    for (const k of ['sleeping', 'schedule', 'role']) if (p[k] !== undefined) b[k] = p[k]
    if (Array.isArray(p.mcp)) b.mcp = [...new Set(p.mcp.map(String))].filter((id) => MCP.get(id))
    if (Array.isArray(p.skills)) b.skills = [...new Set(p.skills.map(String))].filter((n) => SKILLS.exists(n))
    persist()
    putBot(b.id, a.except) // эхо не отправляем автору правки
  },

  /* Аккаунт: одни и те же команды для пользователя и агентов */
  updateAccount: (actor, a) => {
    const x = acc(actor)
    for (const k of ['name', 'bio', 'primary']) if (typeof a.patch[k] === 'string') x[k] = k === 'primary' ? (a.patch[k] === 'number' ? 'number' : 'username') : a.patch[k].slice(0, 200)
    putAccount(actor)
  },
  setUsername: (actor, a) => {
    const u = String(a.name).trim().toLowerCase()
    const taken = Object.values(S.accounts).filter((x) => x.id !== actor).map((x) => x.username)
    const rule = usernameRule(u, taken)
    const x = acc(actor)
    if (!rule.ok) err(tr(rule.reason))
    if (u === x.username) err(tr('Это уже ваш юзернейм'))
    x.username = u
    logAcc(actor, tr('Сменил юзернейм на @{u}', { u }))
    putAccount(actor)
    if (actor === 'me') toast(tr('Юзернейм @{u} установлен', { u }))
    return { username: u }
  },
  block: (actor, a) => {
    if (!acc(a.id)) err(tr('Нет такого аккаунта'))
    if (a.id === actor) err(tr('Себя блокировать нельзя'))
    const x = acc(actor); x.blocked = [...new Set([...x.blocked, a.id])]
    logAcc(actor, tr('Заблокировал {n}', { n: nameOf(a.id) }))
    putAccount(actor)
    if (actor === 'me') toast(tr('{n} заблокирован', { n: nameOf(a.id) }))
  },
  unblock: (actor, a) => {
    const x = acc(actor); x.blocked = x.blocked.filter((i) => i !== a.id)
    logAcc(actor, tr('Разблокировал {n}', { n: nameOf(a.id) }))
    putAccount(actor)
    if (actor === 'me') toast(tr('Разблокирован'))
  },
  toggleMute: (actor, a) => {
    chan(a.channelId) ?? err(tr('Нет такого чата'))
    const x = acc(actor)
    const on = x.muted.includes(a.channelId)
    x.muted = on ? x.muted.filter((i) => i !== a.channelId) : [...x.muted, a.channelId]
    logAcc(actor, tr(on ? 'Включил звук {c}' : 'Заглушил {c}', { c: chan(a.channelId).name }))
    putAccount(actor)
    if (actor === 'me') toast(on ? tr('Звук включён') : tr('Чат заглушен'))
  },
  leaveChannel: (actor, a) => {
    const c = chan(a.channelId) ?? err(tr('Нет такого чата'))
    if (c.kind !== 'channel') err(tr('Из личных чатов не выходят, их можно заглушить или заблокировать собеседника'))
    c.members = c.members.filter((m) => m !== actor)
    putChannel(c)
    logAcc(actor, tr('Покинул группу #{c}', { c: c.name }))
    putAccount(actor)
    if (actor !== 'me') sysMsg(c.id, tr('{n} вышел из группы', { n: nameOf(actor) }))
    else toast(tr('Вы покинули группу'))
  },

  stopAll: () => {
    const n = stopRuns()
    toast(n ? tr('Остановлено запусков: {n}', { n }) : tr('Ничего не запущено'))
    return { stopped: n }
  },
  // Сессии: папка проекта + свои боты, группы и переписка. Работают и без открытой сессии.
  // Haiku придумывает подробный системный промпт (5 предложений) по названию и короткому описанию
  generatePrompt: async (actor, a) => {
    const name = String(a.name ?? '').trim()
    if (!name) err(tr('Сначала введите название бота'))
    const desc = String(a.description ?? '').trim().slice(0, 600)
    const opts = lightRunOpts()
    const text = await runOnce({ ...opts, prompt: PR.generateRolePrompt(name, desc, getLang()) })
    return { prompt: text.replace(/^["«]|["»]$/g, '').trim() }
  },
  listRecent: () => ({ recent: recentView() }),

  /* Сторонние MCP-серверы */
  saveMcp: (actor, a) => {
    const lines = (t) => Object.fromEntries(String(t ?? '').split(/\r?\n/).map((l) => /^\s*([^=:\s]+)\s*[=:]\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].trim()]))
    const type = ['stdio', 'http', 'sse'].includes(a.type) ? a.type : 'stdio'
    const args = typeof a.args === 'string' ? (a.args.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((x) => x.replace(/^["']|["']$/g, '')) : a.args
    if (a.id) { MCP.update(a.id, { name: a.name, command: a.command, args, url: a.url, env: lines(a.env), headers: lines(a.headers), allBots: a.allBots }); emitTools(); return { id: a.id } }
    const server = type === 'stdio' ? { type, command: String(a.command ?? '').trim(), args: args ?? [], env: lines(a.env), headers: {} } : { type, url: String(a.url ?? '').trim(), headers: lines(a.headers), env: {}, args: [] }
    if (type === 'stdio' ? !server.command : !/^https?:\/\//i.test(server.url)) err(tr(type === 'stdio' ? 'Нужна команда запуска' : 'Нужен адрес сервера (http или https)'))
    const x = MCP.add(a.name, server)
    emitTools()
    return { id: x.id }
  },
  deleteMcp: (actor, a) => {
    MCP.remove(a.id)
    for (const b of S.bots) if (b.mcp?.includes(a.id)) { b.mcp = b.mcp.filter((x) => x !== a.id); putBot(b.id) }
    emitTools()
  },
  testMcp: async (actor, a) => {
    const x = MCP.get(a.id) ?? err(tr('Нет такого MCP-сервера'))
    try { return { ok: true, tools: await testServer(x) } } catch (e) { return { ok: false, error: e.message } }
  },
  // Находит настройки MCP у других агентов на этом компьютере (значения ключей не отдаются)
  scanMcp: () => ({ found: scanMcp(ctx?.folder) }),
  importMcp: (actor, a) => {
    let items = []
    if (a.text) items = parseMcpText(a.text, a.filename ?? '').map((x) => ({ ...x, source: 'import' }))
    else {
      const wanted = new Set(a.names ?? [])
      const file = String(a.file ?? '')
      const known = scanMcp(ctx?.folder).find((f) => f.file === file) ?? err(tr('Этот файл не из списка найденных'))
      items = readMcpSource(known.file).filter((x) => !wanted.size || wanted.has(x.name)).map((x) => ({ ...x, source: known.source }))
    }
    let added = 0
    for (const it of items) { const before = MCP.list().length; MCP.add(it.name, it.server, it.source); if (MCP.list().length > before) added++ }
    emitTools()
    return { added, total: items.length }
  },

  /* Навыки */
  // Haiku придумывает навык по запросу: название, описание и инструкцию. Ничего не сохраняет, форму заполняет клиент.
  generateSkill: async (actor, a) => {
    const req = String(a.request ?? '').trim().slice(0, 1500)
    if (!req) err(tr('Опишите, что должен уметь навык'))
    const text = await runOnce({ ...lightRunOpts(), prompt: PR.generateSkillPrompt(req, getLang()) })
    const j = /\{[\s\S]*\}/.exec(text)
    let o = null
    try { o = JSON.parse(j?.[0] ?? '') } catch { /* модель ответила не JSON */ }
    if (!o?.body) err(tr('Не удалось придумать навык, попробуйте переформулировать запрос'))
    return { name: String(o.name ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32), description: String(o.description ?? '').trim(), body: String(o.body).trim() }
  },
  getSkill: (actor, a) => SKILLS.get(a.name) ?? err(tr('Нет такого навыка')),
  saveSkill: (actor, a) => {
    const n = SKILLS.save(a.name, a.description, a.body, a.source)
    emitTools()
    return { name: n }
  },
  deleteSkill: (actor, a) => {
    SKILLS.remove(a.name)
    for (const b of S.bots) if (b.skills?.includes(a.name)) { b.skills = b.skills.filter((x) => x !== a.name); putBot(b.id) }
    emitTools()
  },
  scanSkills: () => ({ found: scanSkills(ctx?.folder) }),
  importSkills: (actor, a) => {
    const known = scanSkills(ctx?.folder)
    let added = 0
    const names = []
    for (const it of a.items ?? []) {
      const c = known.find((k) => k.path === it.path) ?? err(tr('Этот файл не из списка найденных'))
      if (c.kind === 'skill') names.push(SKILLS.importDir(c.path, c.source))
      else {
        const { body } = parseSkillMd(readFileSync(c.path, 'utf8'))
        names.push(SKILLS.save(c.name, c.description, body, c.source))
      }
      added++
    }
    emitTools()
    return { added, names }
  },
  // Включить MCP и навыки боту (id) или всем ботам ('*'); add: добавить к имеющимся, иначе заменить
  setBotTools: (actor, a) => {
    const targets = a.id === '*' ? S.bots : [bot(a.id) ?? err(tr('Нет такого бота'))]
    for (const b of targets) {
      for (const [field, valid] of [['mcp', (x) => MCP.get(x)], ['skills', (x) => SKILLS.exists(x)]]) {
        if (!Array.isArray(a[field])) continue
        const next = a.add ? [...(b[field] ?? []), ...a[field]] : a[field]
        b[field] = [...new Set(next.map(String))].filter(valid)
      }
      putBot(b.id)
    }
    persist()
  },

  /* Файлы из сообщений: показать содержимое (текст), картинку или вложение */
  openFile: (actor, a) => {
    const m = S.messages.find((x) => x.id === a.msgId) ?? err(tr('Нет сообщения'))
    const f = resolveFileRef(a.ref, m.authorId) ?? err(tr('Файл не найден или недоступен'))
    const name = basename(f.real)
    const kind = fileKind(f.real)
    const rel = inside(f.real, realpathSync(WORKSPACE)) ? f.real.slice(realpathSync(WORKSPACE).length + 1).replaceAll('\\', '/') : f.real.replaceAll('\\', '/')
    if (kind === 'text') {
      const buf = readFileSync(f.real)
      if (buf.subarray(0, 8000).includes(0)) { const att = attachFromPaths([f.real]).attachments[0]; return { kind: 'binary', name, path: rel, size: f.size, attachment: att } }
      const LIM = 400_000
      return { kind: 'text', name, path: rel, size: f.size, line: f.line, truncated: buf.length > LIM, text: buf.subarray(0, LIM).toString('utf8') }
    }
    const { attachments, bad } = attachFromPaths([f.real])
    if (!attachments.length) err(bad.join(', '))
    return { kind, name, path: rel, size: f.size, attachment: attachments[0] }
  },

  /* Импорт переписок из других ИИ */
  scanChats: () => {
    const root = join(homedir(), '.claude', 'projects')
    const out = []
    if (existsSync(root)) {
      for (const d of readdirSync(root)) {
        const dir = join(root, d)
        let files = []
        try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')) } catch { continue }
        for (const f of files) {
          const p = join(dir, f)
          let st = null
          try { st = statSync(p) } catch { continue }
          out.push({ path: p, mtime: st.mtimeMs, size: st.size, project: d })
        }
      }
    }
    out.sort((x, y) => y.mtime - x.mtime)
    return { found: out.slice(0, 30).map((o) => {
      let first = ''
      try { const head = readFileSync(o.path, 'utf8').slice(0, 60_000); for (const l of head.split('\n')) { const j = JSON.parse(l); if (j.type === 'user' && !j.isMeta) { const c = j.message?.content; const t = typeof c === 'string' ? c : (c ?? []).map((b) => b.text ?? '').join(' '); if (t && !/^</.test(t.trim())) { first = t.trim().slice(0, 90); break } } } } catch { /* строка могла оборваться */ }
      return { ...o, title: first || basename(o.path) }
    }) }
  },
  previewChats: async (actor, a) => {
    let text = a.text
    let name = a.filename ?? ''
    if (!text) {
      const p = String(a.path ?? '').trim().replace(/^"|"$/g, '')
      if (!p || !existsSync(p) || !statSync(p).isFile()) err(tr('Файл не найден'))
      if (statSync(p).size > 300 * 1024 * 1024) err(tr('Файл больше 300 МБ'))
      name = p
      if (/\.zip$/i.test(p)) {
        // экспорт ChatGPT и Claude.ai приходит архивом с conversations.json
        const dir = join(tmpdir(), 'clawds-import-' + uid())
        mkdirSync(dir, { recursive: true })
        await new Promise((res, rej) => { const c = spawn('tar', ['-xf', p, '-C', dir], { windowsHide: true }); c.on('error', rej); c.on('close', (code) => (code === 0 ? res() : rej(new Error('tar ' + code)))) })
        const found = [join(dir, 'conversations.json'), ...readdirSync(dir).map((f) => join(dir, f))].find((f) => /\.json$/i.test(f) && existsSync(f))
        if (!found) err(tr('В архиве нет conversations.json'))
        text = readFileSync(found, 'utf8')
        rmSync(dir, { recursive: true, force: true })
      } else text = readFileSync(p, 'utf8')
    }
    const r = parseChats(text, name)
    chatCache = { key: uid(), ...r }
    return { key: chatCache.key, format: r.format, conversations: r.conversations.map((c) => ({ id: c.id, title: c.title, count: c.messages.length, first: c.messages[0].text.slice(0, 120) })) }
  },
  importChat: (actor, a) => {
    if (!chatCache || chatCache.key !== a.key) err(tr('Сначала выберите файл заново'))
    const target = bot(a.botId) ?? S.bots.find((b) => !b.boss) ?? S.bots[0] ?? err(tr('Сначала создайте бота: импортированный чат продолжается с ним'))
    const ids = new Set(a.ids ?? [])
    const chosen = chatCache.conversations.filter((c) => ids.has(c.id))
    if (!chosen.length) err(tr('Ничего не выбрано'))
    let made = 0
    for (const conv of chosen) {
      const base = 'import-' + (conv.title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'chat')
      let name = base
      let i = 2
      while (chanByName(name)) name = base + '-' + i++
      const c = { id: 'g-' + uid(), kind: 'channel', name, members: ['me', target.id] }
      S.channels.push(c); putChannel(c)
      let last = 0
      for (const m of conv.messages) {
        last = Math.max(last + 1, m.ts || 0)
        addMsg({ channelId: c.id, authorId: m.role === 'user' ? 'me' : target.id, text: m.text, ts: last, imported: true })
      }
      made++
    }
    toast(tr('Импортировано разговоров: {n}', { n: made }))
    return { made }
  },

  /* Подключения */
  claudeLogin: async () => {
    if (loginWatch) return {}
    const cmdFile = join(ROOT, 'server', 'login.cmd')
    const before = credStamp()
    const wasIn = claudeLoggedIn()
    // «fresh»: выйти из старого входа перед новым, чтобы новый вход не путался со старым
    spawn('cmd.exe', ['/c', 'start', '""', '"' + cmdFile + '"', wasIn ? 'fresh' : ''], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true, windowsHide: false }).unref()
    let n = 0
    loginWatch = setInterval(() => {
      const done = credStamp() !== before && claudeLoggedIn()
      if (done || ++n > 90) {
        clearInterval(loginWatch); loginWatch = null
        emit({ t: 'toast', text: done ? tr('Вход в Claude выполнен') : tr('Вход не завершён') })
        emitConn()
      }
    }, 2000)
    emitConn()
    return {}
  },
  setLang: (actor, a) => { setLang(a.lang); recent.lang = getLang(); saveRecent() },
  claudeStatus: async () => { emitConn(); return { loggedIn: claudeLoggedIn() } },
  saveProvider: async (actor, a) => {
    const p = PROV.upsert(a)
    const r = await fetchModels(p)
    PROV.save(); emitConn()
    return { id: p.id, ok: r.ok, count: r.count ?? p.models.length, error: r.error }
  },
  refreshModels: async (actor, a) => {
    const p = PROV.get(a.id) ?? err(tr('Нет такого эндпоинта'))
    const r = await fetchModels(p)
    PROV.save(); emitConn()
    return { ok: r.ok, count: r.count, error: r.error }
  },
  deleteProvider: (actor, a) => { PROV.remove(a.id); emitConn() },
  // lite для одной модели или сразу для всех (a.model не задан)
  setModelLite: (actor, a) => {
    const p = PROV.get(a.id) ?? err(tr('Нет такого эндпоинта'))
    for (const m of p.models) if (a.model === undefined || a.model === m.id) m.lite = !!a.lite
    PROV.save(); emitConn()
  },
  addModel: (actor, a) => {
    const p = PROV.get(a.id) ?? err(tr('Нет такого эндпоинта'))
    const id = String(a.model ?? '').trim()
    if (!id) err(tr('Нужен ID модели'))
    if (!p.models.some((m) => m.id === id)) p.models.push({ id, name: id, lite: !!p.liteDefault, manual: true })
    PROV.save(); emitConn()
  },
  removeModel: (actor, a) => {
    const p = PROV.get(a.id) ?? err(tr('Нет такого эндпоинта'))
    p.models = p.models.filter((m) => m.id !== a.model)
    PROV.save(); emitConn()
  },
  inspectFolder: async (actor, a) => {
    const folder = resolveFolder(a.path)
    return { folder, isRepo: await isGitRepo(folder), sessions: recentView().filter((s) => same(s.folder, folder)) }
  },
  createSession: async (actor, a) => {
    const e = createSessionEntry(resolveFolder(a.folder), a.name)
    await openSession(e.id)
    return { id: e.id }
  },
  openSession: async (actor, a) => { await openSession(a.id); return {} },
  closeSession: async () => { await closeSession(); return {} },
  // Новая сессия в той же папке: пустая, без ботов и групп
  newSession: async (actor, a) => {
    if (!ctx) err(tr('Сессия не открыта'))
    const e = createSessionEntry(ctx.folder, a.name)
    await openSession(e.id)
    toast(tr('Новая сессия: пустая, добавьте ботов'))
    return { id: e.id }
  },
  // Сброс: всё внутри этой сессии удаляется (боты, группы, переписка, память), сама сессия остаётся
  resetSession: async () => { await resetSession(); toast(tr('Сессия сброшена')); return {} },
  renameSession: (actor, a) => {
    if (!ctx) err(tr('Сессия не открыта'))
    ctx.name = String(a.name ?? '').trim().slice(0, 60) || ctx.name
    saveRecent(); emit(launcherInfo())
    emit({ t: 'set', key: 'session', value: { id: ctx.id, name: ctx.name, folder: ctx.folder } })
  },
  forgetSession: (actor, a) => {
    if (ctx?.id === a.id) err(tr('Эта сессия сейчас открыта'))
    recent.sessions = recent.sessions.filter((s) => s.id !== a.id)
    saveRecent(); emit(launcherInfo())
  },

  setSettings: (actor, a) => { S.settings = { ...S.settings, ...a.patch }; emit({ t: 'set', key: 'settings', value: S.settings }); persist(); waiters.splice(0).forEach((r) => r()) },
  addFolder: async (actor, a) => {
    const p = String(a.path ?? '').trim().replace(/^"|"$/g, '')
    if (!p || !existsSync(p) || !statSync(p).isDirectory()) err(tr('Такой папки нет'))
    if (!S.folders.includes(p)) S.folders.push(p)
    persist(); await refreshWorkspace()
  },
  setRemote: async (actor, a) => {
    const url = String(a.url ?? '').trim()
    if (!url) err(tr('Нужен адрес репозитория'))
    const r = await setRemote(WORKSPACE, url)
    if (!r.ok) err(r.err || tr('Не удалось задать remote'))
    await refreshWorkspace()
    toast(tr('Remote origin задан'))
  },
  refreshWorkspace: async () => { await refreshWorkspace() },

  upload: (actor, a) => {
    const buf = Buffer.from(String(a.data ?? ''), 'base64')
    if (buf.length > 25 * 1024 * 1024) err(tr('Файл больше 25 МБ'))
    const safe = basename(String(a.name || 'file')).replace(/[^\w.\-а-яА-Я ]/g, '_')
    const id = `${uid()}-${safe}`
    const path = join(UPLOADS, id)
    writeFileSync(path, buf)
    return { id, name: safe, size: buf.length, mime: a.mime || 'application/octet-stream', url: `${API}/files/${encodeURIComponent(id)}`, path: path.replace(/\\/g, '/') }
  },
}

/* ---------- Расписание ---------- */

const lastFire = new Map()
export function tickSchedules(d = new Date()) {
  if (!ctx) return
  const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`
  for (const b of S.bots) {
    for (const s of b.schedule ?? []) {
      if (!cronMatches(s.cron, d) || lastFire.get(s.id) === key) continue
      lastFire.set(s.id, key)
      const dm = dmChannel('me', b.id)
      sysMsg(dm.id, tr('Расписание {c}: {p}', { c: s.cron, p: s.prompt }))
      runBot({ botId: b.id, channelId: dm.id, from: 'me', text: s.prompt, depth: 0, trigger: null })
    }
  }
}

/* ---------- API для агентов (CLI clawds.mjs) ---------- */

const HELP = `Команды (node clawds.mjs <команда>):
  whoami                       мой аккаунт, баланс сердец, журнал
  accounts [поиск]             найти аккаунты по имени, @юзеру или номеру
  channels                     мои чаты
  history <#канал|@кто> [n]    последние сообщения чата
  send <#канал|@кто|@me> "текст"   написать (в личку бота: он запустится).
                               В тексте: @кто tier 3 (уведомление), [high]@кто tier 2 (будит), /all tier 1 (будит всех, раз в 10 минут)
  group-create <имя> @a @b     создать группу
  group-add <#канал> @a @b     добавить в группу
  set-username <имя>           сменить юзернейм (до 5 символов платно)
  set-name "<имя>"  set-bio "<текст>"  set-primary username|number
  bots                         все боты, их модели и размышления
  set-effort @бот <уровень>    (только главный) low|medium|high|xhigh|max|default
  block @кому  unblock @кому
  mute <#канал>  unmute <#канал>   заглушить: бот реагирует только на прямые упоминания
  leave <#канал>               выйти из группы`

export function agentCall(token, action, args, files = []) {
  const ctx = agentTokens.get(token) ?? err('Недействительный токен')
  const me = ctx.botId
  const ref = (h) => byHandle(h) ?? err(`Не нашёл ${h}`)
  const chanRef = (c) => (String(c).startsWith('#') ? chanByName(c) : null) ?? chan(String(c)) ?? err(`Нет чата ${c}`)
  const fmtAcc = (a) => `${a.name} @${a.username} ${a.number}${S.bots.some((b) => b.id === a.id) ? ' [бот]' : ''}`

  switch (action) {
    case 'help': return HELP
    case 'whoami': {
      const a = acc(me)
      return [`${a.name} @${a.username}`, `номер ${a.number} (постоянный адрес, не меняется), основной идентификатор: ${a.primary}`, `заблокированы: ${a.blocked.join(', ') || 'никто'}`, `заглушены: ${a.muted.map((c) => chan(c)?.name).join(', ') || 'ничего'}`, 'журнал:', ...a.log.slice(0, 8).map((l) => `  ${hhmm(l.ts)} ${l.text}`)].join('\n')
    }
    case 'accounts': {
      const q = String(args[0] ?? '').toLowerCase().replace(/^@/, '').replace(/\s+/g, '')
      return Object.values(S.accounts).filter((a) => !q || a.name.toLowerCase().includes(q) || a.username.includes(q) || a.number.replace(/\s+/g, '').includes(q)).map(fmtAcc).join('\n') || 'Ничего не найдено'
    }
    case 'channels':
      return S.channels.filter((c) => c.members.includes(me)).map((c) => `${c.kind === 'dm' ? '@' + (c.members.find((m) => m !== me) === 'me' ? 'me' : acc(c.members.find((m) => m !== me))?.username) : '#' + c.name}  (${c.members.map((m) => acc(m)?.username ?? m).join(', ')})${acc(me).muted.includes(c.id) ? ' [заглушен]' : ''}`).join('\n')
    case 'history': {
      const t = String(args[0] ?? '')
      const c = t.startsWith('#') ? chanByName(t) : dmChannel(me, ref(t))
      if (!c || !c.members.includes(me)) err('Нет доступа к чату')
      return S.messages.filter((m) => m.channelId === c.id && !m.system).slice(-(parseInt(args[1], 10) || 15)).map((m) => fmtMsg(m, me)).join('\n') || 'Пусто'
    }
    case 'send': {
      const to = String(args[0] ?? ''); const text = args.slice(1).join(' ')
      const c = to.startsWith('#') ? chanByName(to) ?? err(`Нет группы ${to}`) : dmChannel(me, ref(to))
      if (c.kind === 'dm' && c.members.includes('me') && acc('me').blocked.includes(me)) err('Пользователь вас заблокировал')
      const att = files.length ? attachFromPaths(files) : { attachments: [], bad: [] }
      if (files.length && !att.attachments.length) err('Ни один файл не приложен: ' + att.bad.join(', '))
      sendMessage(me, c.id, text, { depth: ctx.depth + 1, attachments: att.attachments.length ? att.attachments : undefined })
      ctx.sent?.push({ channelId: c.id, text })
      return `Отправлено в ${to}` + (att.attachments.length ? `, файлов: ${att.attachments.length}` : '') + (att.bad.length ? `. Не приложено: ${att.bad.join(', ')}` : '')
    }
    case 'group-create': {
      const r = commands.createGroup(me, { name: args[0], members: args.slice(1).map(ref) })
      return `Группа создана (${r.channelId})`
    }
    case 'group-add': commands.addMembers(me, { channelId: chanRef(args[0]).id, ids: args.slice(1).map(ref) }); return 'Добавлены'
    case 'set-username': { const r = commands.setUsername(me, { name: args[0] }); return `Теперь @${r.username}` }
    case 'set-name': commands.updateAccount(me, { patch: { name: args.join(' ') } }); return 'Имя изменено'
    case 'set-bio': commands.updateAccount(me, { patch: { bio: args.join(' ') } }); return 'Описание изменено'
    case 'set-primary': commands.updateAccount(me, { patch: { primary: args[0] } }); return 'Готово'
    case 'bots': return S.bots.map((x) => '@' + acc(x.id).username + '  ' + x.model + ', размышления: ' + (x.effort ?? 'default') + (x.boss ? ', главный' : '')).join('\n')
    case 'set-effort': {
      const self = bot(me)
      if (!self?.boss) err('Менять размышления других может только главный бот')
      const target = bot(ref(args[0])) ?? err('Это не бот')
      const level = String(args[1] ?? '').toLowerCase()
      if (!EFFORTS.includes(level)) err('Уровень: low, medium, high, xhigh, max или default')
      if (!supportsEffort(target.model)) err('Модель ' + target.model + ' не поддерживает уровни размышлений')
      const prev = target.effort ?? 'default'
      target.effort = level
      persist(); putBot(target.id)
      const dm = dmChannel('me', target.id)
      sysMsg(dm.id, 'Размышления ' + target.name + ' изменил ' + nameOf(me) + ': ' + prev + ' → ' + level)
      logAcc(target.id, 'Размышления изменил ' + nameOf(me) + ': ' + prev + ' → ' + level); putAccount(target.id)
      return 'Готово: ' + target.name + ' теперь ' + level
    }
    case 'block': commands.block(me, { id: ref(args[0]) }); return 'Заблокирован'
    case 'unblock': commands.unblock(me, { id: ref(args[0]) }); return 'Разблокирован'
    case 'mute': case 'unmute': {
      const c = chanRef(args[0]); const muted = acc(me).muted.includes(c.id)
      if ((action === 'mute') === muted) return 'Без изменений'
      commands.toggleMute(me, { channelId: c.id }); return action === 'mute' ? 'Заглушен' : 'Звук включён'
    }
    case 'leave': commands.leaveChannel(me, { channelId: chanRef(args[0]).id }); return 'Вы вышли из группы'
    default: err(`Неизвестная команда ${action}. Смотрите help`)
  }
}

export const getState = () => S

// Команды, доступные без открытой сессии
export const GLOBAL_COMMANDS = new Set(['generateSkill', 'saveMcp', 'deleteMcp', 'testMcp', 'scanMcp', 'importMcp', 'getSkill', 'saveSkill', 'deleteSkill', 'scanSkills', 'importSkills', 'scanChats', 'previewChats', 'setLang', 'claudeLogin', 'claudeStatus', 'saveProvider', 'refreshModels', 'deleteProvider', 'setModelLite', 'addModel', 'removeModel', 'generatePrompt', 'listRecent', 'inspectFolder', 'createSession', 'openSession', 'forgetSession'])
