import { create } from 'zustand'
import type { Account, Attachment, Bot, Channel, Conn, McpServer, SkillInfo, Message, Quota, RecentSession, Session, Settings, Workspace } from './types'
import { setProviderRegistry } from './models'
import { t, getLang, setLangValue, type Lang } from './i18n'
import { call } from './live'

export type FileView = { name: string; path: string; size: number; text: string; line: number; truncated: boolean }
export type Panel = { kind: 'none' } | { kind: 'bot'; id: string } | { kind: 'workspace' } | { kind: 'members' } | { kind: 'thread'; id: string }
export type Modal = null | 'createBot' | 'createGroup' | 'settings' | 'search' | 'profile' | 'accounts' | 'account' | 'connections' | 'tools'

const emptyWorkspace: Workspace = { path: '', remote: '', branches: [], commits: [], tree: [], folders: [], dirty: 0 }
const emptyQuota: Quota = { known: false, fiveHour: { pct: 0, resetsAt: 0 }, sevenDay: { pct: 0, resetsAt: 0 } }
const emptySettings: Settings = { fullAccess: true, computerUse: false, claudeInChrome: false, maxParallel: 3, pauseAtPct: 90, pauseAtPct5h: 0, maxChainDepth: 2, handoffPair: 3, handoffTotal: 10, handoffWindow: 10, allCooldown: 10 }

// Время последнего прочтения хранится в браузере: непрочитанное считает клиент
const LR_KEY = 'clawds.lastRead'
const loadLastRead = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(LR_KEY) ?? '{}') } catch { return {} } }
const saveLastRead = (v: Record<string, number>) => { try { localStorage.setItem(LR_KEY, JSON.stringify(v)) } catch { /* без хранилища */ } }

type State = {
  // реплика сервера
  bots: Bot[]
  channels: Channel[]
  messages: Message[]
  accounts: Record<string, Account>
  workspace: Workspace
  quota: Quota
  settings: Settings
  typing: Record<string, string[]>
  running: number
  muted: string[]
  recent: RecentSession[]
  session: Session | null
  conn: Conn
  fileView: FileView | null
  tools: { mcp: McpServer[]; skills: SkillInfo[] }
  lang: Lang
  // только интерфейс
  live: boolean
  ready: boolean
  active: string
  panel: Panel
  modal: Modal
  profileId: string | null
  lightbox: Attachment | null
  toast: { id: number; text: string } | null
  mobileChat: boolean
  lastRead: Record<string, number>

  setLive: (v: boolean) => void
  openFileRef: (msgId: string, ref: string) => Promise<void>
  closeFile: () => void
  setLang: (l: Lang) => void
  rpc: <T = any>(name: string, args?: Record<string, unknown>) => Promise<T | undefined>
  apply: (ev: any) => void
  setActive: (id: string) => void
  setPanel: (p: Panel) => void
  setModal: (m: Modal) => void
  openProfile: (id: string) => void
  setLightbox: (a: Attachment | null) => void
  backToList: () => void
  say: (text: string) => void
  unreadOf: (cid: string) => number

  send: (channelId: string, text: string, threadOf?: string, attachments?: Attachment[]) => void
  react: (msgId: string, emoji: string) => void
  pin: (msgId: string) => void
  createBot: (name: string, role: string, model: string, effort: string, prompt?: string) => Promise<void>
  generatePrompt: (name: string, description: string) => Promise<string | undefined>
  createGroup: (name: string, members: string[]) => Promise<void>
  addMembers: (channelId: string, ids: string[]) => void
  openDm: (botId: string) => void
  updateBot: (id: string, patch: Partial<Bot>) => void
  addFolder: (path: string) => void
  setRemote: (url: string) => void
  refreshWorkspace: () => void
  setSettings: (patch: Partial<Settings>) => void
  updateAccount: (id: string, patch: Partial<Account>) => void
  setUsername: (name: string) => void
  block: (id: string) => void
  unblock: (id: string) => void
  toggleMute: (channelId: string) => void
  leaveChannel: (channelId: string) => void
  stopAll: () => void

  inspectFolder: (path: string) => Promise<{ folder: string; isRepo: boolean; sessions: RecentSession[] } | undefined>
  createSession: (folder: string, name?: string) => Promise<boolean>
  openSession: (id: string) => Promise<boolean>
  forgetSession: (id: string) => void
  newSession: () => Promise<void>
  resetSession: () => Promise<void>
  closeSession: () => Promise<void>
  renameSession: (name: string) => void

  claudeLogin: () => Promise<void>
  saveProvider: (a: { id?: string; name: string; baseUrl: string; apiKey: string; auth: string; liteDefault: boolean }) => Promise<{ id: string; ok: boolean; count: number; error?: string } | undefined>
  refreshModels: (id: string) => Promise<void>
  deleteProvider: (id: string) => void
  setModelLite: (id: string, model: string | undefined, lite: boolean) => void
  addModel: (id: string, model: string) => void
  removeModel: (id: string, model: string) => void
}

const upsert = <T extends { id: string }>(list: T[], v: T) => {
  const i = list.findIndex((x) => x.id === v.id)
  if (i < 0) return [...list, v]
  const next = list.slice()
  next[i] = v
  return next
}

// Правки текстовых полей бота идут с задержкой, чтобы не писать файл на каждую букву
const botTimers = new Map<string, number>()
const botPending = new Map<string, Partial<Bot>>()
const accTimer = { t: 0, patch: {} as Partial<Account> }

export const useStore = create<State>((set, get) => {
  const say = (text: string) => {
    const tid = Date.now()
    set({ toast: { id: tid, text } })
    setTimeout(() => get().toast?.id === tid && set({ toast: null }), 2600)
  }
  // Любая команда: ошибка сервера показывается тостом
  const cmd = async <T = any>(name: string, args: Record<string, unknown> = {}): Promise<T | undefined> => {
    try { return ((await call<T>(name, args)) ?? ({} as T)) } catch (e) { say((e as Error).message); return undefined }
  }

  return {
    bots: [], channels: [], messages: [], accounts: {}, workspace: emptyWorkspace, quota: emptyQuota, settings: emptySettings,
    typing: {}, running: 0, muted: [], recent: [], session: null, conn: { loggedIn: true, pending: false, providers: [] }, lang: getLang(), tools: { mcp: [], skills: [] }, fileView: null,
    live: false, ready: false, active: '', panel: { kind: 'none' }, modal: null, profileId: null, lightbox: null, toast: null,
    mobileChat: false, lastRead: loadLastRead(),

    setLive: (live) => {
      set(live ? { live } : { live, ready: false })
      if (live) void cmd('setLang', { lang: get().lang }) // серверные сообщения и боты говорят на языке интерфейса
    },
    rpc: (name, args = {}) => cmd(name, args),
    // Клик по пути к файлу в сообщении: текст открываем в окне просмотра, картинки и бинарные файлы во вложении
    openFileRef: async (msgId, ref) => {
      const r = await cmd<{ kind: string; name: string; path: string; size: number; line?: number; truncated?: boolean; text?: string; attachment?: Attachment }>('openFile', { msgId, ref })
      if (!r) return
      if (r.kind === 'text' && r.text !== undefined) set({ fileView: { name: r.name, path: r.path, size: r.size, text: r.text, line: r.line ?? 0, truncated: !!r.truncated } })
      else if (r.attachment) set({ lightbox: r.attachment })
    },
    closeFile: () => set({ fileView: null }),
    setLang: (lang) => {
      setLangValue(lang)
      set({ lang })
      void cmd('setLang', { lang })
    },

    apply: (ev) => {
      switch (ev.t) {
        case 'tools': set({ tools: { mcp: ev.mcp, skills: ev.skills } }); break
        case 'conn': setProviderRegistry(ev.providers); set({ conn: { loggedIn: ev.loggedIn, pending: ev.pending, providers: ev.providers } }); break
        case 'recent': set({ recent: ev.recent, ready: true }); break
        case 'closed':
          set({ session: null, bots: [], channels: [], messages: [], accounts: {}, typing: {}, running: 0, muted: [], active: '', panel: { kind: 'none' }, modal: null, mobileChat: false, workspace: emptyWorkspace, ready: true })
          break
        case 'snapshot': {
          const s = ev.state
          const lr = { ...get().lastRead }
          for (const c of s.channels as Channel[]) if (lr[c.id] === undefined) lr[c.id] = Date.now()
          saveLastRead(lr)
          const active = s.channels.some((c: Channel) => c.id === get().active) ? get().active : s.channels.find((c: Channel) => c.members.includes('me'))?.id ?? ''
          set({ ...s, muted: s.accounts.me?.muted ?? [], ready: true, active, lastRead: lr, panel: { kind: 'none' }, modal: null, mobileChat: false })
          break
        }
        case 'put': {
          if (ev.key === 'accounts') {
            const accounts: Record<string, Account> = { ...get().accounts, [ev.value.id]: ev.value }
            set({ accounts, muted: accounts.me?.muted ?? get().muted })
          } else if (ev.key === 'messages') {
            const list = get().messages
            // сообщение чаще всего последнее, ищем с конца
            let i = list.length - 1
            while (i >= 0 && list[i].id !== ev.value.id) i--
            const next = i < 0 ? [...list, ev.value] : Object.assign(list.slice(), { [i]: ev.value })
            set({ messages: next })
          } else set({ [ev.key]: upsert(get()[ev.key as 'bots' | 'channels'] as any, ev.value) } as any)
          break
        }
        case 'set': set({ [ev.key]: ev.value } as any); break
        case 'text': case 'tool': case 'toolEnd': {
          const list = get().messages
          let i = list.length - 1
          while (i >= 0 && list[i].id !== ev.id) i--
          if (i < 0) break
          const m = { ...list[i] }
          if (ev.t === 'text') m.text = ev.full ?? m.text + ev.delta
          else if (ev.t === 'tool') m.tools = [...(m.tools ?? []), ev.tool]
          else m.tools = m.tools?.map((x) => (x.id === ev.toolId ? { ...x, output: ev.output, done: true } : x))
          if (ev.t === 'text' && ev.full) m.error = true
          set({ messages: Object.assign(list.slice(), { [i]: m }) })
          break
        }
        case 'del': set({ messages: get().messages.filter((m) => m.id !== ev.id) }); break
        case 'toast': say(ev.text); break
      }
    },

    setActive: (cid) => {
      const lastRead = { ...get().lastRead, [cid]: Date.now() }
      saveLastRead(lastRead)
      set((s) => ({ active: cid, mobileChat: true, lastRead, panel: s.panel.kind === 'thread' ? { kind: 'none' } : s.panel }))
    },
    setPanel: (panel) => set({ panel }),
    setModal: (modal) => set({ modal }),
    openProfile: (pid) => set({ profileId: pid, modal: 'profile' }),
    setLightbox: (lightbox) => set({ lightbox }),
    backToList: () => set({ mobileChat: false }),
    say,
    unreadOf: (cid) => {
      const { messages, lastRead, active, accounts } = get()
      const t = lastRead[cid] ?? 0
      if (cid === active) return 0
      return messages.filter((m) => m.channelId === cid && m.ts > t && m.authorId !== 'me' && !m.system && !m.streaming && !accounts.me?.blocked.includes(m.authorId)).length
    },

    send: (channelId, text, threadOf, attachments) => {
      // Прочитанным считаем чат, в который пишем
      const lastRead = { ...get().lastRead, [channelId]: Date.now() }
      saveLastRead(lastRead); set({ lastRead })
      void cmd('send', { channelId, text, threadOf, attachments })
    },
    react: (msgId, emoji) => void cmd('react', { msgId, emoji }),
    pin: (msgId) => void cmd('pin', { msgId }),

    generatePrompt: async (name, description) => (await cmd<{ prompt: string }>('generatePrompt', { name, description }))?.prompt,
    createBot: async (name, role, model, effort, prompt) => {
      const r = await cmd<{ channelId: string }>('createBot', { name, role, model, effort, prompt })
      if (r) { set({ modal: null }); get().setActive(r.channelId) }
    },
    createGroup: async (name, members) => {
      const r = await cmd<{ channelId: string }>('createGroup', { name, members })
      if (r) { set({ modal: null }); get().setActive(r.channelId) }
    },
    addMembers: (channelId, ids) => void cmd('addMembers', { channelId, ids }),
    openDm: async (botId) => {
      const r = await cmd<{ channelId: string }>('openDm', { id: botId })
      if (r) get().setActive(r.channelId)
    },

    updateBot: (bid, patch) => {
      set((s) => ({ bots: s.bots.map((b) => (b.id === bid ? { ...b, ...patch } : b)) }))
      botPending.set(bid, { ...botPending.get(bid), ...patch })
      clearTimeout(botTimers.get(bid))
      botTimers.set(bid, window.setTimeout(() => {
        const p = botPending.get(bid)
        botPending.delete(bid)
        if (p) void cmd('updateBot', { id: bid, patch: p })
      }, 500))
    },
    addFolder: (path) => void cmd('addFolder', { path }),
    setRemote: (url) => void cmd('setRemote', { url }),
    refreshWorkspace: () => void cmd('refreshWorkspace'),
    setSettings: (patch) => {
      set((s) => ({ settings: { ...s.settings, ...patch } }))
      void cmd('setSettings', { patch })
    },

    updateAccount: (aid, patch) => {
      if (aid !== 'me') return
      set((s) => ({ accounts: { ...s.accounts, me: { ...s.accounts.me, ...patch } } }))
      accTimer.patch = { ...accTimer.patch, ...patch }
      clearTimeout(accTimer.t)
      accTimer.t = window.setTimeout(() => { const p = accTimer.patch; accTimer.patch = {}; void cmd('updateAccount', { patch: p }) }, 400)
    },
    setUsername: (name) => void cmd('setUsername', { name }),
    block: (id) => void cmd('block', { id }),
    unblock: (id) => void cmd('unblock', { id }),
    toggleMute: (channelId) => void cmd('toggleMute', { channelId }),
    stopAll: () => void cmd('stopAll'),
    inspectFolder: (path) => cmd('inspectFolder', { path }),
    createSession: async (folder, name) => !!(await cmd('createSession', { folder, name })),
    openSession: async (id) => !!(await cmd('openSession', { id })),
    forgetSession: (id) => void cmd('forgetSession', { id }),
    newSession: async () => { await cmd('newSession') },
    resetSession: async () => { await cmd('resetSession') },
    closeSession: async () => { await cmd('closeSession') },
    renameSession: (name) => {
      set((st) => (st.session ? { session: { ...st.session, name } } : {}))
      void cmd('renameSession', { name })
    },
    claudeLogin: async () => { await cmd('claudeLogin') },
    saveProvider: async (a) => {
      const r = await cmd<{ id: string; ok: boolean; count: number; error?: string }>('saveProvider', a)
      if (r) say(r.ok ? t('Эндпоинт сохранён, моделей: {n}', { n: r.count }) : (r.error ?? t('Эндпоинт сохранён, список моделей не получен')))
      return r
    },
    refreshModels: async (id) => {
      const r = await cmd<{ ok: boolean; count?: number; error?: string }>('refreshModels', { id })
      if (r) say(r.ok ? t('Моделей: {n}', { n: r.count ?? 0 }) : (r.error ?? t('Не удалось обновить')))
    },
    deleteProvider: (id) => void cmd('deleteProvider', { id }),
    setModelLite: (id, model, lite) => void cmd('setModelLite', { id, model, lite }),
    addModel: (id, model) => void cmd('addModel', { id, model }),
    removeModel: (id, model) => void cmd('removeModel', { id, model }),
    leaveChannel: async (channelId) => {
      const r = await cmd('leaveChannel', { channelId })
      if (r) {
        const rest = get().channels.find((c) => c.members.includes('me') && c.id !== channelId)
        set({ active: rest?.id ?? '', panel: { kind: 'none' }, mobileChat: false })
      }
    },
  }
})
